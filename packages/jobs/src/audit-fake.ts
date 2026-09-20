import type { AuditRepo, AuditRowShape } from './audit.js'
import type { JobKind } from './types.js'
import { randomUUID } from 'node:crypto'
import { orphanErrorMessage, partitionInflight } from './inflight.js'
import { JOB_RESULT_CACHE_AGE_MS } from './types.js'

// 測試用的 in-memory audit repo。與真 Drizzle 實作分檔的理由是行數（audit.ts 撞到 300 行的
// eslint 上限），但分開之後有個附帶好處：一眼看得出哪些行為只存在於 test double。
// ★ inflight 的判定不在這裡重寫——fake 與真實作都呼叫 inflight.ts 的同一支純函式，
//   那正是曾經兩份實作會漂移的地方。

export interface FakeDb {
  insert: (row: Record<string, unknown>) => { id: string }
  update: (id: string, patch: Record<string, unknown>) => void
  findInflight: (kind: JobKind, payloadHash: string) => Promise<Record<string, unknown> | null>
  rows: Record<string, Record<string, unknown>>
}

export function isFakeDb(v: unknown): v is FakeDb {
  return typeof v === 'object' && v !== null && 'insert' in v && 'update' in v && 'findInflight' in v && 'rows' in v
}

function fakeInflightRows(rows: Record<string, Record<string, unknown>>, kind: JobKind, payloadHash: string): AuditRowShape[] {
  return Object.values(rows)
    .filter(r => r.jobKind === kind && r.payloadHash === payloadHash && (r.status === 'queued' || r.status === 'active'))
    .sort((a, b) => ((b.createdAt as Date | undefined)?.getTime() ?? 0) - ((a.createdAt as Date | undefined)?.getTime() ?? 0)) as unknown as AuditRowShape[]
}

function fakeFindRecentCompleted(rows: Record<string, Record<string, unknown>>, kind: JobKind, payloadHash: string): AuditRowShape | null {
  const cutoff = new Date(Date.now() - JOB_RESULT_CACHE_AGE_MS)
  const candidates = Object.values(rows).filter(r =>
    r.jobKind === kind
    && r.payloadHash === payloadHash
    && r.status === 'completed'
    && r.completedAt instanceof Date
    && r.completedAt >= cutoff,
  )
  if (candidates.length === 0)
    return null
  // 最新 completedAt 優先
  candidates.sort((a, b) => (b.completedAt as Date).getTime() - (a.completedAt as Date).getTime())
  return candidates[0] as unknown as AuditRowShape
}

// Fake（test）実装：整包回傳給 createAuditRepo 做 early-return
export function createFakeAuditRepo(db: FakeDb): AuditRepo {
  return {
    insert: async (input) => {
      const id = randomUUID()
      db.insert({
        id,
        jobKind: input.jobKind,
        payloadHash: input.payloadHash,
        status: 'queued',
        attempts: 0,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
      })
      return id
    },
    markActive: async (id) => {
      // attempts + 1 與真實作（audit.ts 的 SQL `attempts + 1`）對齊。這裡曾經漏掉，
      // 而 fake 與真 Drizzle 兩條路徑漂移正是這個檔案的檔頭在警告的事。
      const attempts = (db.rows[id]?.attempts as number | undefined) ?? 0
      db.update(id, { status: 'active', startedAt: new Date(), attempts: attempts + 1 })
    },
    markCompleted: async (id, opts) => {
      const existingMeta = (db.rows[id]?.metadata as Record<string, unknown> | undefined) ?? {}
      db.update(id, {
        status: 'completed',
        resultRef: opts.resultRef,
        completedAt: new Date(),
        metadata: opts.metadata ?? existingMeta,
      })
    },
    markFailed: async (id, errorMessage, opts) => {
      const existingMeta = (db.rows[id]?.metadata as Record<string, unknown> | undefined) ?? {}
      db.update(id, {
        status: 'failed',
        errorMessage: errorMessage.slice(0, 2000),
        completedAt: new Date(),
        metadata: opts?.metadata ?? existingMeta,
      })
    },
    markMetadata: async (id, partial) => {
      const existing = (db.rows[id]?.metadata as Record<string, unknown> | undefined) ?? {}
      db.update(id, { metadata: { ...existing, ...partial } })
    },
    findInflight: async (kind, payloadHash) => {
      const now = Date.now()
      const { fresh, orphans } = partitionInflight(fakeInflightRows(db.rows, kind, payloadHash), now)
      for (const o of orphans) {
        // status guard 與真實作對齊：只有仍在 queued/active 的才改，避免覆寫剛跑完的 row。
        if (o.id && (db.rows[o.id]?.status === 'queued' || db.rows[o.id]?.status === 'active'))
          db.update(o.id, { status: 'failed', errorMessage: orphanErrorMessage(o, now), completedAt: new Date(now) })
      }
      return fresh
    },
    findRecentCompleted: async (kind, payloadHash) => {
      return fakeFindRecentCompleted(db.rows, kind, payloadHash)
    },
    findById: async (id) => {
      return (db.rows[id] as AuditRowShape | undefined) ?? null
    },
    failAllInflight: async (reason) => {
      const inflight = Object.values(db.rows).filter(r => r.status === 'queued' || r.status === 'active')
      for (const r of inflight)
        db.update(r.id as string, { status: 'failed', errorMessage: reason.slice(0, 2000), completedAt: new Date() })
      return inflight.length
    },
  }
}
