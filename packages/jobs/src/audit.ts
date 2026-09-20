import type { FakeDb } from './audit-fake.js'

import type { IdentifiedInflightRow } from './inflight.js'
import type { JobKind, JobStatus } from './types.js'
import { getDb } from '@suanomics/db/client'
import { backgroundJobs } from '@suanomics/db/schema'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { createFakeAuditRepo, isFakeDb } from './audit-fake.js'
import { orphanErrorMessage, partitionInflight } from './inflight.js'
import { JOB_RESULT_CACHE_AGE_MS } from './types.js'

// orphan 的判定（多久算孤兒、用哪個時間欄位當錨）在 inflight.ts，逐 kind 取值在 types.ts 的
// JOB_INFLIGHT_STALENESS_MS。這裡刻意不再放任何時間常數：fake 與真 Drizzle 兩條路徑都呼叫
// 同一支純函式，邊界只有一份，改一邊另一邊照綠的事不會再發生。
//
// 兩條路徑都不把 staleness 寫進 SQL/篩選條件，而是把 (kind, payloadHash) 的 queued/active
// row 全撈出來、在 JS 裡分類。這麼做有兩個理由：① 那個集合永遠只有個位數，撈全部不貴；
// ② 判定只有一份實作。附帶好處是**孤兒可以被順手標成 failed**——舊版只是把它們從查詢結果
// 濾掉，於是那些 row 永遠停在 active、沒有任何人知道它們是殘骸。

// 一次最多處理幾筆 inflight row。正常情況是 0-2 筆，這個上限只是防呆。
const INFLIGHT_SCAN_LIMIT = 50

export interface AuditRowShape {
  id?: string
  jobKind: JobKind
  payloadHash: string
  status?: JobStatus
  attempts?: number
  resultRef?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
  createdAt?: Date
  startedAt?: Date | null
  completedAt?: Date | null
}

export interface InsertInput {
  jobKind: JobKind
  payloadHash: string
  metadata?: Record<string, unknown>
}

export interface AuditRepo {
  insert: (input: InsertInput) => Promise<string>
  markActive: (id: string) => Promise<void>
  markCompleted: (id: string, opts: { resultRef: string, metadata?: Record<string, unknown> }) => Promise<void>
  markFailed: (id: string, errorMessage: string, opts?: { metadata?: Record<string, unknown> }) => Promise<void>
  // 在 routing decision 確定後寫 metadata.routingMode（status 仍 active）、
  // 讓 frontend polling 時就能讀到 routingMode、供 cache-hit flash UX 用。
  // 採 jsonb || merge 語義：只更新指定 key、不影響其他 key。
  markMetadata: (id: string, partial: Record<string, unknown>) => Promise<void>
  // 去重 key = (kind, payloadHash)。不同 kind 可能算出相同 payloadHash（如 news-refresh
  // 與 market-data-refresh 都是空 payload）、必須帶 kind 才不會跨 kind 互相 dedup。
  findInflight: (kind: JobKind, payloadHash: string) => Promise<AuditRowShape | null>
  // 查同 (kind, payloadHash) 是否在結果快取窗（24h）內有 completed row。
  // 若有、enqueue 直接回 already-completed、不重跑。
  findRecentCompleted: (kind: JobKind, payloadHash: string) => Promise<AuditRowShape | null>
  findById: (id: string) => Promise<AuditRowShape | null>
  // 無條件把所有 queued/active row 標成 failed，回傳筆數。server 開機時呼叫一次。
  //
  // 為什麼可以無條件、不必等它們過窗：job 狀態只活在單一 process 的記憶體裡，開機當下
  // 任何 inflight row 都必然是上一次執行的殘骸，沒有第二個 process 會接手它。留著只會讓同
  // payload 在窗內一直被 findInflight 當成 already-inflight 擋掉——從「資料髒」變成「功能鎖」。
  //
  // findInflight 內建的過窗回收仍然保留：它負責 CLI 被 kill 而 server 沒重啟的情況。
  failAllInflight: (reason: string) => Promise<number>
}

