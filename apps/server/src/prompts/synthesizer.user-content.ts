// synthesizer agent（`apps/server/src/agents/synthesizer.ts`）送給 LLM 的 user content 文字，
// 以及 compliance 違規重試時附加的 feedback 文字。放這裡是為了跟 system prompt 一樣，
// 換語言／市場時能整份替換，不必進 runner 邏輯裡挖字面值。
export const SYNTHESIZER_USER_TEXT = {
  dateHeading: (date: string) => `# 日期: ${date}`,
  analystOutputsHeading: (count: number) => `# Analyst 輸出（${count} 篇）`,
  parentLabel: (parentChainId: string) => ` (傳導自 ${parentChainId})`,
  speculativeLabel: ' [推測]',
  speculativeNote: '註：標 [推測] 的傳導鏈無來源佐證、請以「若…則…」條件語氣呈現、不得作為 highlights 依據。',
  marketCloseFramingNote: '描述台股行情的今日/昨日以上表為準；其他市場（美股等）依各新聞的發布時間。',
  continuityHeading: '# 延續追蹤線（標題參考）',
  continuityNote: '若此主線壓倒性主導今日、headline 可帶跨日訊號（例「能源通膨追蹤：…」）；否則維持 stateless、勿硬連、勿為連而連。',
  complianceRetryFeedback: (violationType: string) =>
    `\n# 你上次輸出違反合規鐵線（類型: ${violationType}）\n請重寫整段、不要修補、避免任何個股 + 方向性買賣或多空組合、避免投信投顧法 44 條禁用詞、改用中性財經分析語言。`,
}
