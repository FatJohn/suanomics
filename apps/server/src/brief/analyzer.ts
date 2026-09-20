import type { MarketBrief, MarketBriefCitation } from '@suanomics/shared'
import type { AnalystOutput } from '../agents/types.js'
import { createHash } from 'node:crypto'
import { checkCompliance, MarketBriefCitationSchema, MarketBriefDisclaimer, MarketBriefSchema } from '@suanomics/shared'
import { stripViolatingProse } from '../agents/_compliance-strip.js'
import { clampString, truncateAtSentence } from '../agents/_truncate.js'
import { rewriteText } from '../agents/narrative-shared.js'

export type RawAnalysis = MarketBrief

export function hashPrompt(system: string, user: string): string {
  return createHash('sha256').update(`${system}\n\n${user}`).digest('hex').slice(0, 16)
}

// finalizeBriefSafety 的可選觀測出口。閘是純函式、拿不到 audit，所以照這個 repo 既有的
// 慣例（sanitizeAnalystForbiddenPhrases 的 counter、orchestrator 的 metadata）把數字帶回
// 呼叫端，由呼叫端決定要不要寫進 background_jobs.metadata。
export interface BriefSafetyStats {
  droppedCitationUrls: number
}

// citation 的 graceful sentinel URL：這則分析／這天沒有可佐證的外部連結時填它。
// 是**約定值**不是隨手字串——讀者面 isExternalUrl（apps/web/src/lib/url.ts）靠它擋掉
// 「點下去開 data: 頁」。三處會產生 placeholder 的地方（本檔、analyze-worker 的
// db-related、assemble 的日報）必須是同一個字面值，這裡是唯一定義。
export const INSUFFICIENT_CITATION_URL = 'data:insufficient'

// placeholder citation 的唯一產生器。quote 由呼叫端給：不同路徑「為什麼沒有來源」
// 的理由不同，那句話會直接落到讀者面。
export function makeInsufficientCitation(quote: string): MarketBriefCitation {
  return { title: '資料不足', url: INSUFFICIENT_CITATION_URL, quote }
}

export function filterCitationsToAllowedUrls<T extends { citations: readonly { url: string }[] }>(
  raw: T,
  allowed: ReadonlySet<string>,
): T {
  return { ...raw, citations: raw.citations.filter(c => allowed.has(c.url)) } as T
}

export function adaptAnalystToMarketBrief(a: AnalystOutput): MarketBrief {
  if (a.cascadeChains.length === 0)
    throw new Error('analyzer: analyst returned no cascade chains, cannot adapt to MarketBrief')

  const allCitations = a.cascadeChains.flatMap(c => c.citations).slice(0, 5)

  const headline = a.primaryImpact.slice(0, 80) || '單則新聞分析'
  const summaryFull = `${a.primaryImpact}\n${a.reasoning}`
  const summary = summaryFull.length > 300 ? `${summaryFull.slice(0, 297)}...` : summaryFull

  const directionMap: Record<AnalystOutput['cascadeChains'][number]['direction'], 'positive' | 'negative' | 'mixed'> = {
    positive: 'positive',
    negative: 'negative',
    neutral: 'mixed',
  }

  const reasoningChain = a.cascadeChains
    .map(c => `${c.industry}: ${c.mechanism}`.slice(0, 150))
    .slice(0, 6)
  // schema requires min(2); pad if needed
  if (reasoningChain.length < 2)
    reasoningChain.push((a.reasoning.slice(0, 150)) || '依新聞主訴推導')

  return {
    headline,
    summary,
    relatedNews: [],
    affectedIndustries: a.cascadeChains.slice(0, 5).map(c => ({
      name: c.industry,
      direction: directionMap[c.direction],
      confidence: 'medium' as const,
      reasoning: c.mechanism.slice(0, 200),
    })),
    relatedETFs: [],
    reasoningChain,
    citations: allCitations,
    disclaimer: MarketBriefDisclaimer,
    cascadeChains: a.cascadeChains, // pass-through、不折疊
  }
}

