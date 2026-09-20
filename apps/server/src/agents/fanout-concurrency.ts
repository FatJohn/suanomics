import type { StartupConfigLogLine } from '@suanomics/shared'
import process from 'node:process'

// tier2-fanout.ts 早就有 TIER2_FANOUT_CONCURRENCY=3 頂住 tier-2 retrieve+Analyst 扇出，
// 但 decomposer / per-news retrieve / analyst tier-1 這三處扇出（orchestrator.ts）當時
// 沒補到、一直無上限。一輪離線評測（12 份 brief 重跑＋18 組 pairwise judge、約 500 次請求
// 擠在十幾小時內、尖峰十幾個同時在飛）這種形狀，足以讓 LLM provider 把整個 project 判成
// suspicious activity 並限制或降級——外部使用者 clone 下來跑 daily brief 也會遇到，
// 而且不會知道發生了什麼事。
//
// 沿用 tier-2 的保守值 3；env 覆寫慣例沿用 news/refresh.ts 的 NEWS_FETCH_CONCURRENCY
// （Number.parseInt + || fallback，`0`／非數字一律退回預設值、不會意外變成無上限）。
export function fanoutConcurrency(envVar: string, fallback: number): number {
  return Math.max(1, Number.parseInt(process.env[envVar] ?? String(fallback), 10) || fallback)
}

export const DECOMPOSER_FANOUT_CONCURRENCY = fanoutConcurrency('DECOMPOSER_FANOUT_CONCURRENCY', 3)
export const RETRIEVE_FANOUT_CONCURRENCY = fanoutConcurrency('RETRIEVE_FANOUT_CONCURRENCY', 3)
export const ANALYST_TIER1_FANOUT_CONCURRENCY = fanoutConcurrency('ANALYST_TIER1_FANOUT_CONCURRENCY', 3)

// tier 2 fanout 的並發上限（原本定義在 tier2-fanout.ts、搬過來與另外三個
// 集中一處，見下方 effectiveLlmPeak 的推導理由）。Gemini Flash 對單一 API key 限 60 RPM、
// 加上 daily-brief 同時 N 篇 news 並行（每篇可能多 tier 1 chain）、整體並發容易爆。
// 3 個 in-flight tier-2 retrieve+Analyst chain 是經驗值（每個 chain ≈ 一次 retrieve
// + 一次 Analyst LLM call）、單則 daily-brief 仍可在合理 latency 內完成。
// ★ 刻意維持原本行為：這個值不吃 env 覆寫（跟另外三個不同）——搬移是 structural、
// 不改變任何行為；要不要開放覆寫是後續決策，不在這次 scope 內。
export const TIER2_FANOUT_CONCURRENCY = 3

// ── 全域有效尖峰：四個常數不能只看「各自有沒有上限」，要看合在一起會爆多少 ──
//
// 一次獨立驗收指出：四個常數各自 bound 沒錯，但沒有任何東西錨定
// 「合起來的全域尖峰是多少」，而那正是專案風險門檻量的東西。公式不是四個
// 常數相加，理由是 pipeline 實際的執行形狀：
//
//   1. decompose → retrieve → analyst 三個 stage 在 orchestrator.ts 是**循序**執行
//      （每個 stage 的 pMap/pMapSettled 跑完，下一個 stage 才開始），所以它們的並行
//      不會疊加——同一時刻只有一個 stage 在跑。
//   2. analyst stage 內部才是**巢狀**：每個 tier-1 worker 是
//      `await callAnalystTier1(...)` 完成之後才進 `attachTier2Chains` →
//      `runTier2Fanout`（並行 TIER2_FANOUT_CONCURRENCY）。也就是 tier-1 呼叫本身
//      與 tier-2 fanout **不同時在飛**——tier-2 fanout 開始時，觸發它的那個 tier-1
//      呼叫已經結束。analyst stage 自己的尖峰因此是「同時有 tier1 個 worker 在跑，
//      每個 worker 各自可能同時展開 tier2 個 tier-2 呼叫」= tier1 * tier2。
//
// 因此有效全域尖峰 = max(decomposer, retrieve, tier1 * tier2)，**不是四值相加**。
// 用目前四個預設值算：max(3, 3, 3*3) = 9。
//
// ★ 這個公式只描述目前的執行形狀（三 stage 循序、analyst 內部兩層巢狀且不重疊）。
//   pipeline 若改成讓 tier-1 與 tier-2 並行展開、或讓 stage 之間 overlap，這個公式
//   就會低估、要重新推導——不要假設它永遠對，維護時先確認執行形狀沒變。
export interface LlmFanoutConcurrency {
  decomposer: number
  retrieve: number
  tier1: number
  tier2: number
}

