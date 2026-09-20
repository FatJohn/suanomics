import { z } from 'zod'

export const JOB_KINDS = [
  'corpus-refresh',
  'analyze',
  'daily-brief',
  'podcast-generate',
  'podcast-tts',
  'news-refresh',
  'prompt-refresh',
  'market-data-refresh',
] as const
export type JobKind = (typeof JOB_KINDS)[number]

export const CorpusRefreshPayloadSchema = z.object({
  sourceSlugs: z.array(z.string()).optional(),
  force: z.boolean().optional().default(false),
})

export const AnalyzePayloadSchema = z.object({
  title: z.string().trim().min(3).max(300),
  content: z.string().trim().min(20).max(10_000),
  url: z.string().url().optional(),
  // optional：若是從 daily brief 列表點進來、串著 news_items.id、analyses 寫 row
  // 時帶上、之後 GET /api/brief/news/:id 才查得到對應 analysis
  newsItemId: z.number().int().positive().optional(),
  // 這則分析屬於哪一個報告日（台北曆日）。必填、由生產者決定：
  // 互動請求（`POST /api/brief/analyze`）用當下台北日；每日 brief 的預跑用該份 brief 的 date，
  // 這樣重生舊報告時預跑分析會掛回那一天、而不是掛到重生的當天。
  // 它會流進 EvidenceClaim 的 asOf，所以不能讓 agent 自己用 `new Date()` 現算。
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date yyyy-mm-dd'),
})

export const DailyBriefPayloadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date yyyy-mm-dd'),
  // 自動 chain podcast-generate；debug 時可關
  chainPodcast: z.boolean().optional().default(true),
})

export const PodcastGeneratePayloadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date yyyy-mm-dd'),
  force: z.boolean().optional().default(false),
})

export const PodcastTtsPayloadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date yyyy-mm-dd'),
})

// bucket 是純去重字串（只是長得像日期）、worker 從不消費它。改必填的理由不是語意，
// 而是「誰決定時間」：由呼叫端算好傳進來，中間層不得自己補一個「現在」。
export const NewsRefreshPayloadSchema = z.object({
  bucket: z.string().min(1),
})

export const MarketDataRefreshPayloadSchema = z.object({
  bucket: z.string().min(1),
})

export const PROMPT_REFRESH_JOB_KIND = 'prompt-refresh' as const

export const SourceSpecSchema = z.object({
  kind: z.enum(['yt-transcript', 'skill-markdown', 'custom-text', 'podcast-rss']),
  slug: z.string().min(1),
  displayName: z.string().min(1),
  pipeline: z.enum(['light', 'deep']).default('light'),
  config: z.record(z.string(), z.unknown()),
})
export type SourceSpec = z.infer<typeof SourceSpecSchema>

export const PromptRefreshPayloadSchema = z.object({
  sources: z.array(SourceSpecSchema).optional(),
  bucket: z.string().min(1),
})

export interface JobPayloadByKind {
  'corpus-refresh': z.infer<typeof CorpusRefreshPayloadSchema>
  'analyze': z.infer<typeof AnalyzePayloadSchema>
  'daily-brief': z.infer<typeof DailyBriefPayloadSchema>
  'podcast-generate': z.infer<typeof PodcastGeneratePayloadSchema>
  'podcast-tts': z.infer<typeof PodcastTtsPayloadSchema>
  'news-refresh': z.infer<typeof NewsRefreshPayloadSchema>
  'prompt-refresh': z.infer<typeof PromptRefreshPayloadSchema>
  'market-data-refresh': z.infer<typeof MarketDataRefreshPayloadSchema>
}

export const PAYLOAD_SCHEMA_BY_KIND = {
  'corpus-refresh': CorpusRefreshPayloadSchema,
  'analyze': AnalyzePayloadSchema,
  'daily-brief': DailyBriefPayloadSchema,
  'podcast-generate': PodcastGeneratePayloadSchema,
  'podcast-tts': PodcastTtsPayloadSchema,
  'news-refresh': NewsRefreshPayloadSchema,
  'prompt-refresh': PromptRefreshPayloadSchema,
  'market-data-refresh': MarketDataRefreshPayloadSchema,
// eslint-disable-next-line ts/no-explicit-any -- z.ZodType requires an output type parameter; `unknown` breaks the satisfies constraint because ZodType<unknown> ≠ ZodType<OutputType>
} as const satisfies { [K in JobKind]: z.ZodType<any> }

