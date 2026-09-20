import type { SourceSpec } from '@suanomics/prompt-research'
import type { LlmRunEstimate, LlmRunTerm } from './llm-run-budget.js'
import { EPISODE_CONCURRENCY, LENS_CONCURRENCY } from '@suanomics/prompt-research'
import { term } from './llm-run-term.js'

// prompt-research-distill 不經 callAgentLLM、不讀 fanout-concurrency.ts 那四個常數——
// 它經 @suanomics/prompt-research 直接呼叫 `@google/genai` 的 GoogleGenAI。下面這組係數的依據
// 是 packages/prompt-research 各檔自己的 MAX_ATTEMPTS 迴圈。re-export 在 llm-run-estimates.ts
// （單一入口，「係數比照 llm-run-estimates.ts」的既有引用路徑不用改）；本檔獨立成檔只是為了
// 不讓 llm-run-estimates.ts 破 300 行 eslint 上限。

/**
 * segmenter.ts runSegmenter 的 MAX_ATTEMPTS（segmenter.ts:19）；直接呼叫 GoogleGenAI、
 * 沒有下層 wrapper 再重試，MAX_ATTEMPTS 本身就是這個 stage 的 HTTP 呼叫上界。
 */
export const PROMPT_RESEARCH_SEGMENTER_CALLS_PER_EPISODE = 2
/**
 * lens-extractors.ts LENS_ORDER 固定 6 個 lens（events/cited_sources/entities/
 * reasoning_chains/impacts/analyst_frames，lens-extractors.ts:49-56），以 LENS_CONCURRENCY
 * 為上限並行（pMap，不是一次全開的 Promise.all）。
 */
export const PROMPT_RESEARCH_LENS_COUNT = 6
/** lens-extractors.ts runLens 的 MAX_ATTEMPTS（lens-extractors.ts:34），每個 lens 各自。 */
export const PROMPT_RESEARCH_LENS_CALLS_PER_LENS = 2
/**
 * consolidator.ts runConsolidator 的 MAX_ATTEMPTS（consolidator.ts:17），每個 run 一次
 * （不是每個 episode）；直接呼叫 GoogleGenAI，無下層重試。
 */
export const PROMPT_RESEARCH_CONSOLIDATOR_CALLS_PER_RUN = 3
/**
 * gemini-stt.ts transcribeWithGemini 的 MAX_ATTEMPTS（gemini-stt.ts:19），僅 podcast-rss
 * 每集一次（STT）；yt-transcript 走 youtube-transcript-plus 抓字幕，不打 LLM。
 */
export const PROMPT_RESEARCH_STT_CALLS_PER_EPISODE = 2
/**
 * transcript-to-digest.ts / skill-to-digest.ts 的最外層業務重試迴圈 MAX_ATTEMPTS=3
 * （兩檔的 MAX_ATTEMPTS 常數各自定義、值相同）。
 * ★ 這裡的 3 只計外層業務重試（任何錯誤都重跑一次「叫 Gemini＋驗 schema」）。內層
 * gemini-client.ts 的 callGemini() 自己還有一層 transport-level retry
 * （DEFAULT_MAX_ATTEMPTS=3，指數 backoff、任何非 Abort 錯誤都重打），真實最壞 HTTP 請求數
 * 可達 3×3=9——但那一層 retry 不重複計入 callsPerUnit（見 httpMultiplier），理由同
 * ENTITY_SUMMARY_CALLS_PER_ARTICLE（llm-run-estimates.ts）那條「不要把兩層重試相乘、雙重
 * 計算」的取捨：callsPerUnit 記的是「業務邏輯重試次數」，transport retry 只影響 HTTP 最壞值。
 */
export const PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN = 3
/**
 * gemini-client.ts callGemini() 的 DEFAULT_MAX_ATTEMPTS（gemini-client.ts:22），只反映在
 * PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN 那個 term 的 httpMultiplier，不重複計入 calls。
 */
