import type { ArticlesRepo } from '@suanomics/db/repos/articles-repo'
import type { DispatchInput } from '../../corpus/dispatcher.js'
import type { FetchedEntry } from '../../corpus/sources/rss.js'
import { getDb } from '@suanomics/db/client'
import { createArticlesRepo } from '@suanomics/db/repos/articles-repo'
import { externalSources } from '@suanomics/db/schema'
import { ExternalSourceSeedSchema } from '@suanomics/db/seed-external-sources'
import { hasBodyBeyondTitle } from '@suanomics/shared'
import { eq } from 'drizzle-orm'
import { pMap } from '../../_p-map.js'
import { hashArticleContent } from '../../corpus/content-hash.js'
import { dispatchFetch } from '../../corpus/dispatcher.js'
import { enrichEntitySummary } from '../../corpus/entity-summary.js'
import { canonicalizeUrl, hashCanonicalUrl } from '../../corpus/url-canonical.js'

// 並行處理 source 的上限。corpus-refresh concurrency=2 是 job 層的，這裡是
// **單一 job 內部** source 拉取的並行度。Source 多為 I/O bound（外部 RSS / scrape）、
// 並行能顯著縮短 daily ingest 時間（15 sources 序列 ~3 min → 並行 ~1 min）。
const SOURCE_FETCH_CONCURRENCY = 2

// I3 fix: config 不再是 opaque Record — 改成 zod-validated typed shape。
// ExternalSourceSeedSchema discriminated union 出的 config 仍是 unknown 子型別、
// 但在 defaultListSources 已通過 safeParse 驗證，對外保持 Record<string, unknown>
// 讓 CorpusWorkerDeps.dispatcher 介面穩定（測試替換用）。
interface SourceRow {
  id: string
  slug: string
  kind: 'rss' | 'html-selector' | 'official-feed'
  config: Record<string, unknown>
}

interface CorpusRefreshPayload {
  sourceSlugs?: string[]
  force?: boolean
}

export interface CorpusRefreshResult {
  insertedCount: number
  skippedCount: number
  reusedEnrichmentCount: number
  enrichmentFailedCount: number
  /**
   * body 沒有超出標題、因此刻意不 enrich 的篇數。
   * 單獨計數而不是併進 skipped——那兩件事的處置完全不同（skipped 是根本沒收進來），
   * 而且這個數字要看得見：它靜默歸零就代表判定失效了、假摘要又開始花錢生產。
   */
  notEnrichableCount: number
  failedSources: string[]
  /**
   * 逐來源明細。上面那些加總**看不出「某一個來源 100% 不可 enrich」**——而那正是
   * 曾經發生過的形狀：`fsc-news` 15 篇全部沒 enrich（於是在 retriever 裡不可達），但在
   * 幾百篇的總數裡它只是一個小數字，`failedSources` 也不會列它（list 端點是成功的）。
   *
   * 這不是新增量測：`processOneSource` 本來就逐來源在數，只是聚合時把 slug 維度丟掉了。
   * 這個陣列會原樣進 `background_jobs.metadata`（index.ts 的 makeMetadata），
   * 事後查得到「那一輪每個來源各自發生什麼」。
   */
  perSource: CorpusSourceTotals[]
}

export interface CorpusSourceTotals extends PerSourceTotals {
  slug: string
}

export interface CorpusWorkerDeps {
  listSources?: (slugs?: string[]) => Promise<SourceRow[]>
  dispatcher?: (input: { id: string, kind: SourceRow['kind'], config: Record<string, unknown> }) => Promise<FetchedEntry[]>
  enricher?: (input: { title: string, body: string }) => Promise<{ failed: boolean, data: { contentSummary: string, entities: Array<{ kind: string, name: string, confidence: number }>, topicTags: string[] } | null, model?: string, costUsd?: number }>
  repo?: ArticlesRepo
  progress?: (pct: number) => void | Promise<void>
  payload: CorpusRefreshPayload
  /** 並行 source 處理上限、預設 SOURCE_FETCH_CONCURRENCY */
  concurrency?: number
}

