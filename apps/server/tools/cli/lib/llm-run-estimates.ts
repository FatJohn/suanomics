import type { LlmRunEstimate } from './llm-run-budget.js'
import {
  ANALYST_TIER1_FANOUT_CONCURRENCY,
  DECOMPOSER_FANOUT_CONCURRENCY,
  effectiveLlmPeak,
  MAX_LLM_CALLS_PER_JOB,
  RETRIEVE_FANOUT_CONCURRENCY,
  TIER2_FANOUT_CONCURRENCY,
} from '../../../src/agents/fanout-concurrency.js'
import { BATCH_SIZE as NEWS_TAGGER_BATCH_SIZE } from '../../../src/news/tag.js'
import { DEFAULT_HTTP_MULTIPLIER, term } from './llm-run-term.js'

// ── 各 agent 在「最壞情況」下的成功呼叫數係數（不含 HTTP retry；retry 只影響
// LlmRunTerm.httpMultiplier，見決策 4：retry ×3 不算進門檻、只印 HTTP 最壞值） ──
//
// 這些數字被 llm-run-estimates.test.ts 用真的 production 函式 + mock callAgentLLM
// 鎖住：改任何一個 agent 的 retry／attempt 上限而沒同步改這裡，那份測試會紅。
// 檔:行是寫這份估算時的依據，之後 agent 的重試邏輯若搬家，行號會漂——漂了以現況為準、
// 不必為了行號本身開一個 PR。

/** decomposer 單次呼叫、不重試（decomposer.ts 的 callDecomposer 只 await 一次 callAgentLLM）。 */
export const DECOMPOSER_CALLS_PER_NEWS = 1
/** analyst-tier1 的幻覺重試迴圈，預設 maxFabricationRetries=3（analyst-tier1.ts:97,130）。 */
export const ANALYST_TIER1_CALLS_PER_NEWS = 3
/** synthesizer 的合規重試迴圈，MAX_COMPLIANCE_RETRY_DEFAULT=3（synthesizer.ts:113,116）。 */
export const SYNTHESIZER_CALLS_PER_RUN = 3
/** narrative-writer 的 MAX_ATTEMPTS=2（narrative-writer.ts:98）。 */
export const NARRATIVE_WRITER_CALLS_PER_RUN = 2
/** viewpoints-debate：support + risk（平行）+ net-read，固定 3 通（viewpoints-debate.ts:50,58,67）。 */
export const VIEWPOINTS_DEBATE_CALLS_PER_RUN = 3
/** viewpoints-debate 一次呼叫內的尖峰：support 與 risk 用 Promise.all 平行、net-read 待兩者完成後才發（viewpoints-debate.ts:50）。 */
export const VIEWPOINTS_DEBATE_PEAK = 2
/** quality-judge 的 runQualityCompare：兩個 orientation 各一次（quality-judge.ts:65-66）。 */
export const QUALITY_JUDGE_CALLS_PER_COMPARE = 2
/**
 * entity-summary 的外層重試迴圈 DEFAULT_MAX_ATTEMPTS=3（entity-summary.ts:18）。
 * ★ 這裡不套 httpMultiplier=3：entity-summary 內層以 `maxRetries:1` 呼叫 callAgentLLM
 * （見該檔「重試分工」註解），所以外層 3 次本身就已經是實際 HTTP 請求數上界，
 * 再乘一次會把重試灌成 9 倍、雙重計算。
 */
export const ENTITY_SUMMARY_CALLS_PER_ARTICLE = 3

/** 目前實際生效的全域 fanout 尖峰（含 env 覆寫），供批次腳本估算自己的尖峰下界用。 */
function currentFanoutPeak(): number {
  return effectiveLlmPeak({
    decomposer: DECOMPOSER_FANOUT_CONCURRENCY,
    retrieve: RETRIEVE_FANOUT_CONCURRENCY,
    tier1: ANALYST_TIER1_FANOUT_CONCURRENCY,
    tier2: TIER2_FANOUT_CONCURRENCY,
  })
}

// orchestrator.ts:289 一次 runDailyBrief 收尾階段同時展開的呼叫數：viewpoints-debate
// 的 support+risk 平行（2）+ narrative-writer（1，narrative-writer 內部雖有 2 attempts
// 但那是循序 retry、不是同時在飛）+ chain-grouper（1）。
const BRIEF_RERUN_TAIL_PEAK = 4