export const PROMPT_RESEARCH_DISTILL_HTTP_MULTIPLIER = 3
/**
 * segmenter／lens-extractors／gemini-stt 這三個 stage 都是直接呼叫 GoogleGenAI、自己的
 * MAX_ATTEMPTS 迴圈本身就已經是 HTTP 呼叫上界（沒有像 distill 那樣被 gemini-client.ts 的
 * callGemini() 包一層 transport retry），所以每集那個 term 的 httpMultiplier 要用 1，不能套
 * DEFAULT_HTTP_MULTIPLIER（那是給有 callAgentLLM／callGemini 包一層 retry 的呼叫用的，套在
 * 這裡會把 HTTP 最壞值灌成 3 倍、失真）。consolidator 同樣直接呼叫 GoogleGenAI、無下層
 * wrapper（見 PROMPT_RESEARCH_CONSOLIDATOR_CALLS_PER_RUN 與下面它自己的 term，httpMultiplier
 * 直接寫 1），跟這三個同一類——只是它不隨集數增加、獨立成自己的 term，不套用這個常數。
 */
export const PROMPT_RESEARCH_PER_EPISODE_HTTP_MULTIPLIER = 1

/**
 * YtSourceConfigSchema／PodcastRssConfigSchema 的 count 皆為 z.number().int().positive().default(5)
 *（types.ts:15-18,37-40）——config 沒帶合法 count 時，dispatchYt/dispatchPodcastRss 實際套用的值。
 */
const PROMPT_RESEARCH_DEFAULT_COUNT = 5

/**
 * spec.config.count 是「開跑前已知的上界」，不是「執行後才知道的實際集數」——播放清單或
 * RSS feed 本身集數可能不足 count，實際擷取到的集數可能更少（yt 來源的 count 要到執行中
 * 才知道，指的就是這個落差）。這裡刻意用設定值當上界估算，不猜測實際值。
 */
function extractPromptResearchCount(spec: SourceSpec): number {
  const raw = spec.config.count
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0)
    return raw
  return PROMPT_RESEARCH_DEFAULT_COUNT
}

/**
 * yt-transcript／podcast-rss 這個 spec 對應的三個 term（每集 segmenter+lens(+STT)、
 * consolidator、distill）與這個 spec 貢獻的 peak——抽出來只是為了讓
 * estimatePromptResearchDistill 的行數壓回 80 行內，邏輯逐字照搬，不改變任何係數或文字。
 */
function buildEpisodeSourceTerms(spec: SourceSpec, hasStt: boolean): { terms: LlmRunTerm[], peak: number } {
  const count = extractPromptResearchCount(spec)
  const perEpisode = PROMPT_RESEARCH_SEGMENTER_CALLS_PER_EPISODE
    + PROMPT_RESEARCH_LENS_COUNT * PROMPT_RESEARCH_LENS_CALLS_PER_LENS
    + (hasStt ? PROMPT_RESEARCH_STT_CALLS_PER_EPISODE : 0)
  const terms: LlmRunTerm[] = [
    term(
      `${spec.slug}（${spec.kind}，count=${count} 為 config 上界，實際集數可能因來源集數不足而更少；`
      + `每集 segmenter+6 lens${hasStt ? '+STT' : ''} 共 ${perEpisode} 次）`,
      count,
      perEpisode,
      PROMPT_RESEARCH_PER_EPISODE_HTTP_MULTIPLIER,
      hasStt
        ? 'segmenter.ts:19（MAX_ATTEMPTS=2）、lens-extractors.ts:34,49-56（MAX_ATTEMPTS=2 × 6 個 lens）、gemini-stt.ts:19（MAX_ATTEMPTS=2）'
        : 'segmenter.ts:19（MAX_ATTEMPTS=2）、lens-extractors.ts:34,49-56（MAX_ATTEMPTS=2 × 6 個 lens）',
    ),
    term(
      `${spec.slug} consolidator（每個 run 一次，不隨集數增加）`,
      1,
      PROMPT_RESEARCH_CONSOLIDATOR_CALLS_PER_RUN,
      1,
      'consolidator.ts:17（MAX_ATTEMPTS=3，直接呼叫 GoogleGenAI、無下層 wrapper 再重試）',
    ),
    term(
      `${spec.slug} distill（每個 run 一次）`,
      1,
      PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN,
      PROMPT_RESEARCH_DISTILL_HTTP_MULTIPLIER,
      'transcript-to-digest.ts:10（MAX_ATTEMPTS=3 業務重試，計入 calls）；內層 gemini-client.ts:22 '
      + 'callGemini() 自己的 transport retry（DEFAULT_MAX_ATTEMPTS=3）只反映在 httpMultiplier、不重複計入 calls',
    ),
  ]
  return { terms, peak: Math.min(count, EPISODE_CONCURRENCY) * Math.min(PROMPT_RESEARCH_LENS_COUNT, LENS_CONCURRENCY) }
}

