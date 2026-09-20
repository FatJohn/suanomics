import type { EnqueueFn } from '@suanomics/jobs'
import type { Context } from 'hono'
import type { RateLimitCheckResult, RateLimiter } from '../rate-limit.js'
import { getAnalysisById } from '@suanomics/db/repos/analyses-repo'
import {
  getDailyBriefByDate,
  getLatestAnalysis,
  getLatestDailyBrief,
  getNewsItemById,
  getNewsItemsByIds,
  listDailyBriefDates,
} from '@suanomics/db/repos/news-repo'
import { PODCAST_AUDIO_EXT } from '@suanomics/db/storage/podcast-audio-format'
import { taipeiDateOf } from '@suanomics/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { clientKeyOf } from '../client-key.js'

// 502 detail 截斷上限、避免把內部堆疊 / 冗長訊息完整外露
const DETAIL_MAX_LEN = 200

// global 層固定用同一把 key——它就是要無視「誰打的」，只看「這個端點總共被打了幾次」。
const ANALYZE_GLOBAL_RATE_LIMIT_KEY = 'global'

interface AnalyzeRateLimiters {
  perClient: RateLimiter
  global: RateLimiter
}

export interface BriefRouteDeps {
  enqueue: EnqueueFn
  // 未傳時（例如既有測試）行為與限流加入前完全相同：對 analyze 一律放行。
  analyzeLimiter?: AnalyzeRateLimiters
}

function rateLimitedResponse(c: Context, result: RateLimitCheckResult): Response {
  c.header('Retry-After', String(result.retryAfterSec))
  c.status(429)
  // detail 是給人看的：前端的 useAnalyzeJob 會優先把 body.detail 顯示成錯誤訊息。
  return c.json({
    error: 'rate_limited',
    detail: `請求過於頻繁，請於 ${result.retryAfterSec} 秒後再試`,
    retryAfterSec: result.retryAfterSec,
  })
}

/**
 * 兩層限流：先查每個客戶端各自的額度，再查全域額度。
 *
 * 先查 perClient、perClient 不通過就直接回擋——不會再去消耗 global 的額度。
 * global 層存在的理由：`clientKeyOf` 用的客戶端識別（IP 或轉發來的 XFF）可以被
 * 偽造、或者一大群使用者剛好落在同一個出口 IP／proxy 後面，這種情況下 perClient
 * 那層形同虛設，global 才是「這個端點一小時內總共會排出幾個會呼叫 LLM 的 job」
 * 的硬上界。
 */
function checkAnalyzeRateLimit(c: Context, limiters: AnalyzeRateLimiters | undefined): Response | null {
  if (!limiters)
    return null
  const perClientResult = limiters.perClient.check(clientKeyOf(c))
  if (!perClientResult.allowed)
    return rateLimitedResponse(c, perClientResult)
  const globalResult = limiters.global.check(ANALYZE_GLOBAL_RATE_LIMIT_KEY)
  if (!globalResult.allowed)
    return rateLimitedResponse(c, globalResult)
  return null
}

const AnalyzeBodySchema = z.object({
  newsItemId: z.number().int().positive().optional(),
  // ad-hoc paste
  title: z.string().trim().min(3).max(300).optional(),
  content: z.string().trim().min(20).max(10_000).optional(),
  url: z.string().url().optional(),
}).refine(v => v.newsItemId !== undefined || (v.title !== undefined && v.content !== undefined), {
  message: 'either newsItemId or (title+content) required',
})

// `claimLedger` 是 provenance／稽核資料，讀者面一個欄位都不渲染，
// 但它會讓 briefJson 顯著變大——2026-08-08 實測：現行 66 KB，182 條 claim 的 ledger
// 未去重約 53 KB，等於 +80%。體積主要來自 claim 文字與 JSON 結構本身（citation url 只佔 15%），
// 所以砍欄位省不了多少，該做的是不要送給不需要它的人。
// 它落地是為了讓 narrative 的 claimIds 事後解得回來、以及稽核，
// 那兩個讀取者走 /api/ops 或直接讀 DB，都不經這條路由。
// narrative 的 `claimIds` 指向的正是上面剝掉的那份 ledger，原樣送出去就是一串讀者面
// 解不回任何東西的懸空引用。清成 `[]` 而不是 delete：`NarrativeSection.claimIds` 型別上必填，
// 而 web 收 briefJson 走的是 `as MarketBrief` 的 cast、不經 Zod parse（`.default([])` 不會補），
// delete 會留下「型別說有、runtime 沒有」的坑給第一個讀它的人。
function stripAuditFields(briefJson: unknown): unknown {
  if (briefJson === null || typeof briefJson !== 'object' || Array.isArray(briefJson))
    return briefJson
  const rest = { ...briefJson as Record<string, unknown> }
  delete rest.claimLedger
  const narrative = rest.narrative
  if (narrative !== null && typeof narrative === 'object' && !Array.isArray(narrative)) {
    const n = narrative as Record<string, unknown>
    if (Array.isArray(n.sections)) {
      rest.narrative = {
        ...n,
        sections: n.sections.map(s =>
          s !== null && typeof s === 'object' && !Array.isArray(s) && Array.isArray((s as Record<string, unknown>).claimIds)
            ? { ...s as Record<string, unknown>, claimIds: [] }
            : s,
        ),
      }
    }
  }
  return rest
}