// Real Drizzle 寫入操作（insert / mark* 系列）
function createWriteHelpers(): Pick<AuditRepo, 'insert' | 'markActive' | 'markCompleted' | 'markFailed' | 'markMetadata'> {
  return {
    insert: async (input) => {
      const realDb = getDb()
      const [row] = await realDb.insert(backgroundJobs).values({
        jobKind: input.jobKind,
        payloadHash: input.payloadHash,
        status: 'queued',
        metadata: input.metadata ?? {},
      }).returning({ id: backgroundJobs.id })
      if (!row)
        throw new Error('audit insert returned no row')
      return row.id
    },
    markActive: async (id) => {
      const realDb = getDb()
      await realDb.update(backgroundJobs)
        .set({ status: 'active', startedAt: new Date(), attempts: sql`${backgroundJobs.attempts} + 1` })
        .where(eq(backgroundJobs.id, id))
    },
    markCompleted: async (id, opts) => {
      const realDb = getDb()
      const patch: Record<string, unknown> = {
        status: 'completed',
        resultRef: opts.resultRef,
        completedAt: new Date(),
      }
      if (opts.metadata)
        patch.metadata = opts.metadata
      await realDb.update(backgroundJobs).set(patch).where(eq(backgroundJobs.id, id))
    },
    markFailed: async (id, errorMessage, opts) => {
      const realDb = getDb()
      const patch: Record<string, unknown> = {
        status: 'failed',
        errorMessage: errorMessage.slice(0, 2000),
        completedAt: new Date(),
      }
      if (opts?.metadata)
        patch.metadata = opts.metadata
      await realDb.update(backgroundJobs).set(patch).where(eq(backgroundJobs.id, id))
    },
    markMetadata: async (id, partial) => {
      const realDb = getDb()
      // jsonb || merge：右邊欄位覆蓋左邊、不影響未指定的 key
      await realDb.update(backgroundJobs)
        .set({ metadata: sql`COALESCE(${backgroundJobs.metadata}, '{}'::jsonb) || ${JSON.stringify(partial)}::jsonb` })
        .where(eq(backgroundJobs.id, id))
    },
  }
}

// Real Drizzle 查詢操作（find* 系列）
function createQueryHelpers(): Pick<AuditRepo, 'findInflight' | 'findRecentCompleted' | 'findById' | 'failAllInflight'> {
  return {
    findInflight: async (kind, payloadHash) => {
      const realDb = getDb()
      const now = Date.now()
      // 不在 SQL 裡篩時間：那個集合永遠只有個位數，而把判定留在 JS 可以與 fake 路徑
      // 共用同一支純函式（見檔頭）。順帶避開 drizzle 的 sql 模板裸內插 Date 會炸
      // postgres-js driver 的坑。
      const rows = await realDb.select().from(backgroundJobs).where(and(
        eq(backgroundJobs.jobKind, kind),
        eq(backgroundJobs.payloadHash, payloadHash),
        inArray(backgroundJobs.status, ['queued', 'active']),
      )).orderBy(desc(backgroundJobs.createdAt)).limit(INFLIGHT_SCAN_LIMIT)
      const { fresh, orphans } = partitionInflight(rows as AuditRowShape[], now)
      await failOrphans(orphans, now)
      return fresh
    },
    findRecentCompleted: async (kind, payloadHash) => {
      const realDb = getDb()
      const cutoff = new Date(Date.now() - JOB_RESULT_CACHE_AGE_MS)
      const rows = await realDb.select().from(backgroundJobs).where(and(
        eq(backgroundJobs.jobKind, kind),
        eq(backgroundJobs.payloadHash, payloadHash),
        eq(backgroundJobs.status, 'completed'),
        gte(backgroundJobs.completedAt, cutoff),
      )).orderBy(desc(backgroundJobs.completedAt)).limit(1)
      return (rows[0] as AuditRowShape | undefined) ?? null
    },
    findById: async (id) => {
      const realDb = getDb()
      const rows = await realDb.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1)
      return (rows[0] as AuditRowShape | undefined) ?? null
    },
    failAllInflight: async (reason) => {
      const realDb = getDb()
      const updated = await realDb.update(backgroundJobs).set({
        status: 'failed',
        errorMessage: reason.slice(0, 2000),
        completedAt: new Date(),
      }).where(inArray(backgroundJobs.status, ['queued', 'active'])).returning({ id: backgroundJobs.id })
      return updated.length
    },
  }
}

export function createAuditRepo(db?: FakeDb): AuditRepo {
  if (db && isFakeDb(db))
    return createFakeAuditRepo(db)

  return {
    ...createWriteHelpers(),
    ...createQueryHelpers(),
  }
}

/**
 * 孤兒一律標成 failed 而不是刪掉：它們是「這次執行沒有留下結局」的證據，刪掉等於把一次
 * process 被 kill 的事實抹掉。error_message 寫明是被回收的、不是 job 自己失敗的。
 */
async function failOrphans(orphans: IdentifiedInflightRow[], now: number): Promise<void> {
  if (orphans.length === 0)
    return
  const realDb = getDb()
  const completedAt = new Date(now)
  for (const o of orphans) {
    if (!o.id)
      continue
    // status guard 不是多餘的：判定與 UPDATE 之間有時間差，若這筆其實還活著、又剛好在
    // 這個空隙裡跑完，只用 id 當條件會把 completed 覆寫回 failed。極窄的競態，但一行就能關掉。
    await realDb.update(backgroundJobs).set({
      status: 'failed',
      errorMessage: orphanErrorMessage(o, now).slice(0, 2000),
      completedAt,
    }).where(and(
      eq(backgroundJobs.id, o.id),
      inArray(backgroundJobs.status, ['queued', 'active']),
    ))
  }
}