/**
 * @param specs runDistill() 內已完成 --skill／--file／--rss／--kind／--count 覆寫之後的
 * 最終 specs 陣列（跟 dry-run 分支現在讀的是同一份），不是 DEFAULT_SOURCES 原始值。
 */
export function estimatePromptResearchDistill(specs: readonly SourceSpec[]): LlmRunEstimate {
  const terms: LlmRunTerm[] = []
  let peak = 1
  let hasPodcastRss = false
  for (const spec of specs) {
    if (spec.kind === 'yt-transcript' || spec.kind === 'podcast-rss') {
      const hasStt = spec.kind === 'podcast-rss'
      if (hasStt)
        hasPodcastRss = true
      const built = buildEpisodeSourceTerms(spec, hasStt)
      terms.push(...built.terms)
      peak = Math.max(peak, built.peak)
    }
    else {
      // skill-markdown／custom-text：light pipeline，只有 distillSkillToDigest 這一個呼叫單位
      // （skill-to-digest.ts 也被 custom-to-digest.ts 內部呼叫、共用同一組係數）。
      terms.push(term(
        `${spec.slug}（${spec.kind}，light pipeline）`,
        1,
        PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN,
        PROMPT_RESEARCH_DISTILL_HTTP_MULTIPLIER,
        'skill-to-digest.ts:9（MAX_ATTEMPTS=3 業務重試，計入 calls）；內層 callGemini() 的 transport retry 只反映在 httpMultiplier',
      ))
    }
  }
  return {
    script: 'prompt-research-distill',
    terms,
    peak,
    peakBasis: `yt-transcript／podcast-rss：deep-pipeline.ts 的 pMap(inputs, EPISODE_CONCURRENCY=${EPISODE_CONCURRENCY}, ...) `
      + `與 lens-extractors.ts runAllLenses 的 pMap(LENS_ORDER, LENS_CONCURRENCY=${LENS_CONCURRENCY}, ...) 兩層巢狀並行，`
      + `worst-case peak=min(count,${EPISODE_CONCURRENCY})×min(6,${LENS_CONCURRENCY})（${EPISODE_CONCURRENCY} 個同時在跑的 `
      + 'episode worker，恰好同時都處於 lens 扇出階段，每個 episode worker 內 lens 扇出本身也設了上限，不是一次全開）；'
      + 'skill-markdown／custom-text 無扇出，peak=1；多個 source 之間彼此序列跑（prompt-research-distill.ts 的 '
      + 'for (const spec of specs) 迴圈），peak 取跨 source 的最大值而非加總',
    caveats: [
      '每個 stage 的 callsPerUnit 假設「重試到最後一次才成功」；deep-pipeline.ts／dispatchSource 沒有跳過'
      + '失敗 episode 的邏輯，某次呼叫若重試到底仍失敗，pipeline 會整包 throw、後續 stage 不會執行，實際'
      + '呼叫數只會更低，這裡刻意估上界。',
      'count 是 spec.config.count（開跑前已知的設定值），不是「執行後才知道的實際集數」——播放清單／RSS '
      + 'feed 本身集數可能不足 count，這裡刻意用設定值當上界估算，不是精確值。',
      '不含 downloadMp3／fetchTranscript／fetchRssFeed／fetchStreamsPage 這些非 LLM 網路請求自己的重試'
      + '（它們的失敗不會打 Gemini，不計入這裡）。',
      ...(hasPodcastRss
        ? [
            'podcast-rss 每集另有 gemini-stt.ts:77-102（uploadAndWaitActive）的 File API 上傳＋輪詢'
            + '（音檔超過 INLINE_LIMIT_BYTES=18MB 就會走這條，gemini-stt.ts:23；gemini-stt.ts:74 '
            + '註解說一般財經 podcast（~58MB/hr）都會走）：1 次 files.upload（:82）、加上最多 '
            + 'FILE_ACTIVE_TIMEOUT_MS=300000ms（:26）÷ FILE_POLL_INTERVAL_MS=3000ms（:27）≈ 100 次 '
            + 'files.get 輪詢（:100）。這些是同一把 API key 打出去的請求、但不是生成呼叫（不計費、'
            + '不算 generateContent），刻意不計入上面的 calls／peak——算進去會讓這道閘門在任何 '
            + 'podcast-rss 來源上永遠觸發，失去區分「正常/失控」的意義。',
          ]
        : []),
    ],
  }
}
