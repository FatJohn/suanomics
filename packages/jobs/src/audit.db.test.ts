import type { JobKind } from './types.js'
import { closeDb, getDb } from '@suanomics/db/client'
import { backgroundJobs } from '@suanomics/db/schema'
import { eq, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuditRepo } from './audit.js'

// 真 DB 整合測試。audit.test.ts 是 fake-DB 單元測試，兩者刻意分檔。
//
// 分檔的理由不是分類癖：staleness 的判定原本在 fake 與真 Drizzle 兩條路徑各寫一次，而
// **只有 fake 那條有測試**。2026-08-22 的獨立複查就是用真 DB 推翻了一句照
// fake 行為寫出來的宣稱（「排程跑到一半手動觸發會被擋」）。這支的職責就一個：
// (kind, payloadHash) 的去重與 inflight 回收，在真 Postgres 上行為與純函式一致。

const TAG = 'dbtest-audit-inflight-'

async function cleanup(): Promise<void> {
  await getDb().delete(backgroundJobs).where(like(backgroundJobs.payloadHash, `${TAG}%`))
}

async function seed(opts: {
  kind: JobKind
  hash: string
  status: 'queued' | 'active' | 'completed' | 'failed'
  createdMinutesAgo: number
  startedMinutesAgo?: number
}): Promise<string> {
  const now = Date.now()
  const [row] = await getDb().insert(backgroundJobs).values({
    jobKind: opts.kind,
    payloadHash: `${TAG}${opts.hash}`,
    status: opts.status,
    createdAt: new Date(now - opts.createdMinutesAgo * 60_000),
    ...(opts.startedMinutesAgo !== undefined ? { startedAt: new Date(now - opts.startedMinutesAgo * 60_000) } : {}),
  }).returning({ id: backgroundJobs.id })
  if (!row)
    throw new Error('seed failed')
  return row.id
}

async function statusOf(id: string): Promise<{ status: string, errorMessage: string | null, completedAt: Date | null }> {
  const rows = await getDb().select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1)
  const r = rows[0]
  if (!r)
    throw new Error('row disappeared')
  return { status: r.status, errorMessage: r.errorMessage, completedAt: r.completedAt }
}

describe('findInflight (real DB)', () => {
  const repo = createAuditRepo()
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  // 這是 already-inflight 去重的核心那一格。舊版是單一 5 分鐘窗、在真 DB 上對這筆回 null，於是同 payload
  // 再打一次會併跑第二份 news-refresh（prod 實測 p50 就要 10.5 分鐘）。
  it('跑了 35 分鐘的 news-refresh 仍算 inflight', async () => {
    const id = await seed({ kind: 'news-refresh', hash: 'running', status: 'active', createdMinutesAgo: 36, startedMinutesAgo: 35 })
    const found = await repo.findInflight('news-refresh', `${TAG}running`)
    expect(found?.id).toBe(id)
  })

  it('跑了 95 分鐘的 news-refresh 過窗、回 null 並被標成 failed', async () => {
    const id = await seed({ kind: 'news-refresh', hash: 'dead', status: 'active', createdMinutesAgo: 96, startedMinutesAgo: 95 })
    expect(await repo.findInflight('news-refresh', `${TAG}dead`)).toBeNull()
    const after = await statusOf(id)
    expect(after.status).toBe('failed')
    expect(after.errorMessage).toContain('orphaned')
    expect(after.completedAt).toBeInstanceOf(Date)
  })

  // 窗是逐 kind 的，這條證明真 DB 路徑真的有讀那張表、而不是共用一個常數。
  it('同樣跑 20 分鐘：analyze 過窗、corpus-refresh 沒有', async () => {
    await seed({ kind: 'analyze', hash: 'a20', status: 'active', createdMinutesAgo: 21, startedMinutesAgo: 20 })
    const corpusId = await seed({ kind: 'corpus-refresh', hash: 'c20', status: 'active', createdMinutesAgo: 21, startedMinutesAgo: 20 })
    expect(await repo.findInflight('analyze', `${TAG}a20`)).toBeNull()
    expect((await repo.findInflight('corpus-refresh', `${TAG}c20`))?.id).toBe(corpusId)
  })

  // 錨點選擇在真 DB 上的行為：concurrency=1 的 kind 排隊很久、剛開始跑的 job 不是孤兒。
  it('用 startedAt 當錨：建立於 60 分鐘前但 1 分鐘前才開跑的 analyze 仍算 inflight', async () => {
    const id = await seed({ kind: 'analyze', hash: 'queued-long', status: 'active', createdMinutesAgo: 60, startedMinutesAgo: 1 })
    expect((await repo.findInflight('analyze', `${TAG}queued-long`))?.id).toBe(id)
  })

  it('反向對照：completed row 不會被當成 inflight，也不會被標 failed', async () => {
    const id = await seed({ kind: 'analyze', hash: 'done', status: 'completed', createdMinutesAgo: 600 })
    expect(await repo.findInflight('analyze', `${TAG}done`)).toBeNull()
    expect((await statusOf(id)).status).toBe('completed')
  })
})

describe('failAllInflight (real DB)', () => {
  const repo = createAuditRepo()
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  // ★ 這支掃的是整張表、而且沒有窗——那正是它的職責（開機時每一筆 inflight row 都是
  // 上一次執行的殘骸）。副作用是它在有既有資料的本機 DB 上也會順手標掉別人的 inflight row，
  // 所以斷言只針對本測試自己 seed 的 row，而且不要在 server 或 CLI 跑著的時候跑這支。
  it('把 queued 與 active 都標成 failed，不管有多新', async () => {
    const queued = await seed({ kind: 'analyze', hash: 'fai-queued', status: 'queued', createdMinutesAgo: 1 })
    const active = await seed({ kind: 'news-refresh', hash: 'fai-active', status: 'active', createdMinutesAgo: 1, startedMinutesAgo: 1 })

    const n = await repo.failAllInflight('server restarted')
    expect(n).toBeGreaterThanOrEqual(2)
    expect((await statusOf(queued)).status).toBe('failed')
    expect((await statusOf(active)).status).toBe('failed')
    expect((await statusOf(active)).errorMessage).toBe('server restarted')
    expect((await statusOf(active)).completedAt).not.toBeNull()
  })

  it('反向對照：completed / failed 的 row 不動', async () => {
    const done = await seed({ kind: 'analyze', hash: 'fai-done', status: 'completed', createdMinutesAgo: 5 })
    await repo.failAllInflight('server restarted')
    expect((await statusOf(done)).status).toBe('completed')
  })
})