export function createBriefRoute(deps: BriefRouteDeps) {
  const { enqueue, analyzeLimiter } = deps
  const briefRoute = new Hono()

  // route 從 sync inline 改 async enqueue 202、job runner 跑 pipeline。
  // newsItemId path 也走 enqueue（從 DB 取 title/content/url 後一律 enqueue）。
  briefRoute.post('/brief/analyze', async (c) => {
    // 限流放在最前面、連 body 都還沒解析就檢查：這個端點的成本不是「解析成功」
    // 而是「排進佇列後遲早會被 job runner 拿去打 LLM」，越早擋越省。
    const limited = checkAnalyzeRateLimit(c, analyzeLimiter)
    if (limited)
      return limited

    const body = await c.req.json().catch(() => null)
    const parsed = AnalyzeBodySchema.safeParse(body)
    if (!parsed.success)
      return c.json({ error: 'invalid_input', detail: parsed.error.issues[0]?.message ?? '' }, 400)

    try {
      let title: string
      let content: string
      let url: string | undefined

      if (parsed.data.newsItemId !== undefined) {
        const item = await getNewsItemById(parsed.data.newsItemId)
        if (!item)
          return c.json({ error: 'not_found' }, 404)
        title = item.title
        content = item.contentText ?? item.title
        url = item.url
      }
      else {
        // refine 已保證 newsItemId 缺席時 title + content 同在
        const data = parsed.data
        if (data.title === undefined || data.content === undefined)
          return c.json({ error: 'invalid_input', detail: 'title and content required' }, 400)
        title = data.title
        content = data.content
        if (data.url)
          url = data.url
      }

      const enqueueRes = await enqueue('analyze', {
        title,
        content,
        // 互動路徑的報告日產生點：使用者當下要求分析，那一天就是這則分析所屬的日子。
        // 在這裡算好往下傳，worker 與 agent 才不需要（也不能）自己現算。
        reportDate: taipeiDateOf(new Date()),
        ...(url ? { url } : {}),
        ...(parsed.data.newsItemId !== undefined ? { newsItemId: parsed.data.newsItemId } : {}),
      })
      c.status(202)
      return c.json({ ...enqueueRes, pollUrl: `/api/jobs/${enqueueRes.auditId}` })
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      console.error('[brief/analyze] failed:', message, stack)
      const safeDetail = message.length > DETAIL_MAX_LEN ? `${message.slice(0, DETAIL_MAX_LEN)}…` : message
      return c.json({ error: 'enqueue_failed', detail: safeDetail }, 503)
    }
  })

  // worker 寫完 audit 後 resultRef='analyses/<id>'、frontend 拿 id 取 payload
  briefRoute.get('/brief/analyses/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: 'invalid_input' }, 400)
    const row = await getAnalysisById(id)
    if (!row)
      return c.json({ error: 'not_found' }, 404)
    return c.json(row.payload, 200)
  })

  briefRoute.get('/brief/news/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: 'invalid_input' }, 400)
    const item = await getNewsItemById(id)
    if (!item)
      return c.json({ error: 'not_found' }, 404)
    const latest = await getLatestAnalysis(id)
    return c.json({ item, analysis: latest?.payload ?? null }, 200)
  })

  briefRoute.get('/brief/daily', async (c) => {
    const latest = await getLatestDailyBrief()
    if (!latest)
      return c.json({ brief: null, items: [] }, 200)
    const items = await getNewsItemsByIds(latest.selectedNewsIds)
    // briefJson 含完整 MarketBrief（narrative / cascadeChains / 等）
    // 舊 row 沒這欄、return null、frontend 走 v-if 隱 narrative section
    return c.json({
      brief: {
        briefDate: latest.briefDate,
        summary: latest.summary,
        briefJson: stripAuditFields(latest.briefJson ?? null),
        podcastJson: latest.podcastJson ?? null,
        audioUrl: latest.podcastAudioPath ? `/audio/podcast/${latest.briefDate}.${PODCAST_AUDIO_EXT}` : null,
      },
      items,
    }, 200)
  })

  briefRoute.get('/brief/dates', async (c) => {
    const dates = await listDailyBriefDates()
    return c.json({ dates }, 200)
  })

  briefRoute.get('/brief/by-date/:date', async (c) => {
    const date = c.req.param('date')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return c.json({ error: 'invalid_date_format' }, 400)
    const row = await getDailyBriefByDate(date)
    if (!row)
      return c.json({ brief: null, items: [] }, 200)
    const items = await getNewsItemsByIds(row.selectedNewsIds)
    return c.json({
      brief: {
        briefDate: row.briefDate,
        summary: row.summary,
        briefJson: stripAuditFields(row.briefJson ?? null),
        podcastJson: row.podcastJson ?? null,
        audioUrl: row.podcastAudioPath ? `/audio/podcast/${row.briefDate}.${PODCAST_AUDIO_EXT}` : null,
      },
      items,
    }, 200)
  })

  return briefRoute
}
