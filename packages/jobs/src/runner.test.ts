import type { AuditRowShape, InsertInput } from './audit.js'
import type { JobHandler, JobRunner, JobRunnerOptions, JobSpec, RunnerAuditRepo } from './runner-types.js'
import type { JobKind } from './types.js'
import { describe, expect, it, vi } from 'vitest'
import { createJobRunner } from './runner.js'
import { JOB_KINDS } from './types.js'

// ---------------------------------------------------------------------------
// test doubles
// ---------------------------------------------------------------------------

interface FakeAudit {
  repo: RunnerAuditRepo
  rows: Map<string, AuditRowShape>
  insert: ReturnType<typeof vi.fn>
  markActive: ReturnType<typeof vi.fn>
  markCompleted: ReturnType<typeof vi.fn>
  markFailed: ReturnType<typeof vi.fn>
  markMetadata: ReturnType<typeof vi.fn>
}

function createFakeAudit(overrides?: Partial<RunnerAuditRepo>): FakeAudit {
  const rows = new Map<string, AuditRowShape>()
  let seq = 0

  const insert = vi.fn(async (input: InsertInput): Promise<string> => {
    const id = `audit-${++seq}`
    rows.set(id, { id, jobKind: input.jobKind, payloadHash: input.payloadHash, status: 'queued', attempts: 0 })
    return id
  })
  const patch = (id: string, p: Partial<AuditRowShape>): void => {
    const row = rows.get(id)
    if (row)
      rows.set(id, { ...row, ...p })
  }
  const markActive = vi.fn(async (id: string) => {
    patch(id, { status: 'active', attempts: (rows.get(id)?.attempts ?? 0) + 1 })
  })
  const markCompleted = vi.fn(async (id: string, o: { resultRef: string, metadata?: Record<string, unknown> }) => {
    patch(id, { status: 'completed', resultRef: o.resultRef, ...(o.metadata ? { metadata: o.metadata } : {}) })
  })
  const markFailed = vi.fn(async (id: string, msg: string) => {
    patch(id, { status: 'failed', errorMessage: msg })
  })
  const markMetadata = vi.fn(async (id: string, partial: Record<string, unknown>) => {
    patch(id, { metadata: { ...(rows.get(id)?.metadata ?? {}), ...partial } })
  })

  const repo: RunnerAuditRepo = {
    insert,
    markActive,
    markCompleted,
    markFailed,
    markMetadata,
    findInflight: async () => null,
    findRecentCompleted: async () => null,
    ...overrides,
  }
  return { repo, rows, insert, markActive, markCompleted, markFailed, markMetadata }
}

const NOOP_HANDLER: JobHandler<JobKind> = async () => ({ resultRef: 'noop' })

/** 全 kind 都要有 handler（型別強制），測試只覆寫關心的那幾個。 */
function handlersWith(overrides: Partial<Record<JobKind, JobHandler<never>>>): JobRunnerOptions['handlers'] {
  const out = {} as Record<JobKind, JobHandler<never>>
  for (const k of JOB_KINDS)
    out[k] = (overrides[k] ?? NOOP_HANDLER) as JobHandler<never>
  return out as JobRunnerOptions['handlers']
}

const SPECS: readonly JobSpec[] = JOB_KINDS.map(kind => ({ kind, concurrency: 1 }))

function specsWith(overrides: Partial<Record<JobKind, number>>): readonly JobSpec[] {
  return JOB_KINDS.map(kind => ({ kind, concurrency: overrides[kind] ?? 1 }))
}

