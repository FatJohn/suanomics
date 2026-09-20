import type {
  JobCtx,
  JobOutcome,
  JobRunner,
  JobRunnerOptions,
  JobRunnerStats,
  RawPayloadByKind,
} from './runner-types.js'
import type { EnqueueResult, JobKind, JobPayloadByKind } from './types.js'
import { hashJobPayload } from './payload-hash.js'
import { JOB_KINDS, JOB_RETRY_DEFAULTS, PAYLOAD_SCHEMA_BY_KIND } from './types.js'

const STOP_TIMEOUT_MS = 30_000
const ERROR_MESSAGE_MAX = 2000

interface QueueEntry {
  kind: JobKind
  payload: unknown
  auditId: string
  attempt: number
}

interface KindState {
  concurrency: number
  pending: QueueEntry[]
  /** backoff 中：既不在 pending 也不在 active，漏算它 drain() 會提早 resolve。 */
  waiting: number
  active: number
}

/**
 * 同一 process 內用 Map 排隊同 key 的 enqueue request、避免兩個併發呼叫都查不到 inflight
 * 而各插一筆 row。單 process 之後這就是唯一的 idempotency 閘（DB 沒有 unique index）。
 */
function createInProcessLock(): { acquire: (key: string) => Promise<() => void> } {
  const locks = new Map<string, Promise<void>>()
  return {
    acquire: async (key) => {
      while (locks.has(key)) await locks.get(key)
      let release!: () => void
      const p = new Promise<void>((res) => {
        release = res
      })
      locks.set(key, p)
      return () => {
        release()
        locks.delete(key)
      }
    },
  }
}

const realSleep = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms))