async function defaultListSources(slugs?: string[]): Promise<SourceRow[]> {
  const db = getDb()
  const rows = await db.select().from(externalSources).where(eq(externalSources.enabled, true))
  const all: SourceRow[] = []
  for (const r of rows) {
    // I3 fix: zod parse at DB boundary，替代 `as unknown as SourceRow`。
    // 驗證失敗代表 DB 資料與 schema 不符（例：kind 不在 enum、config 缺必要欄位），
    // 記 warn 並跳過該 source，避免後續 dispatchFetch 拿到髒資料。
    const parsed = ExternalSourceSeedSchema.safeParse({
      slug: r.slug,
      displayName: r.displayName,
      kind: r.kind,
      tier: r.tier,
      config: r.config,
    })
    if (!parsed.success) {
      console.warn(`[corpus-worker] skipping source slug=${r.slug}: invalid config — ${parsed.error.message}`)
      continue
    }
    all.push({ id: r.id, slug: r.slug, kind: parsed.data.kind, config: parsed.data.config as Record<string, unknown> })
  }
  if (slugs && slugs.length > 0)
    return all.filter(s => slugs.includes(s.slug))
  return all
}

interface PerSourceTotals {
  inserted: number
  skipped: number
  reused: number
  enrichmentFailed: number
  notEnrichable: number
  fetchFailed: boolean
}

// processOneSource 所需的解析後 deps（從 runCorpusRefresh 解構而來）。
interface ProcessOneSourceDeps {
  dispatcher: NonNullable<CorpusWorkerDeps['dispatcher']>
  enricher: NonNullable<CorpusWorkerDeps['enricher']>
  repo: ArticlesRepo
  force: boolean
}

async function processOneSource(src: SourceRow, deps: ProcessOneSourceDeps): Promise<PerSourceTotals> {
  const { dispatcher, enricher, repo, force } = deps
  const totals: PerSourceTotals = { inserted: 0, skipped: 0, reused: 0, enrichmentFailed: 0, notEnrichable: 0, fetchFailed: false }
  let entries: FetchedEntry[]
  try {
    entries = await dispatcher({ id: src.id, kind: src.kind, config: src.config })
  }
  catch (err) {
    console.error(`[corpus] source=${src.slug} fetch failed:`, err)
    totals.fetchFailed = true
    return totals
  }

  for (const e of entries) {
    let canonical: string
    try {
      canonical = canonicalizeUrl(e.url)
    }
    catch {
      totals.skipped++
      continue
    }
    const urlHash = hashCanonicalUrl(canonical)
    if (!force && await repo.isDuplicateUrl(src.id, urlHash)) {
      totals.skipped++
      continue
    }

    // 有些來源的正文要另外一次請求才拿得到（見 FetchedEntry.fetchBody）。位置刻意放在
    // url 去重之後：已經抓過的文章不必為了正文再打一次外部服務。
    // ★ 但 force 路徑會跳過去重（上面的 `!force &&`），那時每一筆都會重抓正文——而
    //   insertArticle 是 onConflictDoNothing，既有列一個欄位都不會更新。也就是
    //   `corpus:refresh --force` 對已存在的文章是純浪費：538 筆的來源要多打 1076 次
    //   外部請求。兩日一次的排程是 force:false（部署者自備的外部排程），不受影響。
    const excerpt = e.excerpt ?? (e.fetchBody ? await e.fetchBody() : null)
    const bodyForHash = excerpt ?? e.title
    const contentHash = hashArticleContent(bodyForHash)

    let enrichment: { contentSummary: string | null, entities: Array<{ kind: string, name: string, confidence: number }>, topicTags: string[] } = { contentSummary: null, entities: [], topicTags: [] }
    let llmModel: string | null = null
    let llmCost: number | null = null
    let reused = false
    let failed = false

    // body 沒有超出標題就不 enrich。Google News 代理的 excerpt 是錨點
    // markup、Fed press_monetary 的 description 逐字等於 title——兩者餵進去只會讓模型
    // 憑標題編一段「摘要」，那段東西再進檢索池當依據。判準與理由見 @suanomics/shared 的 enrichable.ts。
    //
    // 連 enrichment 快取都不查：contentHash 算的是同一份 body，查到的會是別篇文章
    // 依真本文產出的摘要，掛上來等於張冠李戴。
    const enrichable = hasBodyBeyondTitle(e.title, excerpt)

    if (enrichable && contentHash) {
      const cached = await repo.findEnrichmentByContentHash(contentHash)
      if (cached) {
        enrichment = { contentSummary: cached.contentSummary, entities: cached.entities, topicTags: cached.topicTags }
        reused = true
      }
    }

    if (enrichable && !reused) {
      const r = await enricher({ title: e.title, body: excerpt ?? e.title })
      if (r.failed || !r.data) {
        failed = true
      }
      else {
        enrichment = r.data
        // 實際跑的 model 與 llm-wrapper 依 token usage 實算的成本（不再是固定估值）；
        // 注入假 enricher 的測試不帶這兩欄、記 null。
        llmModel = r.model ?? null
        llmCost = r.costUsd ?? null
      }
    }

    await repo.insertArticle({
      sourceId: src.id,
      externalId: e.externalId,
      url: canonical,
      urlHash,
      title: e.title,
      publishedAt: e.publishedAt,
      rawExcerpt: excerpt,
      fullText: null,
      contentHash,
      contentSummary: enrichment.contentSummary,
      entities: enrichment.entities,
      topicTags: enrichment.topicTags,
      llmModel,
      llmCostUsd: llmCost,
    })
    totals.inserted++
    if (reused)
      totals.reused++
    if (failed)
      totals.enrichmentFailed++
    if (!enrichable)
      totals.notEnrichable++
  }
  return totals
}