export function estimateBriefRerun(replicates: number): LlmRunEstimate {
  return {
    script: 'brief-rerun',
    terms: [
      term(
        'replicate（每次重跑一份完整 brief，受 MAX_LLM_CALLS_PER_JOB 硬上限保護）',
        replicates,
        MAX_LLM_CALLS_PER_JOB,
        DEFAULT_HTTP_MULTIPLIER,
        'fanout-concurrency.ts MAX_LLM_CALLS_PER_JOB——runDailyBrief 單一 job 的硬上限，碼上唯一有強制力的上界',
      ),
    ],
    peak: Math.max(currentFanoutPeak(), BRIEF_RERUN_TAIL_PEAK),
    peakBasis: 'max(目前生效的全域 fanout 尖峰, orchestrator.ts:289 收尾階段 viewpoints(2)+narrative(1)+chain-grouper(1)=4)',
    caveats: [
      '每份實測 22–32 次呼叫（2026-09-08，見 fanout-concurrency.ts MAX_LLM_CALLS_PER_JOB 註解），'
      + `遠低於 MAX_LLM_CALLS_PER_JOB=${MAX_LLM_CALLS_PER_JOB}；用上限而非實測值估算是刻意留的安全邊際。`,
      '每份另有未知超額：檢查點在 stage 邊界（非每次呼叫），且 tier-1 的 cascadeChains 無 maxItems'
      + '（analyst-tier1.ts:28-30）→ tier-2 扇出無上限（tier2-fanout.ts:48-57），實際硬上限可能略高於 MAX_LLM_CALLS_PER_JOB。',
    ],
  }
}

export function estimateBriefCanary(dates: number): LlmRunEstimate {
  return {
    script: 'brief-canary',
    terms: [
      term(
        'canary 日期（每天一次 pairwise content-ablation）',
        dates,
        QUALITY_JUDGE_CALLS_PER_COMPARE,
        DEFAULT_HTTP_MULTIPLIER,
        'quality-judge.ts:65-66（runQualityCompare 兩個 orientation 各一次）',
      ),
    ],
    peak: 1,
    peakBasis: '逐日期序列跑（brief-canary.ts 的 for 迴圈），單一時刻只有一組 judge 呼叫在飛',
    caveats: [],
  }
}

/**
 * @param sourceCountsByDate 每個日期實際取樣的新聞則數（`--limit` 生效後的數字，不是
 * canary fixture 的原始則數）——呼叫端要先算好 `limit > 0 ? slice : all` 再傳進來。
 */
export function estimateNarrativeLedgerAb(sourceCountsByDate: readonly number[]): LlmRunEstimate {
  const dates = sourceCountsByDate.length
  const totalSources = sourceCountsByDate.reduce((a, b) => a + b, 0)
  return {
    script: 'narrative-ledger-ab',
    terms: [
      term('decomposer（每則新聞一次、三臂共用）', totalSources, DECOMPOSER_CALLS_PER_NEWS, DEFAULT_HTTP_MULTIPLIER, 'decomposer.ts（callDecomposer 單次呼叫）'),
      term('analyst-tier1（每則新聞一次、三臂共用，含幻覺重試）', totalSources, ANALYST_TIER1_CALLS_PER_NEWS, DEFAULT_HTTP_MULTIPLIER, 'analyst-tier1.ts:97,130（maxFabricationRetries 預設 3）'),
      term('synthesizer（每天一次，含合規重試）', dates, SYNTHESIZER_CALLS_PER_RUN, DEFAULT_HTTP_MULTIPLIER, 'synthesizer.ts:113,116（MAX_COMPLIANCE_RETRY_DEFAULT）'),
      term('narrative-writer（每天三臂 A1/A2/B，各含重試）', dates * 3, NARRATIVE_WRITER_CALLS_PER_RUN, DEFAULT_HTTP_MULTIPLIER, 'narrative-writer.ts:98（MAX_ATTEMPTS）× narrative-ledger-ab.ts 三臂迴圈'),
    ],
    peak: 1,
    peakBasis: '每個 stage await 完才進下一步、三臂也是序列跑（narrative-ledger-ab.ts 的 for arm 迴圈）',
    caveats: [],
  }
}

export function estimateClaimYieldSmoke(newsCount: number): LlmRunEstimate {
  return {
    script: 'claim-yield-smoke',
    terms: [
      term('decomposer（每則新聞一次、兩臂共用）', newsCount, DECOMPOSER_CALLS_PER_NEWS, DEFAULT_HTTP_MULTIPLIER, 'decomposer.ts（callDecomposer 單次呼叫）'),
      term('analyst-tier1（每則新聞兩臂各一次，含幻覺重試）', newsCount * 2, ANALYST_TIER1_CALLS_PER_NEWS, DEFAULT_HTTP_MULTIPLIER, 'analyst-tier1.ts:97,130 × claim-yield-smoke.ts 兩臂迴圈（flag 開/關）'),
    ],
    peak: 1,
    peakBasis: '逐則新聞序列跑（claim-yield-smoke.ts 的 for 迴圈）',
    caveats: [],
  }
}