// helper：將 AnalystOutput 轉成通過 MarketBriefSchema + L3 gate 的 MarketBrief。
// citation filter + data:insufficient placeholder + checkCompliance gate 抽出供
// worker（db-related mode）與 route（single-news mode）共用、避免 duplication。
export function finalizeAnalystToMarketBrief(
  analyst: AnalystOutput,
  retrievedUrls: string[],
  allowedUrlsBase: ReadonlySet<string>,
  stats?: BriefSafetyStats,
): MarketBrief {
  const brief = adaptAnalystToMarketBrief(analyst)
  const expandedAllowed = new Set([...allowedUrlsBase, ...retrievedUrls])
  const filtered = filterCitationsToAllowedUrls(brief, expandedAllowed)
  const withCitations: MarketBrief = filtered.citations.length > 0
    ? filtered
    : {
        ...filtered,
        citations: [makeInsufficientCitation('此分析基於 Decomposer 推論、7 天內無相關新聞可佐證、citation 不可考')],
      }
  return finalizeBriefSafety(withCitations, stats)
}

// 必填 prose 欄位被合規 strip 清空時的中性代換（headline/summary）。
export const COMPLIANCE_STRIPPED_PLACEHOLDER = '（內容因合規調整已移除）'

// 必填 min(1) 欄位 strip 後清空 → 補中性 placeholder（避免 schema parse 因空字串 throw）。
function stripRequired(s: string): string {
  return stripViolatingProse(s) || COMPLIANCE_STRIPPED_PLACEHOLDER
}

function withOptionalDailyThesis(brief: MarketBrief, candidate: string | undefined): MarketBrief {
  const next = { ...brief }
  delete next.dailyThesis
  const dailyThesis = candidate?.trim()
  if (dailyThesis !== undefined && dailyThesis.length >= 10)
    next.dailyThesis = dailyThesis
  return next
}

// 對 brief 所有 reader-facing prose 欄位做 sentence-strip。
// 必填 min 欄位（headline/summary）清空 → placeholder；reasoningChain（min 2）→ filter 空值後補滿。
function stripBriefViolatingSentences(brief: MarketBrief): MarketBrief {
  const reasoningChain = brief.reasoningChain
    .map(stripViolatingProse)
    .filter(s => s.length > 0)
  const dailyThesis = brief.dailyThesis === undefined
    ? undefined
    : stripViolatingProse(brief.dailyThesis)
  while (reasoningChain.length < 2)
    reasoningChain.push('依新聞主訴推導')
  return withOptionalDailyThesis({
    ...brief,
    headline: stripRequired(brief.headline),
    summary: stripRequired(brief.summary),
    relatedNews: brief.relatedNews.map(n => ({ ...n, title: stripRequired(n.title), reasoning: stripViolatingProse(n.reasoning) })),
    affectedIndustries: brief.affectedIndustries.map(i => ({ ...i, name: stripRequired(i.name), reasoning: stripViolatingProse(i.reasoning) })),
    relatedETFs: brief.relatedETFs.map(e => ({ ...e, name: stripRequired(e.name), rationale: stripViolatingProse(e.rationale) })),
    reasoningChain,
    citations: brief.citations.map(c => ({ ...c, title: stripRequired(c.title), quote: stripRequired(c.quote) })),
    ...(brief.cascadeChains
      ? {
          cascadeChains: brief.cascadeChains.map(c => ({
            ...c,
            industry: stripRequired(c.industry),
            mechanism: stripRequired(c.mechanism),
            // ★ 這裡是第三份欄位清單（偵測 briefProseFields／改寫
            // sanitizeAnalystForbiddenPhrases／strip 這三份必須一致）。少掉任何一份，
            // 症狀都是「判到違規、卻永遠清不掉那個欄位」——2026-08-21 補 affectedTickers
            // 時只改了前兩份，測試當場抓到。
            // 用 stripViolatingProse 不是 stripRequired：ticker 是可選的自由字串，
            // 整條被清掉時留空字串即可，不需要補中性 placeholder。
            affectedTickers: c.affectedTickers.map(stripViolatingProse).filter(t => t.length > 0),
            citations: c.citations.map(cit => ({ ...cit, title: stripRequired(cit.title), quote: stripRequired(cit.quote) })),
          })),
        }
      : {}),
  }, dailyThesis)
}