export async function runCorpusRefresh(deps: CorpusWorkerDeps): Promise<CorpusRefreshResult> {
  const listSources = deps.listSources ?? defaultListSources
  // I3 fix: 驗證移至 DB boundary (defaultListSources ExternalSourceSeedSchema.safeParse)，
  // 此處 cast 是有根據的 narrowing（不再是跳過驗證的 as unknown）。
  // TS 仍需要 unknown 中繼，因為 Record<string, unknown> 與 RssFetchConfig/HtmlSelectorConfig
  // 在結構上不重疊；但實際 runtime 資料已在 defaultListSources 通過 zod 確認。
  const dispatcher = deps.dispatcher ?? (async s => dispatchFetch({ kind: s.kind, config: s.config as unknown as DispatchInput['config'] } as DispatchInput))
  const enricher = deps.enricher ?? (async i => enrichEntitySummary(i))
  const repo = deps.repo ?? createArticlesRepo()
  const reportProgress = deps.progress ?? (() => { /* noop */ })
  const concurrency = deps.concurrency ?? SOURCE_FETCH_CONCURRENCY
  const processDeps: ProcessOneSourceDeps = { dispatcher, enricher, repo, force: deps.payload.force ?? false }

  const sources = await listSources(deps.payload.sourceSlugs)
  const failedSources: string[] = []
  let completedSources = 0

  await reportProgress(0)

  // pMap 並行跑、每 source 完成獨立 progress tick（順序非 1→n、但比例正確）。
  const perSourceTotals = await pMap(sources, concurrency, async (src): Promise<CorpusSourceTotals> => {
    const t = await processOneSource(src, processDeps)
    if (t.fetchFailed)
      failedSources.push(src.slug)
    completedSources++
    await reportProgress(Math.round((completedSources / sources.length) * 100))
    return { slug: src.slug, ...t }
  })

  // 聚合（JS event loop 確保 += 安全、但 pMap 後再 reduce 更乾淨、無共享 mut state）
  return perSourceTotals.reduce<CorpusRefreshResult>((acc, t) => {
    acc.insertedCount += t.inserted
    acc.skippedCount += t.skipped
    acc.reusedEnrichmentCount += t.reused
    acc.enrichmentFailedCount += t.enrichmentFailed
    acc.notEnrichableCount += t.notEnrichable
    acc.perSource.push(t)
    return acc
  }, { insertedCount: 0, skippedCount: 0, reusedEnrichmentCount: 0, enrichmentFailedCount: 0, notEnrichableCount: 0, failedSources, perSource: [] })
}