export function estimateViewpointsSmoke(runs: number): LlmRunEstimate {
  return {
    script: 'viewpoints-smoke',
    terms: [
      term('viewpoints-debate（兩臂 no-ledger/with-ledger，各跑 runs 次）', runs * 2, VIEWPOINTS_DEBATE_CALLS_PER_RUN, DEFAULT_HTTP_MULTIPLIER, 'viewpoints-debate.ts:50,58,67（support+risk+net-read）× viewpoints-smoke.ts 兩臂迴圈'),
    ],
    peak: VIEWPOINTS_DEBATE_PEAK,
    peakBasis: 'viewpoints-debate.ts:50（support 與 risk 用 Promise.all 平行、net-read 待兩者完成後才發）',
    caveats: [],
  }
}

// ── news-backfill-tags / prompt-research-distill 兩支批次腳本的係數 ──
//
// news-backfill-tags 經 apps/server/src/news/tag.ts 的 tagAndStore 間接呼叫
// callAgentLLM（同一條 chokepoint，跟本檔前半段的 agent 係數同一套規則）。
//
// prompt-research-distill 不同：它經 @suanomics/prompt-research 直接呼叫 `@google/genai`
// 的 GoogleGenAI（不經 callAgentLLM、不讀 fanout-concurrency.ts 那四個常數），所以下面
// 這組係數的依據是 packages/prompt-research 各檔自己的 MAX_ATTEMPTS 迴圈，不是
// ANALYST_TIER1_FANOUT_CONCURRENCY 那套。

/** news-tagger.ts callNewsTagger 單次呼叫 callAgentLLM、無外層業務重試迴圈（同 decomposer）。 */
export const NEWS_TAGGER_CALLS_PER_BATCH = 1
/**
 * 就是 tag.ts 的 BATCH_SIZE 本人（見檔頭 import），不是另外複製一份數字——tagAndStore 在
 * 測試裡被 mock 掉，改 tag.ts 的批次大小不會讓任何呼叫 tagAndStore 的測試變紅；只有讓
 * 估算函式跟 tag.ts 吃同一個 binding，tag.ts 改了才會直接反映在這裡（無法悄悄各自漂移）。
 */
export { NEWS_TAGGER_BATCH_SIZE }

/**
 * @param untaggedCount getUntaggedNewsItems(sinceDays) 撈到的實際筆數——這是開跑前
 * 就會先查完 DB 才估算，不是像 prompt-research-distill 那樣只能抓上界，所以這裡的
 * 「批次數」是精確值，不是估計上界。
 */
export function estimateNewsBackfillTags(untaggedCount: number): LlmRunEstimate {
  const batches = Math.ceil(untaggedCount / NEWS_TAGGER_BATCH_SIZE)
  return {
    script: 'news-backfill-tags',
    terms: [
      term(
        `未標記新聞批次（每 ${NEWS_TAGGER_BATCH_SIZE} 則一批）`,
        batches,
        NEWS_TAGGER_CALLS_PER_BATCH,
        DEFAULT_HTTP_MULTIPLIER,
        `tag.ts:4（BATCH_SIZE，import 而來、目前為 ${NEWS_TAGGER_BATCH_SIZE}）、news-tagger.ts:60-73`
        + `（callNewsTagger 單次呼叫 callAgentLLM，無外層重試迴圈）`,
      ),
    ],
    peak: 1,
    peakBasis: 'tag.ts tagAndStore 的 for 迴圈逐批序列 await，同一時刻只有一個 callNewsTagger 呼叫在飛',
    caveats: [],
  }
}

// prompt-research-distill 的係數搬到 prompt-research-distill-estimate.ts（同檔會破 300
// 行 eslint 上限）；re-export 讓既有「係數比照 llm-run-estimates.ts」的引用路徑不用改。
export {
  estimatePromptResearchDistill,
  PROMPT_RESEARCH_CONSOLIDATOR_CALLS_PER_RUN,
  PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN,
  PROMPT_RESEARCH_DISTILL_HTTP_MULTIPLIER,
  PROMPT_RESEARCH_LENS_CALLS_PER_LENS,
  PROMPT_RESEARCH_LENS_COUNT,
  PROMPT_RESEARCH_SEGMENTER_CALLS_PER_EPISODE,
  PROMPT_RESEARCH_STT_CALLS_PER_EPISODE,
} from './prompt-research-distill-estimate.js'