// 逐欄位收集 reader-facing prose（不串接）：不同 prose 欄位在 UI 非相鄰，
// 串接後 ticker↔方向詞 proximity 會跨欄位誤判（cross-field false positive）。
function briefProseFields(brief: MarketBrief): string[] {
  const parts: string[] = [brief.headline, brief.summary]
  if (brief.dailyThesis !== undefined)
    parts.push(brief.dailyThesis)
  for (const n of brief.relatedNews) parts.push(n.title, n.reasoning)
  for (const i of brief.affectedIndustries) parts.push(i.name, i.reasoning)
  for (const e of brief.relatedETFs) parts.push(e.name, e.rationale)
  parts.push(...brief.reasoningChain)
  for (const c of brief.citations) parts.push(c.title, c.quote)
  for (const c of brief.cascadeChains ?? []) {
    parts.push(c.industry, c.mechanism)
    // affectedTickers 是 analyst 自填的自由字串、而且會渲染到讀者面
    // （apps/web 的 CascadeChainCard）。2026-08-21 以前它是這裡唯一漏掉的欄位。
    parts.push(...c.affectedTickers)
    for (const cit of c.citations) parts.push(cit.title, cit.quote)
  }
  return parts
}

// 逐欄位掃合規（within-field 違規仍各自抓；cross-field 相鄰是 \n-join 假象、放行）。
function briefHasViolation(brief: MarketBrief): boolean {
  return briefProseFields(brief).some(f => checkCompliance(f) !== null)
}

// citation url 的合法性直接借用 schema 自己那一條規則，不另寫一份格式判斷：
// 兩份規則遲早漂移，而漂移的症狀就是 parse 在別的地方炸——這正是曾經發生過的情況。
const citationUrlSchema = MarketBriefCitationSchema.shape.url

// 過不了 MarketBriefCitationSchema 的 citation url 一律丟掉，不讓它走到 parse。
// 上游的不對稱是 CascadeChainSchema 的 url 只要 min(1)、而 adaptAnalystToMarketBrief
// 把 chain citations 直接 flatMap 進 brief.citations，所以「6578928」這種沒有 scheme
// 的字串過得了 tier 1／tier 2 的字面白名單、卻會在這裡 throw。而 throw 的代價不是少
// 一條引用：db-related／cache-hit 被 runAnalyze 的 try/catch 接住、整套 decomposer +
// tier1 + tier2 重跑一次，使用者拿到完全不同的分析、帳單翻倍，線上只留一行 warn。
//
// ★ 判準刻意不是「只留 http(s)」：data:insufficient 是 graceful sentinel，收緊會把
// placeholder 自己殺掉；analyses://<id> 是 routing.ts 餵進候選池的內部引用，過得了
// .url()、不是這裡的對象（讀者面另有 isExternalUrl 擋著不讓它變成連結）。
//
// 全丟光時要補回 placeholder：citations 是 min(1)，少了這一步只是把 throw 從
// invalid_format 換成 too_small。
function keepParsableCitationUrls(brief: MarketBrief, stats?: BriefSafetyStats): MarketBrief {
  const citations = brief.citations.filter(c => citationUrlSchema.safeParse(c.url).success)
  if (citations.length === brief.citations.length)
    return brief
  const dropped = brief.citations.length - citations.length
  // ★ 留痕不是可有可無：這裡把「爛 url → parse throw → fallback」換成「安靜丟掉」，
  // 而原本那條路至少會在 background_jobs.metadata 留下 fallbackFrom。只留 console.warn
  // 等於用一個靜默失敗換掉另一個——上游 analyst 若開始系統性吐內部 id 當 citation，
  // 沒有這個計數就沒有人會知道。
  if (stats)
    stats.droppedCitationUrls += dropped
  console.warn('[analyzer] dropped %d citation(s) with an unparsable url', dropped)
  return {
    ...brief,
    citations: citations.length > 0
      ? citations
      : [makeInsufficientCitation('此分析的引用來源連結格式不可考、已於安全閘移除')],
  }
}

