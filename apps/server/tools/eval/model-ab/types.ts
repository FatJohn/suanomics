// model A/B harness 的資料形狀。純型別、無邏輯。
//
// 一個 run 檔＝「某個 model 對同一批素材跑一次」的完整紀錄。
// label 帶 arm 與第幾跑（A1 / A2 / B1 / B2），同臂雙跑就是靠這個表達。

export interface EntityOut { kind: string, name: string, confidence: number }

export interface ArticleRun {
  articleId: number
  title: string
  /** 該篇整個沒產出（zod 耗盡 / LLM 沒回這個 id）；比對時整篇跳過、不當成 0 重疊 */
  failed: boolean
  contentSummary: string
  entities: EntityOut[]
  /** LLM 原始吐出的 kind（未經 entity-summary.ts 的 other 收斂）、用來分辨真 other vs 非法 kind */
  rawKinds: string[]
  topicTags: string[]
  attempts: number
  zodFailures: number
  llmErrors: number
  tokensIn: number
  tokensOut: number
  cachedReadTokens: number
  costUsd: number
  latencyMs: number
}

export interface CallRow {
  tokensIn: number
  tokensOut: number
  cachedReadTokens: number
  costUsd: number
  latencyMs: number
  attempts: number
}

export interface RunFile {
  /** `A1` / `A2` / `B1` / `B2`：arm + 第幾跑 */
  label: string
  agent: string
  configuredModel: string
  resolvedModel: string
  startedAt: string
  articles: ArticleRun[]
  /**
   * 呼叫層的帳。batch 型 agent（news-tagger）與 prose 型 agent（viewpoints-debate）
   * 沒有「逐篇」概念、只能記在這裡；缺省時記帳退回 articles 的逐篇欄位。
   */
  calls?: CallRow[]
  /** prose 模式寫出的產物路徑（給 `brief:quality` 當輸入） */
  artifacts?: string[]
}
