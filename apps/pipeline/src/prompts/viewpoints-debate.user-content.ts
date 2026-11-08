// viewpoints-debate agent（`apps/server/src/agents/viewpoints-debate.ts`）三次呼叫各自
// 附加在共用素材（`buildDebateMaterial`，見 viewpoints-debate.prompt.ts）之後的指示句。
// 放這裡是為了跟 system prompt 一樣，換語言／市場時能整份替換，不必進 runner 邏輯裡挖字面值。
export const VIEWPOINTS_DEBATE_USER_TEXT = {
  supportUserContent: (material: string) => `${material}\n\n請輸出支持論據 JSON {points:[...]}。`,
  riskUserContent: (material: string) => `${material}\n\n請輸出風險論據 JSON {points:[...]}。`,
  netReadUserContent: (material: string, supportPoints: string[], riskPoints: string[]) =>
    `${material}\n\n# 支持論據\n${supportPoints.map(x => `- ${x}`).join('\n')}\n\n# 風險論據\n${riskPoints.map(x => `- ${x}`).join('\n')}\n\n請收斂成一段綜合淨讀、輸出 JSON {netRead:"..."}。`,
}