export function effectiveLlmPeak(c: LlmFanoutConcurrency): number {
  return Math.max(c.decomposer, c.retrieve, c.tier1 * c.tier2)
}

// 專案訂的 LLM 風險門檻：「單次作業預估請求數超過 500 次、或尖峰並行超過 10」；
// 這裡取的是「超過」的邊界前一格。門檻本身的來歷：約 500 次請求擠在
// 十幾小時內、尖峰十幾個同時在飛的離線評測，是已知會被 provider 判成 suspicious activity
// 的形狀。
export const MAX_SAFE_LLM_PEAK = 10

// 純函式：算一次（含 env 覆寫後的實際生效值），超標回一行警告、不擋任何東西。
// ★ 呼叫端不只 server 啟動（index.ts）——callAgentLLM（llm-wrapper.ts）也會經由
// warnLlmConcurrencyBudgetOnce 呼叫這個，所以 CLI 與批次評測腳本也看得到。`packages/
// prompt-research`、TTS、`model-ab --probe`、`GEMINI_ONLY_PATHS` 列的檔不經過
// callAgentLLM，也不讀這四個 fanout 值，所以不印；見 tools/ci/llm-chokepoint.ts。
// 沿用 @suanomics/shared startup-config.ts 的 DEGRADED 分級與 `[startup-config]` log 慣例
// （這個檢查本身放不進 startup-config.ts：它是 apps/server 專屬的衍生計算值，
// packages/shared 不能反向依賴 apps/server 的常數）。
export function checkLlmConcurrencyBudget(c: LlmFanoutConcurrency): StartupConfigLogLine | null {
  const peak = effectiveLlmPeak(c)
  if (peak <= MAX_SAFE_LLM_PEAK)
    return null
  return {
    level: 'error',
    message: `[startup-config] DEGRADED 設定超出安全範圍 server.{DECOMPOSER,RETRIEVE,ANALYST_TIER1}_FANOUT_CONCURRENCY：`
      + `decomposer=${c.decomposer} retrieve=${c.retrieve} tier1=${c.tier1} tier2=${c.tier2} `
      + `→ 有效全域尖峰 ${peak} 超過安全上限 MAX_SAFE_LLM_PEAK=${MAX_SAFE_LLM_PEAK}。`
      + `外部 LLM provider（如 Gemini/GCP）會把突然的高並行判定為 suspicious activity、`
      + `並限制或降級整個 project。`
      + `調低 DECOMPOSER_FANOUT_CONCURRENCY / RETRIEVE_FANOUT_CONCURRENCY / `
      + `ANALYST_TIER1_FANOUT_CONCURRENCY 三個 env 之一即可。`,
  }
}

// ── 單次作業的呼叫數上限：上述風險門檻的另一半（「單次作業超過 500 次呼叫」）──
//
// 實測基準（2026-09-08 起量法：background_jobs.metadata.llmCalls）：單份 daily brief
// 22–32 次呼叫。150 明顯高於這個實測上界（約 5 倍空間，容許未來加 agent／news 數量
// 成長），仍遠低於 500——落在「失控迴圈或誤改參數會撞到，正常 pipeline 絕不會撞到」
// 的量級。用既有 onCall 那條線計數（RunMetadata.llmCalls），不另拉一條。
//
// ★ 這道防線的射程，寫在臉上免得被當成比實際更強的保證：
//   (1) 它是 per-job 的。真正危險的形狀是**跨 job 累積**（12 份 brief＋18 組 pairwise
//       judge、約 500 次擠在十幾小時內），每一份都遠低於 150——**這道防線擋不住那個
//       形狀**。要擋它需要跨 job／時間窗的節流。
//   (2) 只在**成功**呼叫時計數（llm-wrapper 的 retry 失敗不 push），所以實際打出去的
//       HTTP 請求數最多可達計數的 3 倍（retry 上限 3）。
//   (3) 檢查點在 stage 邊界、不是每次呼叫（在 onCall 內 throw 會被 llm-wrapper 的
//       retry catch 當成呼叫失敗而重打，反而加重失控）。所以會超額約一個 stage 的量，
//       數十次量級。
export const MAX_LLM_CALLS_PER_JOB = fanoutConcurrency('MAX_LLM_CALLS_PER_JOB', 150)

