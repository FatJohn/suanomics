// chain-grouper agent（`apps/server/src/agents/chain-grouper.ts`）送給 LLM 的 user content 文字。
// 放這裡是為了跟 system prompt 一樣，換語言／市場時能整份替換，不必進 runner 邏輯裡挖字面值。
export const CHAIN_GROUPER_USER_TEXT = {
  forceGroupsHeading: '## 今日力場分組（固定、只能從中選）',
  labelsHeading: (count: number) => `## 要歸類的產業標籤（${count} 個）`,
}
