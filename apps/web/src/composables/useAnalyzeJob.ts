import type { MarketBrief } from '@suanomics/shared'
import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export type Stage = 'routing' | 'retrieving' | 'analyzing' | 'saving'
export type RoutingMode = 'cache-hit' | 'db-related' | 'gap-scrape' | 'full-pipeline'
export type Status = 'idle' | 'submitting' | 'polling' | 'completed' | 'failed' | 'cancelled' | 'timeout'

export type ErrorKind = 'network' | 'server' | 'input' | 'timeout' | 'cancelled'

export interface AnalyzeInput {
  title: string
  content: string
  url?: string
}

const STAGE_PERCENT_MAX: Record<Stage, number> = {
  routing: 25,
  retrieving: 55,
  analyzing: 95,
  saving: 100,
}
const POLL_INTERVAL_MS = 2000
const TIMEOUT_MS = 120_000
const CACHE_HIT_FLASH_MS = 500

// 管理 status / error / abort / timeoutTimer 狀態轉換的私有工廠。
// 把 reset / fail / cancel 從 useAnalyzeJob 本體抽出、降行數。
function createStateControls(
  status: ReturnType<typeof ref<Status>>,
  stage: ReturnType<typeof ref<Stage | null>>,
  percent: ReturnType<typeof ref<number>>,
  routingMode: ReturnType<typeof ref<RoutingMode | null>>,
  error: ReturnType<typeof ref<{ kind: ErrorKind, message: string } | null>>,
  result: ReturnType<typeof ref<MarketBrief | null>>,
  auditId: ReturnType<typeof ref<string | null>>,
  ctrl: { abort: AbortController | null, timeoutTimer: ReturnType<typeof setTimeout> | null },
) {
  function reset() {
    status.value = 'idle'
    stage.value = null
    percent.value = 0
    routingMode.value = null
    error.value = null
    result.value = null
    auditId.value = null
    ctrl.abort = null
    if (ctrl.timeoutTimer)
      clearTimeout(ctrl.timeoutTimer)
    ctrl.timeoutTimer = null
  }

  function fail(kind: ErrorKind, message: string) {
    if (ctrl.timeoutTimer)
      clearTimeout(ctrl.timeoutTimer)
    ctrl.abort?.abort()
    error.value = { kind, message }
    status.value = kind === 'timeout'
      ? 'timeout'
      : kind === 'cancelled'
        ? 'cancelled'
        : 'failed'
  }

  function cancel() {
    if (status.value !== 'submitting' && status.value !== 'polling')
      return
    fail('cancelled', '已取消、worker 結果仍會 cache、下次同 input 直接 hit')
  }

  return { reset, fail, cancel }
}

