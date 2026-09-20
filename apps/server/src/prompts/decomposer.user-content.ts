// decomposer agent（`apps/server/src/agents/decomposer.ts`）送給 LLM 的 user content 文字。
// 放這裡是為了跟 system prompt 一樣，換語言／市場時能整份替換，不必進 runner 邏輯裡挖字面值。
export const DECOMPOSER_USER_TEXT = {
  userContent: (newsTitle: string, newsText: string) => `# 新聞標題\n${newsTitle}\n\n# 新聞內文\n${newsText}`,
}