// sanitize forbidden phrases → 合規 gate：違規 → sentence-strip graceful degrade（不 throw）→ clamp → schema parse。
// single-news（finalizeAnalystToMarketBrief）與 daily（assembleDailyBrief）共用、ruthlessly 消重複。
export function finalizeBriefSafety(brief: MarketBrief, stats?: BriefSafetyStats): MarketBrief {
  const sanitized = sanitizeAnalystForbiddenPhrases(keepParsableCitationUrls(brief, stats))
  const safe = briefHasViolation(sanitized)
    ? stripBriefViolatingSentences(sanitized)
    : sanitized
  const clamped = clampMarketBriefStringFields(safe)
  return MarketBriefSchema.parse(clamped)
}

function clampMarketBriefStringFields(brief: MarketBrief): MarketBrief {
  const dailyThesis = brief.dailyThesis === undefined
    ? undefined
    : truncateAtSentence(brief.dailyThesis, 150) as string
  return withOptionalDailyThesis({
    ...brief,
    headline: clampString(brief.headline, 80),
    summary: truncateAtSentence(brief.summary, 300) as string,
    reasoningChain: brief.reasoningChain.map(s => truncateAtSentence(s, 150) as string),
    relatedNews: brief.relatedNews.map(n => ({ ...n, reasoning: truncateAtSentence(n.reasoning, 600) as string })),
    affectedIndustries: brief.affectedIndustries.map(i => ({ ...i, reasoning: truncateAtSentence(i.reasoning, 600) as string })),
    relatedETFs: brief.relatedETFs.map(e => ({ ...e, rationale: truncateAtSentence(e.rationale, 600) as string })),
  }, dailyThesis)
}

// review fix：recursive field-targeted sanitize、只動 prose 欄位、
// URL / chainId / id-shape / direction enum 一律不碰。canonical map 由共用 rewriteText 提供。
function sanitizeAnalystForbiddenPhrases(brief: MarketBrief): MarketBrief {
  const counter = { count: 0 }
  const rw = (s: string) => rewriteText(s, counter)
  const sanitized: MarketBrief = {
    ...brief,
    headline: rw(brief.headline),
    ...(brief.dailyThesis !== undefined ? { dailyThesis: rw(brief.dailyThesis) } : {}),
    summary: rw(brief.summary),
    relatedNews: brief.relatedNews.map(n => ({ ...n, title: rw(n.title), reasoning: rw(n.reasoning) })),
    affectedIndustries: brief.affectedIndustries.map(i => ({ ...i, name: rw(i.name), reasoning: rw(i.reasoning) })),
    relatedETFs: brief.relatedETFs.map(e => ({ ...e, name: rw(e.name), rationale: rw(e.rationale) })),
    reasoningChain: brief.reasoningChain.map(rw),
    citations: brief.citations.map(c => ({ ...c, title: rw(c.title), quote: rw(c.quote) })),
    ...(brief.cascadeChains
      ? {
          cascadeChains: brief.cascadeChains.map(c => ({
            ...c,
            industry: rw(c.industry),
            mechanism: rw(c.mechanism),
            // 偵測與改寫的欄位清單必須一致，否則 briefHasViolation 判到違規、
            // strip 卻改不到那個欄位，會退化成「每次都走 strip 但永遠清不掉」。
            affectedTickers: c.affectedTickers.map(rw),
            citations: c.citations.map(cit => ({ ...cit, title: rw(cit.title), quote: rw(cit.quote) })),
          })),
        }
      : {}),
  }
  if (counter.count > 0)
    console.warn('[analyzer] sanitized %d forbidden-phrase occurrence(s) in MarketBrief', counter.count)
  return sanitized
}