// 處理 pollLoop + fetchResult 的私有工廠。
// 抽出 polling 迴圈邏輯、useAnalyzeJob 只剩協調責任。
function createPoller(
  status: ReturnType<typeof ref<Status>>,
  stage: ReturnType<typeof ref<Stage | null>>,
  percent: ReturnType<typeof ref<number>>,
  routingMode: ReturnType<typeof ref<RoutingMode | null>>,
  result: ReturnType<typeof ref<MarketBrief | null>>,
  ctrl: { abort: AbortController | null, timeoutTimer: ReturnType<typeof setTimeout> | null },
  fail: (kind: ErrorKind, message: string) => void,
) {
  async function fetchResult(resultRef: string, flashCacheHit: boolean) {
    if (ctrl.timeoutTimer)
      clearTimeout(ctrl.timeoutTimer)
    const id = resultRef.replace(/^analyses\//, '')
    const res = await fetch(`${API_BASE}/api/brief/analyses/${id}`)
    if (!res.ok) {
      fail('server', '結果讀取失敗')
      return
    }
    const payload = await res.json() as MarketBrief
    if (flashCacheHit) {
      stage.value = 'saving'
      percent.value = 100
      await new Promise(r => setTimeout(r, CACHE_HIT_FLASH_MS))
    }
    result.value = payload
    status.value = 'completed'
  }

  async function pollLoop(id: string) {
    while (status.value === 'polling') {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      // abort は start() で必ず初期化されてから pollLoop が呼ばれるが、
      // reset() で null に戻る可能性があるため local capture で narrow する
      const localCtrl = ctrl.abort
      if (!localCtrl || localCtrl.signal.aborted)
        return
      let res: Response
      try {
        res = await fetch(`${API_BASE}/api/jobs/${id}`, { signal: localCtrl.signal })
      }
      catch (err) {
        if ((err as Error).name === 'AbortError')
          return
        continue // 網路 transient、下個 tick retry
      }
      if (res.status === 404) {
        fail('server', '任務遺失、請重新提交')
        return
      }
      if (!res.ok)
        continue // 5xx tolerate、下個 tick
      const job = await res.json() as {
        status: string
        stage?: Stage | null
        routingMode?: RoutingMode | null
        progress: number
        resultRef?: string | null
        error?: string | null
      }
      stage.value = job.stage ?? null
      routingMode.value = job.routingMode ?? null
      percent.value = job.stage ? STAGE_PERCENT_MAX[job.stage] : job.progress
      if (job.status === 'completed' && job.resultRef) {
        await fetchResult(job.resultRef, routingMode.value === 'cache-hit')
        return
      }
      if (job.status === 'failed') {
        fail('server', job.error ?? '分析服務暫時忙碌、請稍後再試')
        return
      }
    }
  }

  return { pollLoop, fetchResult }
}

// async polling composable、replace store.analyzePaste
// sync fetch。每次 start() 創新 abortController + timer、最多 120s timeout、
// stage 跳到區段最大值（25/55/95/100）、cache-hit 0.5s flash。
export function useAnalyzeJob() {
  const status = ref<Status>('idle')
  const stage = ref<Stage | null>(null)
  const percent = ref(0)
  const routingMode = ref<RoutingMode | null>(null)
  const error = ref<{ kind: ErrorKind, message: string } | null>(null)
  const result = ref<MarketBrief | null>(null)
  const auditId = ref<string | null>(null)

  // 用 object wrapper 讓子工廠能透過 reference 讀寫 abort / timeoutTimer
  const ctrl: { abort: AbortController | null, timeoutTimer: ReturnType<typeof setTimeout> | null } = {
    abort: null,
    timeoutTimer: null,
  }

  const { reset, fail, cancel } = createStateControls(
    status,
    stage,
    percent,
    routingMode,
    error,
    result,
    auditId,
    ctrl,
  )
  const { pollLoop, fetchResult } = createPoller(
    status,
    stage,
    percent,
    routingMode,
    result,
    ctrl,
    fail,
  )

  async function start(input: AnalyzeInput) {
    reset()
    status.value = 'submitting'
    ctrl.abort = new AbortController()
    ctrl.timeoutTimer = setTimeout(fail, TIMEOUT_MS, 'timeout', '等候逾時、請稍後重試')
    try {
      const res = await fetch(`${API_BASE}/api/brief/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: ctrl.abort.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { detail?: string, error?: string } | null
        fail(res.status >= 500 ? 'server' : 'input', body?.detail ?? body?.error ?? `HTTP ${res.status}`)
        return
      }
      const enq = await res.json() as { auditId: string, status?: string, resultRef?: string | null }
      auditId.value = enq.auditId
      if (enq.status === 'already-completed' && enq.resultRef) {
        await fetchResult(enq.resultRef, /* flashCacheHit */ true)
        return
      }
      status.value = 'polling'
      await pollLoop(enq.auditId)
    }
    catch (err) {
      if ((err as Error).name === 'AbortError')
        return
      fail('network', (err as Error).message)
    }
  }

  return { status, stage, percent, routingMode, error, result, auditId, start, cancel, reset }
}
