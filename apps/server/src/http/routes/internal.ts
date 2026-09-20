import type { EnqueueFn, JobKind, RawPayloadByKind } from '@suanomics/jobs'
import process from 'node:process'
import { PAYLOAD_SCHEMA_BY_KIND } from '@suanomics/jobs'
import { Hono } from 'hono'
import { safeEqual } from '../safe-equal.js'

export interface InternalRouteDeps {
  enqueue: EnqueueFn
}

// 這裡刻意沒有「今天」——報告日是台北曆日，而本檔若自己補一個會是 UTC 曆日。
// 若排程跑在 21:10 UTC ＝ 前一個 UTC 曆日、卻是台北的當日 05:10，兩者差一天。
// 缺 date／bucket 是呼叫端的 bug，一律 422 由 schema 擋下；不要在這一層貼心補起來。

interface EnqueueRouteSpec<K extends JobKind> {
  path: string
  kind: K
}

/**
 * enqueue 型 route 的共同骨架：驗 body → enqueue → 回 202 + pollUrl。
 *
 * schema 不由呼叫端指定而是查 `PAYLOAD_SCHEMA_BY_KIND`——runner 的 `enqueue` 用的就是
 * 同一張表，兩邊各指一份 schema 的話，route 放行的 payload 可能在 enqueue 邊界被第二次
 * parse 打回，而那時已經回過 202 了。
 *
 * 兩層驗證本身是刻意的：route 這層負責把驗證失敗翻成 HTTP 422，`enqueue` 那層是
 * 邊界的最後防線（它 throw，對 HTTP 呼叫端會變成 500）。
 */
function registerEnqueueRoute<K extends JobKind>(
  route: Hono,
  enqueue: EnqueueFn,
  spec: EnqueueRouteSpec<K>,
): void {
  route.post(spec.path, async (c) => {
    // 解析不出 JSON 就當場 422，不要退成 `{}` 交給 schema 判。
    // 退成 `{}` 的話，「壞掉的 body 會被擋下」這件事就變成 schema 有沒有必填欄位的
    // 副產物：今天六個 route 都有必填欄位所以碰巧安全，哪天有人把某個 schema 放寬成
    // 全 optional（corpus-refresh 就是），壞 body 會靜默變成 202 加一個空 payload 的 job。
    const raw = await c.req.json().catch(() => null)
    if (raw === null) {
      c.status(422)
      return c.json({ error: 'invalid json' })
    }
    const parsed = PAYLOAD_SCHEMA_BY_KIND[spec.kind].safeParse(raw)
    if (!parsed.success) {
      c.status(422)
      return c.json({ error: 'invalid body', issues: parsed.error.issues })
    }
    const res = await enqueue(spec.kind, parsed.data as RawPayloadByKind[K])
    c.status(202)
    return c.json({ ...res, pollUrl: `/api/jobs/${res.auditId}` })
  })
}

export function createInternalRoute(deps: InternalRouteDeps) {
  const { enqueue } = deps
  const route = new Hono()

  route.use('/*', async (c, next) => {
    if (process.env.NODE_ENV === 'development')
      return next()
    const secret = process.env.INGEST_TRIGGER_SECRET
    const auth = c.req.header('authorization')
    if (!auth) {
      c.status(401)
      return c.json({ error: 'missing authorization' })
    }
    const token = auth.replace(/^Bearer\s+/i, '')
    // constant-time 比較：避免逐字元 `!==` 的比較耗時洩漏「猜對前幾碼」的側信道。
    if (!secret || !safeEqual(token, secret)) {
      c.status(403)
      return c.json({ error: 'invalid secret' })
    }
    return next()
  })

  // 逐行明寫而不是對一張表跑迴圈：迴圈會把 kind 推成 union，enqueue 的
  // `RawPayloadByKind[K]` 就跟著垮成 union、得靠 cast 補回來。七行換零 cast 划算。
  registerEnqueueRoute(route, enqueue, { path: '/corpus/refresh', kind: 'corpus-refresh' })
  // HTTP trigger for daily-brief generation
  // 用途：(1) acceptance run 從 prod 觸發、不依賴託管平台的 CLI gateway
  //       (2) 排程一律走 HTTP trigger 這個 pattern，不論排程者用什麼 scheduler
  // body: { date: string, chainPodcast?: boolean }（YYYY-MM-DD 台北曆日、必填）
  registerEnqueueRoute(route, enqueue, { path: '/brief/enqueue', kind: 'daily-brief' })
  // P2 endpoints
  registerEnqueueRoute(route, enqueue, { path: '/news/refresh', kind: 'news-refresh' })
  registerEnqueueRoute(route, enqueue, { path: '/podcast/generate', kind: 'podcast-generate' })
  registerEnqueueRoute(route, enqueue, { path: '/podcast/tts', kind: 'podcast-tts' })
  // P3：HTTP trigger for prompt-refresh job
  // body: { bucket: string, sources?: SourceSpec[] }（bucket 必填、daily granularity YYYY-MM-DD）
  // 跑頻率低（非 hourly）、bucket 取 10 chars daily；news-refresh 是 hourly (13 chars)
  registerEnqueueRoute(route, enqueue, { path: '/prompt-research/refresh', kind: 'prompt-refresh' })
  // HTTP trigger for market-data-refresh job
  // body: { bucket: string }（bucket 必填、daily granularity YYYY-MM-DD）
  // 跑頻率低（每日一次）、bucket 取 10 chars daily；同 prompt-research pattern
  registerEnqueueRoute(route, enqueue, { path: '/market-data/refresh', kind: 'market-data-refresh' })

  return route
}