// ── 單次「跑一支批次腳本」的呼叫總數上限：風險門檻的另一半（「單次作業超過 500 次
// 呼叫」），給 tools/cli/lib/llm-run-budget.ts 的批次腳本前置估算用 ──
//
// 跟 MAX_LLM_CALLS_PER_JOB 是不同層級的東西：MAX_LLM_CALLS_PER_JOB 是 runDailyBrief
// 單一 job 的硬上限（in-process、每次呼叫都算、跑完才知道有沒有超），這個是「跑之前就要
// 能估出來」的預估值，適用對象是 brief-rerun／model-ab 這類會在單一 process 內迴圈跑
// 很多次 pipeline 或 agent 呼叫的批次工具。
// ★ 刻意不吃 env——這是專案自己的風險門檻，不該被使用者的 .env 悄悄放寬。
export const MAX_SAFE_LLM_CALLS_PER_RUN = 500

// ── 單次 process 只印一次的並行預算警告：checkLlmConcurrencyBudget 的檢查
// 從「只有 server 啟動會跑」擴大到「每個經過 callAgentLLM 的呼叫路徑都跑」──
// CLI 與批次評測腳本原本完全看不到這個警告，而最容易打出危險總量的正是這些腳本。
// 印一次就夠：同一個 process 裡的四個常數不會中途改變（module load 時就算完），
// 重複印只會洗版、不會多給任何資訊。
let llmConcurrencyWarned = false

/** 測試專用：清掉「已印過」的狀態，讓下一次呼叫可以再印一次。 */
export function resetLlmConcurrencyBudgetWarnCache(): void {
  llmConcurrencyWarned = false
}

/**
 * 每個 process 只印一次的並行預算警告。預設參數讀「目前實際生效值」（含 env 覆寫），
 * 呼叫端不需要自己組 LlmFanoutConcurrency——這樣 index.ts／llm-wrapper.ts 兩個掛點
 * 都只要呼叫 `warnLlmConcurrencyBudgetOnce()`，不必各自 import 四個常數。
 *
 * 只有「真的超標而印出來」才會設定 warned=true；沒超標的呼叫不消耗這個 once 名額——
 * 這樣測試可以在同一個 process 內先注入正常值（不印、不佔用 once）、再注入超標值
 * （驗證第一次印、第二次不印）。
 */
export function warnLlmConcurrencyBudgetOnce(
  c: LlmFanoutConcurrency = {
    decomposer: DECOMPOSER_FANOUT_CONCURRENCY,
    retrieve: RETRIEVE_FANOUT_CONCURRENCY,
    tier1: ANALYST_TIER1_FANOUT_CONCURRENCY,
    tier2: TIER2_FANOUT_CONCURRENCY,
  },
  log: (message: string) => void = message => console.error(message),
): void {
  if (llmConcurrencyWarned)
    return
  const warning = checkLlmConcurrencyBudget(c)
  if (!warning)
    return
  log(warning.message)
  llmConcurrencyWarned = true
}

// orchestrator.ts 在 runDailyBrief 的每個 stage/fanout 開始前呼叫這個、餵目前的
// callCount（p.metadata.llmCalls.length，onCall 那條既有線在推）。刻意吃一個 number
// 而不是整個 RunMetadata：那個型別定義在 orchestrator.ts，這裡吃它會反向依賴。
// 刻意不放進 onCall 本身——onCall 是在 llm-wrapper.ts 的 try/catch 裡被呼叫的，
// 若在那裡 throw 會被當成這次呼叫失敗、觸發 retry（再打一次已經成功的 LLM 請求，
// 反而讓失控更嚴重）。
export function assertLlmCallBudget(callCount: number): void {
  if (callCount > MAX_LLM_CALLS_PER_JOB) {
    throw new Error(
      `runDailyBrief: LLM call budget exceeded (${callCount} calls > MAX_LLM_CALLS_PER_JOB=${MAX_LLM_CALLS_PER_JOB}). `
      + `可用 MAX_LLM_CALLS_PER_JOB env 覆寫；這道防線是為了`
      + `避免單次作業（失控迴圈或誤改參數）灌爆外部 LLM API 配額。`,
    )
  }
}
