// podcast-writer.ts 每次呼叫組給模型的 user content 模板：段落標題與指示句。
// 對應 apps/server/src/agents/podcast-writer.ts 的 formatUserContent()；獨立成檔是為了讓
// 「怎麼描述素材給模型看」這份繁中模板，跟組裝順序、截斷、條件分支等邏輯分開，換語言或
// 市場時只需替換這份資料，不必動 runner 的組裝邏輯。
export const PODCAST_WRITER_USER_TEXT = {
  intro: (briefDate: string): string => `今天 ${briefDate}、請依下列素材產出 podcast：`,
  readingNarrativeHeading: '## 1. Reading narrative（已生成、podcast 應有 differentiation 但內容可參考）',
  narrativeEmptyFallback: '(narrative 為空、請從 brief 自行構建)',
  cascadeChainsHeading: '## 3. Cascade chains（多階傳導）',
  cascadeChainsEmpty: '(無 cascade chains)',
  citationsHeading: (count: number): string => `## 4. 可用 citations（共 ${count} 條、citationUrls 必須是這個 subset）`,
  newsIdsHeading: (count: number): string => `## 5. News IDs（relatedNewsIds 必須是這個 subset、共 ${count} 則）`,
  calendarSectionHeading: '# 行事曆參考（前瞻素材；只可引用列出的事件與日期）',
  storylineSectionHeading: '# 敘事線參考（可自然回顧這些追蹤線的進展與先前論點；只可引用列出的內容、無進展的線不要硬提）',
  outputInstruction: '請輸出 podcast JSON、嚴格符合 schema、覆蓋全部 news。',
}