function deferred<T = void>(): { promise: Promise<T>, resolve: (v: T) => void, reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const silentLog = { warn: () => {}, error: () => {} }

function makeRunner(opts: Partial<JobRunnerOptions> & { audit: RunnerAuditRepo }): JobRunner {
  return createJobRunner({
    specs: SPECS,
    handlers: handlersWith({}),
    log: silentLog,
    ...opts,
  })
}

// ---------------------------------------------------------------------------

describe('enqueue 去重', () => {
  it('新 payload → queued，audit.insert 呼叫一次', async () => {
    const fake = createFakeAudit()
    const runner = makeRunner({ audit: fake.repo })
    const res = await runner.enqueue('news-refresh', { bucket: '2026-09-05T01' })
    expect(res.status).toBe('queued')
    expect(res.auditId).toBe('audit-1')
    expect(fake.insert).toHaveBeenCalledTimes(1)
    expect(fake.insert.mock.calls[0]?.[0]).toMatchObject({ jobKind: 'news-refresh' })
  })

  it('同 (kind, hash) 仍 inflight → already-inflight 且不 insert', async () => {
    const fake = createFakeAudit({
      findInflight: async () => ({ id: 'existing', jobKind: 'news-refresh', payloadHash: 'h' } as AuditRowShape),
    })
    const runner = makeRunner({ audit: fake.repo })
    const res = await runner.enqueue('news-refresh', { bucket: 'b' })
    expect(res).toMatchObject({ auditId: 'existing', status: 'already-inflight' })
    expect(fake.insert).not.toHaveBeenCalled()
  })

  it('24h 內已 completed → already-completed 帶 resultRef', async () => {
    const fake = createFakeAudit({
      findRecentCompleted: async () => ({ id: 'done', jobKind: 'news-refresh', payloadHash: 'h', resultRef: 'news_items/refresh-1' } as AuditRowShape),
    })
    const runner = makeRunner({ audit: fake.repo })
    const res = await runner.enqueue('news-refresh', { bucket: 'b' })
    expect(res).toMatchObject({ auditId: 'done', status: 'already-completed', resultRef: 'news_items/refresh-1' })
    expect(fake.insert).not.toHaveBeenCalled()
  })

  it('audit.insert 丟例外 → enqueue 向外 throw', async () => {
    const fake = createFakeAudit()
    fake.insert.mockRejectedValueOnce(new Error('db down'))
    const runner = makeRunner({ audit: fake.repo })
    await expect(runner.enqueue('news-refresh', { bucket: 'b' })).rejects.toThrow('db down')
  })
})

describe('併發與序列化', () => {
  it('同 kind、concurrency 1 → 第二個要等第一個 markCompleted 之後才開始', async () => {
    const fake = createFakeAudit()
    const first = deferred()
    const started: string[] = []
    const runner = makeRunner({
      audit: fake.repo,
      handlers: handlersWith({
        'news-refresh': (async (payload: { bucket: string }) => {
          started.push(payload.bucket)
          if (payload.bucket === 'one')
            await first.promise
          return { resultRef: `r/${payload.bucket}` }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'one' })
    await runner.enqueue('news-refresh', { bucket: 'two' })
    await Promise.resolve()
    expect(started).toEqual(['one'])
    expect(runner.stats()['news-refresh']).toMatchObject({ active: 1, pending: 1 })
    first.resolve()
    await runner.drain()
    expect(started).toEqual(['one', 'two'])
    expect(fake.markCompleted).toHaveBeenCalledTimes(2)
  })

  it('concurrency 2 → 兩個同時 active', async () => {
    const fake = createFakeAudit()
    const gate = deferred()
    const runner = makeRunner({
      audit: fake.repo,
      specs: specsWith({ 'corpus-refresh': 2 }),
      handlers: handlersWith({
        'corpus-refresh': (async () => {
          await gate.promise
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('corpus-refresh', { force: true })
    await runner.enqueue('corpus-refresh', { force: false })
    await Promise.resolve()
    expect(runner.stats()['corpus-refresh']).toMatchObject({ active: 2, pending: 0 })
    gate.resolve()
    await runner.drain()
  })

  it('不同 kind 互不阻塞', async () => {
    const fake = createFakeAudit()
    const blocked = deferred()
    const ran: string[] = []
    const runner = makeRunner({
      audit: fake.repo,
      handlers: handlersWith({
        'news-refresh': (async () => {
          await blocked.promise
          ran.push('news')
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
        'market-data-refresh': (async () => {
          ran.push('market')
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.enqueue('market-data-refresh', { bucket: 'b' })
    await vi.waitFor(() => expect(ran).toEqual(['market']))
    blocked.resolve()
    await runner.drain()
    expect(ran).toEqual(['market', 'news'])
  })
})

describe('audit 生命週期', () => {
  it('handler 成功 → markActive 一次、markCompleted 帶 resultRef 與 metadata', async () => {
    const fake = createFakeAudit()
    const runner = makeRunner({
      audit: fake.repo,
      handlers: handlersWith({
        'news-refresh': (async () => ({ resultRef: 'news_items/refresh-7', metadata: { totalInserted: 3 } })) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    const { auditId } = await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.drain()
    expect(fake.markActive).toHaveBeenCalledTimes(1)
    expect(fake.markActive).toHaveBeenCalledWith(auditId)
    expect(fake.markCompleted).toHaveBeenCalledWith(auditId, { resultRef: 'news_items/refresh-7', metadata: { totalInserted: 3 } })
    expect(fake.rows.get(auditId)?.attempts).toBe(1)
  })

  it('ctx.attempt 是 1-based，且每次 attempt 都 markActive', async () => {
    const fake = createFakeAudit()
    const seen: number[] = []
    const runner = makeRunner({
      audit: fake.repo,
      sleep: async () => {},
      handlers: handlersWith({
        'news-refresh': (async (_p: unknown, ctx: { attempt: number }) => {
          seen.push(ctx.attempt)
          if (ctx.attempt < 3)
            throw new Error('boom')
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.drain()
    expect(seen).toEqual([1, 2, 3])
    expect(fake.markActive).toHaveBeenCalledTimes(3)
  })
})

describe('retry 與 backoff', () => {
  it('前兩次失敗、第三次成功 → sleep 收到 5000、10000，中途不 markFailed', async () => {
    const fake = createFakeAudit()
    const sleep = vi.fn(async () => {})
    let calls = 0
    const runner = makeRunner({
      audit: fake.repo,
      sleep,
      handlers: handlersWith({
        'news-refresh': (async () => {
          calls++
          if (calls < 3)
            throw new Error(`attempt ${calls} failed`)
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.drain()
    expect(sleep.mock.calls.map(c => c[0])).toEqual([5000, 10000])
    expect(fake.markFailed).not.toHaveBeenCalled()
    expect(fake.markCompleted).toHaveBeenCalledTimes(1)
  })

  it('三次都失敗 → markFailed 一次、訊息截到 2000 字元', async () => {
    const fake = createFakeAudit()
    const long = 'x'.repeat(5000)
    const runner = makeRunner({
      audit: fake.repo,
      sleep: async () => {},
      handlers: handlersWith({
        'news-refresh': (async () => {
          throw new Error(long)
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    const { auditId } = await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.drain()
    expect(fake.markFailed).toHaveBeenCalledTimes(1)
    const msg = fake.markFailed.mock.calls[0]?.[1] as string
    expect(msg).toHaveLength(2000)
    expect(fake.rows.get(auditId)?.status).toBe('failed')
  })

  it('非 Error 的 throw 轉成 String(err)', async () => {
    const fake = createFakeAudit()
    const runner = makeRunner({
      audit: fake.repo,
      sleep: async () => {},
      handlers: handlersWith({
        'news-refresh': (async () => {
          // eslint-disable-next-line no-throw-literal -- 刻意丟非 Error，驗 runner 的 String(err) 轉換
          throw 'plain string failure'
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.drain()
    expect(fake.markFailed.mock.calls[0]?.[1]).toBe('plain string failure')
  })

  it('backoff 期間釋放 slot：同 kind 的下一個 job 可以先跑', async () => {
    const fake = createFakeAudit()
    const releaseSleep = deferred()
    const order: string[] = []
    let firstCalls = 0
    const runner = makeRunner({
      audit: fake.repo,
      sleep: async () => {
        await releaseSleep.promise
      },
      handlers: handlersWith({
        'news-refresh': (async (payload: { bucket: string }) => {
          if (payload.bucket === 'one') {
            firstCalls++
            order.push(`one#${firstCalls}`)
            if (firstCalls === 1)
              throw new Error('first attempt fails')
            return { resultRef: 'r/one' }
          }
          order.push('two')
          return { resultRef: 'r/two' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'one' })
    await runner.enqueue('news-refresh', { bucket: 'two' })
    // 'one' 第一次失敗後進 backoff、slot 釋放，'two' 不必等 backoff 結束
    await vi.waitFor(() => expect(runner.stats()['news-refresh']).toMatchObject({ waiting: 1, active: 0, pending: 0 }))
    expect(order).toEqual(['one#1', 'two'])
    releaseSleep.resolve()
    await runner.drain()
    expect(order).toEqual(['one#1', 'two', 'one#2'])
  })

  it('drain() 要等 backoff 中的 job 重跑完才 resolve', async () => {
    const fake = createFakeAudit()
    let calls = 0
    const runner = makeRunner({
      audit: fake.repo,
      sleep: async () => {},
      handlers: handlersWith({
        'news-refresh': (async () => {
          calls++
          if (calls === 1)
            throw new Error('boom')
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.drain()
    expect(calls).toBe(2)
    expect(fake.markCompleted).toHaveBeenCalledTimes(1)
  })

  it('backoff 期間 stats() 回 waiting: 1', async () => {
    const fake = createFakeAudit()
    const releaseSleep = deferred()
    const runner = makeRunner({
      audit: fake.repo,
      sleep: async () => {
        await releaseSleep.promise
      },
      handlers: handlersWith({
        'news-refresh': (async () => {
          throw new Error('boom')
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await vi.waitFor(() => expect(runner.stats()['news-refresh']).toMatchObject({ waiting: 1, active: 0, pending: 0 }))
    releaseSleep.resolve()
    await runner.drain()
  })
})

describe('progress 與 metadata', () => {
  it('updateProgress 寫進 metadata.progress，連續相同值只寫一次', async () => {
    const fake = createFakeAudit()
    const runner = makeRunner({
      audit: fake.repo,
      handlers: handlersWith({
        'news-refresh': (async (_p: unknown, ctx: { updateProgress: (n: number, s?: string) => Promise<void> }) => {
          await ctx.updateProgress(40, 'analysts')
          await ctx.updateProgress(40, 'analysts')
          await ctx.updateProgress(60, 'analysts')
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    const { auditId } = await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.drain()
    expect(fake.markMetadata.mock.calls).toEqual([
      [auditId, { progress: { percent: 40, stage: 'analysts' } }],
      [auditId, { progress: { percent: 60, stage: 'analysts' } }],
    ])
  })

  it('markMetadata 丟例外時吞掉並 log.warn，job 照常完成', async () => {
    const fake = createFakeAudit()
    fake.markMetadata.mockRejectedValue(new Error('metadata write failed'))
    const warn = vi.fn()
    const runner = makeRunner({
      audit: fake.repo,
      log: { warn, error: () => {} },
      handlers: handlersWith({
        'news-refresh': (async (_p: unknown, ctx: { updateProgress: (n: number) => Promise<void> }) => {
          await ctx.updateProgress(10)
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await runner.drain()
    expect(warn).toHaveBeenCalled()
    expect(fake.markCompleted).toHaveBeenCalledTimes(1)
  })
})

describe('chain（handler 內 enqueue）', () => {
  it('handler 用 ctx.enqueue 排另一個 kind → 不 deadlock，drain() 等到子 job 完成', async () => {
    const fake = createFakeAudit()
    const done: string[] = []
    const runner = makeRunner({
      audit: fake.repo,
      handlers: handlersWith({
        'daily-brief': (async (_p: unknown, ctx: { enqueue: (k: 'podcast-generate', p: { date: string }) => Promise<unknown> }) => {
          await ctx.enqueue('podcast-generate', { date: '2026-09-05' })
          done.push('brief')
          return { resultRef: 'r/brief' }
        }) as unknown as JobHandler<never>,
        'podcast-generate': (async () => {
          // 刻意跨一個 macrotask：drain() 若沒有把子 job 算進去，會在這之前就 resolve。
          await new Promise(r => setTimeout(r, 20))
          done.push('podcast')
          return { resultRef: 'r/podcast' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('daily-brief', { date: '2026-09-05' })
    await runner.drain()
    // 順序不斷言：子 job 是另一個 kind，與父 job 併行跑（改版前的佇列也是這個行為）。
    expect([...done].sort()).toEqual(['brief', 'podcast'])
    expect(fake.markCompleted).toHaveBeenCalledTimes(2)
  })
})

describe('start / stop', () => {
  it('start() 之前 enqueue 的 job 要等 start() 才跑', async () => {
    const fake = createFakeAudit()
    const ran: string[] = []
    const runner = makeRunner({
      audit: fake.repo,
      handlers: handlersWith({
        'news-refresh': (async () => {
          ran.push('news')
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await Promise.resolve()
    expect(ran).toEqual([])
    expect(runner.stats()['news-refresh']).toMatchObject({ pending: 1, active: 0 })
    runner.start()
    await runner.drain()
    expect(ran).toEqual(['news'])
  })

  it('stop()：pending 不再啟動，active 在 timeout 內完成就正常 markCompleted', async () => {
    const fake = createFakeAudit()
    const gate = deferred()
    const ran: string[] = []
    const runner = makeRunner({
      audit: fake.repo,
      handlers: handlersWith({
        'news-refresh': (async (payload: { bucket: string }) => {
          ran.push(payload.bucket)
          if (payload.bucket === 'one')
            await gate.promise
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'one' })
    await runner.enqueue('news-refresh', { bucket: 'two' })
    await Promise.resolve()
    const stopped = runner.stop({ timeoutMs: 5000 })
    gate.resolve()
    await stopped
    expect(ran).toEqual(['one'])
    expect(fake.markCompleted).toHaveBeenCalledTimes(1)
  })

  it('stop() 超時仍 resolve，該 row 不動', async () => {
    const fake = createFakeAudit()
    const never = deferred()
    const runner = makeRunner({
      audit: fake.repo,
      handlers: handlersWith({
        'news-refresh': (async () => {
          await never.promise
          return { resultRef: 'r' }
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    const { auditId } = await runner.enqueue('news-refresh', { bucket: 'b' })
    await Promise.resolve()
    await runner.stop({ timeoutMs: 10 })
    expect(fake.markCompleted).not.toHaveBeenCalled()
    expect(fake.markFailed).not.toHaveBeenCalled()
    expect(fake.rows.get(auditId)?.status).toBe('active')
    never.resolve()
  })

  it('stop() 之後 backoff 到期的 requeue 不得再啟動 handler', async () => {
    const fake = createFakeAudit()
    const releaseSleep = deferred()
    let calls = 0
    const runner = makeRunner({
      audit: fake.repo,
      sleep: async () => {
        await releaseSleep.promise
      },
      handlers: handlersWith({
        'news-refresh': (async () => {
          calls++
          throw new Error('boom')
        }) as unknown as JobHandler<never>,
      }),
    })
    runner.start()
    await runner.enqueue('news-refresh', { bucket: 'b' })
    await vi.waitFor(() => expect(runner.stats()['news-refresh']).toMatchObject({ waiting: 1 }))
    await runner.stop({ timeoutMs: 50 })
    releaseSleep.resolve()
    await new Promise(r => setTimeout(r, 20))
    expect(calls).toBe(1)
  })
})

describe('stats', () => {
  it('回報全部 kind', async () => {
    const fake = createFakeAudit()
    const runner = makeRunner({ audit: fake.repo })
    expect(Object.keys(runner.stats()).sort()).toEqual([...JOB_KINDS].sort())
  })
})
