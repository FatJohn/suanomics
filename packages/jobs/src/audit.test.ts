import type { AuditRepo } from './audit.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuditRepo } from './audit.js'

function makeFakeDb() {
  const rows: Record<string, Record<string, unknown>> = {}
  return {
    rows,
    insert: vi.fn((row: Record<string, unknown>) => {
      rows[row.id as string] = row
      return { id: row.id as string }
    }),
    update: vi.fn((id: string, patch: Record<string, unknown>) => {
      if (!rows[id])
        throw new Error(`not found: ${id}`)
      rows[id] = { ...rows[id], ...patch }
    }),
    findInflight: vi.fn(async (kind: string, payloadHash: string) => {
      return Object.values(rows).find(r =>
        r.jobKind === kind && r.payloadHash === payloadHash && ['queued', 'active'].includes(r.status as string),
      ) ?? null
    }),
  }
}

describe('auditRepo', () => {
  let db: ReturnType<typeof makeFakeDb>
  let repo: AuditRepo

  beforeEach(() => {
    db = makeFakeDb()
    repo = createAuditRepo(db)
  })

  function getRow(id: string): Record<string, unknown> {
    const row = db.rows[id]
    if (!row)
      throw new Error(`row missing: ${id}`)
    return row
  }

  it('insert 會補齊預設 status + timestamps', async () => {
    const id = await repo.insert({
      jobKind: 'corpus-refresh',
      payloadHash: 'h1',
    })
    const row = getRow(id)
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(0)
    expect(row.createdAt).toBeInstanceOf(Date)
  })

  it('markActive sets status + startedAt + attempts', async () => {
    const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'h' })
    await repo.markActive(id)
    const row = getRow(id)
    expect(row.status).toBe('active')
    expect(row.startedAt).toBeInstanceOf(Date)
    // attempts 每次 markActive 遞增：runner 每個 attempt 都會呼叫一次，這個欄位就是
    // 「重試了幾次」的唯一來源。fake 曾經漏掉這一句，而真實作有。
    expect(row.attempts).toBe(1)
    await repo.markActive(id)
    expect(getRow(id).attempts).toBe(2)
  })

  it('markCompleted records resultRef + completedAt + metadata', async () => {
    const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'h' })
    await repo.markCompleted(id, { resultRef: 'external_articles/batch-x', metadata: { inserted: 5 } })
    const row = getRow(id)
    expect(row.status).toBe('completed')
    expect(row.resultRef).toBe('external_articles/batch-x')
    expect(row.metadata).toEqual({ inserted: 5 })
  })

  it('markFailed trims error to 2000 chars', async () => {
    const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'h' })
    await repo.markFailed(id, 'x'.repeat(3000))
    const row = getRow(id)
    expect((row.errorMessage as string).length).toBe(2000)
  })

  it('findInflight returns row if queued/active with same payloadHash', async () => {
    const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'h1' })
    const found = await repo.findInflight('corpus-refresh', 'h1')
    expect(found?.id).toBe(id)
  })

  it('findInflight returns null if only completed rows exist', async () => {
    const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'h1' })
    await repo.markCompleted(id, { resultRef: 'x' })
    expect(await repo.findInflight('corpus-refresh', 'h1')).toBeNull()
  })

  // 窗改成逐 kind 取。corpus-refresh 的窗是 90 分鐘（prod 實測最長 25 分），
  // 所以 6 分鐘前的 row 現在是「還在跑」，不是孤兒——這正是舊的 5 分鐘窗判錯的那一格。
  it('findInflight 對 6 分鐘前的 corpus-refresh row 仍回 already-inflight', async () => {
    const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'h-running' })
    // eslint-disable-next-line ts/no-non-null-assertion -- row was just inserted above in the same test; the fake DB guarantees it exists at this point
    db.rows[id]!.createdAt = new Date(Date.now() - 6 * 60 * 1000)
    expect((await repo.findInflight('corpus-refresh', 'h-running'))?.id).toBe(id)
  })

  it('findInflight 對超過該 kind 窗的 row 回 null', async () => {
    const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'h-stale' })
    // eslint-disable-next-line ts/no-non-null-assertion -- row was just inserted above in the same test; the fake DB guarantees it exists at this point
    db.rows[id]!.createdAt = new Date(Date.now() - 100 * 60 * 1000)
    expect(await repo.findInflight('corpus-refresh', 'h-stale')).toBeNull()
  })

  // 舊版只是把孤兒從查詢結果濾掉，於是那些 row 永遠停在 active、沒有任何人知道它們是
  // 殘骸（prod 現存 5 筆，全是 2026-07 的 analyze queued row）。
  it('findInflight 順手把孤兒標成 failed，而不是靜靜忽略它', async () => {
    const id = await repo.insert({ jobKind: 'analyze', payloadHash: 'h-orphan' })
    // eslint-disable-next-line ts/no-non-null-assertion -- row was just inserted above in the same test; the fake DB guarantees it exists at this point
    db.rows[id]!.createdAt = new Date(Date.now() - 60 * 60 * 1000)
    await repo.findInflight('analyze', 'h-orphan')
    const row = getRow(id)
    expect(row.status).toBe('failed')
    expect(row.errorMessage).toContain('orphaned')
    expect(row.completedAt).toBeInstanceOf(Date)
  })

  it('findInflight 用 startedAt 當錨：排隊很久但剛開始跑的 job 不算孤兒', async () => {
    const id = await repo.insert({ jobKind: 'analyze', payloadHash: 'h-queued-long' })
    // eslint-disable-next-line ts/no-non-null-assertion -- row was just inserted above in the same test; the fake DB guarantees it exists at this point
    const row = db.rows[id]!
    row.createdAt = new Date(Date.now() - 60 * 60 * 1000)
    row.startedAt = new Date(Date.now() - 60 * 1000)
    row.status = 'active'
    expect((await repo.findInflight('analyze', 'h-queued-long'))?.id).toBe(id)
  })

  it('findInflight 對窗內的新 row 照常回 already-inflight（反向對照）', async () => {
    const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'h-fresh' })
    expect((await repo.findInflight('corpus-refresh', 'h-fresh'))?.id).toBe(id)
  })

  describe('failAllInflight', () => {
    // 開機回收沒有窗：單 process 之後沒有第二個 process 會接手，所以「還很新」不是活著的證據。
    it('把每一筆 queued/active row 標成 failed，不管它有多新', async () => {
      const queued = await repo.insert({ jobKind: 'analyze', payloadHash: 'f1' })
      const active = await repo.insert({ jobKind: 'news-refresh', payloadHash: 'f2' })
      await repo.markActive(active)

      expect(await repo.failAllInflight('server restarted')).toBe(2)
      expect(getRow(queued).status).toBe('failed')
      expect(getRow(active).status).toBe('failed')
      expect(getRow(active).errorMessage).toBe('server restarted')
    })

    it('不碰 completed / failed 的 row（反向對照）', async () => {
      const done = await repo.insert({ jobKind: 'analyze', payloadHash: 'f3' })
      await repo.markCompleted(done, { resultRef: 'x' })
      expect(await repo.failAllInflight('server restarted')).toBe(0)
      expect(getRow(done).status).toBe('completed')
    })
  })

  it('findById finds row by audit uuid', async () => {
    const id = await repo.insert({ jobKind: 'market-data-refresh', payloadHash: 'h' })
    const found = await repo.findById(id)
    expect(found?.id).toBe(id)
    expect(found?.jobKind).toBe('market-data-refresh')
  })

  it('findById returns null when uuid does not match any row', async () => {
    await repo.insert({ jobKind: 'market-data-refresh', payloadHash: 'h3' })
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  describe('findRecentCompleted', () => {
    it('returns row when status=completed within 24h cache window', async () => {
      const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'ph-a' })
      await repo.markCompleted(id, { resultRef: 'external_articles/batch-1' })
      const found = await repo.findRecentCompleted('corpus-refresh', 'ph-a')
      expect(found?.id).toBe(id)
      expect(found?.resultRef).toBe('external_articles/batch-1')
    })

    it('returns null when status=completed but completedAt is older than 24h', async () => {
      const id = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'ph-b' })
      await repo.markCompleted(id, { resultRef: 'x' })
      // 把 completedAt 改成 25 小時前
      // eslint-disable-next-line ts/no-non-null-assertion -- row was inserted and markCompleted called above; fake DB guarantees the row exists here
      db.rows[id]!.completedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
      const found = await repo.findRecentCompleted('corpus-refresh', 'ph-b')
      expect(found).toBeNull()
    })

    it('returns null when only queued/active rows exist with same payloadHash', async () => {
      await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'ph-c' })
      const found = await repo.findRecentCompleted('corpus-refresh', 'ph-c')
      expect(found).toBeNull()
    })

    it('returns most recent completed when multiple completed rows match', async () => {
      const id1 = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'ph-d' })
      await repo.markCompleted(id1, { resultRef: 'old-batch' })
      // eslint-disable-next-line ts/no-non-null-assertion -- row was just inserted above; fake DB guarantees it exists here
      db.rows[id1]!.completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 小時前

      const id2 = await repo.insert({ jobKind: 'corpus-refresh', payloadHash: 'ph-d' })
      await repo.markCompleted(id2, { resultRef: 'new-batch' })
      // eslint-disable-next-line ts/no-non-null-assertion -- row was just inserted above; fake DB guarantees it exists here
      db.rows[id2]!.completedAt = new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 小時前（較新）

      const found = await repo.findRecentCompleted('corpus-refresh', 'ph-d')
      expect(found?.id).toBe(id2)
      expect(found?.resultRef).toBe('new-batch')
    })
  })

  describe('markMetadata', () => {
    it('updates only specified keys, preserves others (jsonb_set semantics)', async () => {
      const id = await repo.insert({
        jobKind: 'analyze',
        payloadHash: 'h',
        metadata: { existing: 'preserve-me' },
      })
      await repo.markMetadata(id, { routingMode: 'cache-hit' })
      const row = await repo.findById(id)
      expect(row?.metadata).toEqual({ existing: 'preserve-me', routingMode: 'cache-hit' })
    })

    it('overwrites same key when called twice', async () => {
      const id = await repo.insert({
        jobKind: 'analyze',
        payloadHash: 'h2',
      })
      await repo.markMetadata(id, { routingMode: 'db-related' })
      await repo.markMetadata(id, { routingMode: 'full-pipeline' })
      const row = await repo.findById(id)
      expect((row?.metadata as Record<string, unknown>).routingMode).toBe('full-pipeline')
    })
  })

  // Bug 2026-06-16：去重三查只用 payloadHash、不含 kind。news-refresh 與 market-data-refresh
  // 都是空 payload `{}` → 同 payloadHash → market-data-refresh 撞到 news-refresh 的 completed
  // row 被誤判 already-completed、靜默跳過。治本：dedup key = (kind, payloadHash)。
  describe('dedup is scoped by jobKind', () => {
    it('findRecentCompleted does not match a completed row of a different kind with same payloadHash', async () => {
      const id = await repo.insert({ jobKind: 'news-refresh', payloadHash: 'h-empty' })
      await repo.markCompleted(id, { resultRef: 'news_items/x' })
      expect((await repo.findRecentCompleted('news-refresh', 'h-empty'))?.id).toBe(id)
      expect(await repo.findRecentCompleted('market-data-refresh', 'h-empty')).toBeNull()
    })

    it('findInflight does not match an inflight row of a different kind with same payloadHash', async () => {
      const id = await repo.insert({ jobKind: 'news-refresh', payloadHash: 'h-empty2' })
      expect((await repo.findInflight('news-refresh', 'h-empty2'))?.id).toBe(id)
      expect(await repo.findInflight('market-data-refresh', 'h-empty2')).toBeNull()
    })
  })
})
