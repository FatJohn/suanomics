// provider 共用呼叫介面：llm-wrapper 的 retry 迴圈組好 params、provider 負責單次呼叫
export interface ProviderCallParams {
  modelName: string
  systemPrompt: string
  userContent: string
  responseSchema: unknown
  timeoutMs: number
}

// raw 語意統一：provider 回「已 parse 的 unknown 物件」。
// Gemini 回 text、provider 內 JSON.parse 完才回；parse 失敗在 provider 內 throw → wrapper retry 語意不變。
// Anthropic 走 forced tool-use、tool input 已是物件、直接回。
export interface ProviderCallResult {
  raw: unknown
  tokensIn: number // Anthropic: 不含 cached；Gemini: promptTokenCount（含 cached）
  tokensOut: number
  // prompt caching 觀測 + 成本帳用（無 caching 時 undefined / 0）
  cachedReadTokens?: number // Anthropic: cache_read_input_tokens；Gemini: cachedContentTokenCount
  cacheWriteTokens?: number // Anthropic: cache_creation_input_tokens；Gemini: 無
}