export function createJobRunner(opts: JobRunnerOptions): JobRunner {
  const { audit, handlers } = opts
  const retry = opts.retry ?? JOB_RETRY_DEFAULTS
  const sleep = opts.sleep ?? realSleep
  const log = opts.log ?? console
  const lock = createInProcessLock()

  const states = new Map<JobKind, KindState>()
  for (const kind of JOB_KINDS)
    states.set(kind, { concurrency: 1, pending: [], waiting: 0, active: 0 })
  for (const spec of opts.specs) {
    const state = states.get(spec.kind)
    if (state)
      state.concurrency = spec.concurrency
  }

  let started = false
  let stopped = false
  /** enqueue 的 audit.insert 還沒回來的那段空窗也算「有事在做」，否則 drain() 會從中間穿過去。 */
  let enqueuesInFlight = 0
  const idleWaiters: Array<() => void> = []
  /** stop() 只等 active 收尾，不等 pending——被 stop 擋下的 pending 留給開機回收。 */
  const activeDrainedWaiters: Array<() => void> = []

  const stateOf = (kind: JobKind): KindState => {
    const s = states.get(kind)
    if (!s)
      throw new Error(`unknown job kind: ${kind}`)
    return s
  }

  const isIdle = (): boolean => enqueuesInFlight === 0
    && [...states.values()].every(s => s.pending.length === 0 && s.waiting === 0 && s.active === 0)

  const noneActive = (): boolean => [...states.values()].every(s => s.active === 0)

  const settle = (): void => {
    if (noneActive()) {
      while (activeDrainedWaiters.length > 0) activeDrainedWaiters.pop()?.()
    }
    if (!isIdle())
      return
    while (idleWaiters.length > 0) idleWaiters.pop()?.()
  }

  function makeCtx(entry: QueueEntry): JobCtx {
    let lastProgress = ''
    return {
      auditId: entry.auditId,
      attempt: entry.attempt,
      markMetadata: partial => audit.markMetadata(entry.auditId, partial),
      enqueue: (kind, payload) => enqueue(kind, payload),
      updateProgress: async (percent, stage) => {
        const key = `${percent}|${stage ?? ''}`
        if (key === lastProgress)
          return
        lastProgress = key
        const progress = stage === undefined ? { percent } : { percent, stage }
        // 進度不是業務結果：寫不進去就別讓工作倒。
        try {
          await audit.markMetadata(entry.auditId, { progress })
        }
        catch (err) {
          log.warn(`[runner] ${entry.kind} progress write failed:`, err)
        }
      },
    }
  }

  function scheduleRetry(entry: QueueEntry): void {
    const state = stateOf(entry.kind)
    state.waiting++
    const delayMs = retry.backoffMs * 2 ** (entry.attempt - 1)
    // 失敗後**不在 slot 裡等**：先釋放 slot（由 run 的 finally 做），backoff 只掛在 waiting，
    // 這樣一則 analyze 失敗不會把後面整批 fan-out 拖住 5 到 15 秒。
    void sleep(delayMs).then(() => {
      if (stopped) {
        state.waiting--
        settle()
        return
      }
      // 回到該 kind 佇列**前端**：重試比後面排隊的新 job 優先。
      state.pending.unshift({ ...entry, attempt: entry.attempt + 1 })
      state.waiting--
      pump(entry.kind)
      settle()
    })
  }

  async function run(entry: QueueEntry): Promise<void> {
    const state = stateOf(entry.kind)
    try {
      await audit.markActive(entry.auditId)
      const handler = handlers[entry.kind] as unknown as (payload: unknown, ctx: JobCtx) => Promise<JobOutcome>
      const outcome = await handler(entry.payload, makeCtx(entry))
      await audit.markCompleted(entry.auditId, {
        resultRef: outcome.resultRef,
        ...(outcome.metadata ? { metadata: outcome.metadata } : {}),
      })
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (entry.attempt < retry.attempts) {
        // 中途 attempt 失敗**不寫 audit**：寫了輪詢方會看到 status:failed 而放棄，
        // 但報告其實會由重試補上（2026-07-29 的假告警就是這個形狀）。
        log.warn(`[runner] ${entry.kind} attempt ${entry.attempt} failed, will retry:`, msg)
        scheduleRetry(entry)
      }
      else {
        log.error(`[runner] ${entry.kind} failed after ${entry.attempt} attempt(s):`, msg)
        await audit.markFailed(entry.auditId, msg.slice(0, ERROR_MESSAGE_MAX)).catch((e: unknown) => {
          log.error(`[runner] ${entry.kind} markFailed write failed:`, e)
        })
      }
    }
    finally {
      state.active--
      pump(entry.kind)
      settle()
    }
  }

  function pump(kind: JobKind): void {
    if (!started || stopped)
      return
    const state = stateOf(kind)
    while (state.active < state.concurrency && state.pending.length > 0) {
      const entry = state.pending.shift()
      if (!entry)
        return
      state.active++
      void run(entry)
    }
  }

  // 函式宣告而非 const：makeCtx 在它上面就要引用它（handler 的 ctx.enqueue），
  // 兩者互相依賴，靠 hoisting 打斷這個順序問題。
  async function enqueue<K extends JobKind>(kind: K, rawPayload: RawPayloadByKind[K]): Promise<EnqueueResult> {
    enqueuesInFlight++
    try {
      const payload = PAYLOAD_SCHEMA_BY_KIND[kind].parse(rawPayload) as JobPayloadByKind[typeof kind]
      const payloadHash = hashJobPayload(payload)
      const release = await lock.acquire(`${kind}-${payloadHash}`)
      try {
        const inflight = await audit.findInflight(kind, payloadHash)
        if (inflight?.id)
          return { auditId: inflight.id, status: 'already-inflight' }
        const recentDone = await audit.findRecentCompleted(kind, payloadHash)
        if (recentDone?.id) {
          return {
            auditId: recentDone.id,
            status: 'already-completed',
            resultRef: recentDone.resultRef ?? null,
          }
        }
        const auditId = await audit.insert({ jobKind: kind, payloadHash })
        stateOf(kind).pending.push({ kind, payload, auditId, attempt: 1 })
        pump(kind)
        return { auditId, status: 'queued' }
      }
      finally {
        release()
      }
    }
    finally {
      enqueuesInFlight--
    }
  }

  return {
    enqueue,
    start: () => {
      started = true
      for (const kind of JOB_KINDS) pump(kind)
    },
    stop: async (stopOpts) => {
      stopped = true
      const timeoutMs = stopOpts?.timeoutMs ?? STOP_TIMEOUT_MS
      if (noneActive())
        return
      await new Promise<void>((resolve) => {
        // 這裡刻意用真的 setTimeout 而不是注入的 sleep：注入的 fake 在測試裡會立刻 resolve，
        // 那會讓「等 active 收尾」的語意在測試中永遠走成逾時。backoff 才需要可注入的時鐘。
        const timer = setTimeout(() => {
          const i = activeDrainedWaiters.indexOf(onDrained)
          if (i >= 0)
            activeDrainedWaiters.splice(i, 1)
          resolve()
        }, timeoutMs)
        function onDrained(): void {
          clearTimeout(timer)
          resolve()
        }
        activeDrainedWaiters.push(onDrained)
        settle()
      })
    },
    drain: () => new Promise<void>((resolve) => {
      idleWaiters.push(resolve)
      settle()
    }),
    stats: () => {
      const out = {} as Record<JobKind, JobRunnerStats>
      for (const kind of JOB_KINDS) {
        const s = stateOf(kind)
        out[kind] = { pending: s.pending.length, waiting: s.waiting, active: s.active }
      }
      return out
    },
  }
}