export interface EnqueueResult {
  auditId: string // background_jobs.id (uuid) — route 用這個做 pollUrl
  status: 'queued' | 'already-inflight' | 'already-completed' // already-completed：同 payload 在結果快取窗內已完成
  resultRef?: string | null // 只在 already-completed 時帶上
}

// runner 的重試預設，值沿用 2026-09-04 改成單一 process 之前那套佇列設定（3 次、5 秒起的
// exponential backoff）。這不是可有可無的預設值：2026-07-29 有實績——首次 attempt 丟
// `This operation was aborted`，報告是靠重試補上的。
export const JOB_RETRY_DEFAULTS = { attempts: 3, backoffMs: 5000 } as const

export const JOB_STATUSES = ['queued', 'active', 'completed', 'failed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

// 同 payload 的 completed audit row 在這個視窗內、enqueue 直接回 already-completed 而不重跑。
// 2026-09-04 之前這個值還得跟外部佇列保留完成紀錄的時間對齊（那份紀錄沒過期之前，同 id 的
// 排入會被靜默去重）；現在它只剩「多久以內算跑過了」這一個意思，也不再需要秒／毫秒兩個變體。
export const JOB_RESULT_CACHE_AGE_MS = 24 * 60 * 60 * 1000

// 一個 kind 的 inflight row 過了多久就該當成孤兒（跑它的 process 被 kill 留下的殘骸）。
//
// 原本這是一個全域的 5 分鐘常數，註解寫著「真正在跑的 job 不可能 5 分鐘還沒進
// active->completed」——那個前提對這個 repo 的長跑 kind 從來不成立，於是 enqueue 的
// already-inflight 去重在絕大部分執行時段裡形同虛設。
//
// 值取自 2026-08-22 對 prod background_jobs 的量測（90 天內 completed row 的
// completed_at - started_at）：
//
//   kind                  n    p50     p95      max
//   news-refresh         49   632s   1704s   2060s (34m)
//   corpus-refresh        1      —       —   1515s (25m)   ← 排程觸發到 2026-08-22 才開始留 row
//   daily-brief          44   255s    363s    366s (6m)
//   podcast-tts          37    65s    149s    346s (6m)
//   analyze             276    38s    122s    185s (3m)
//   market-data-refresh  35    13s    120s    167s (3m)
//   podcast-generate     38    30s     66s     68s (1m)
//   prompt-refresh        0      —       —       —         ← 90 天內零筆完成，無數據
//
// 取值規則：明顯大於實測最大值再往上取整到好記的數字，實際倍率 2.6x（news-refresh、
// corpus-refresh）到 13x（podcast-generate）不等——短 kind 的絕對值太小，硬套固定倍率
// 會讓窗短到沒有緩衝，所以下限壓在 15 分鐘。**不能只調成一個大數字**——窗開太大，
// 被 kill 留下的孤兒 row 會從「髒資料」變成「功能鎖」（同 payload 從此打不進去）。所以
// 這張表要跟 findInflight 內建的回收一起看：窗負責「合理的執行時間」，回收負責
// 「過了窗的殘骸要被標成 failed、不要卡著」。server 開機另有無條件的 failAllInflight()，
// 它不看窗——開機當下的 inflight row 必然是上一次執行的殘骸。
//
export const JOB_INFLIGHT_STALENESS_MS: Record<JobKind, number> = {
  'corpus-refresh': 90 * 60 * 1000,
  'analyze': 15 * 60 * 1000,
  'daily-brief': 30 * 60 * 1000,
  'podcast-generate': 15 * 60 * 1000,
  'podcast-tts': 20 * 60 * 1000,
  'news-refresh': 90 * 60 * 1000,
  // 無實測樣本。distill+compile 可能 5-20 分鐘，取 3 倍。
  'prompt-refresh': 60 * 60 * 1000,
  'market-data-refresh': 15 * 60 * 1000,
}
