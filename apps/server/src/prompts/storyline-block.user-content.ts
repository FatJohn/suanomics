// storyline-block.ts 組給模型的「追蹤中敘事線」區塊文字：標題、valence 標籤、逐行模板。
// 對應 apps/server/src/agents/storyline-block.ts 的 buildStorylineBlock() /
// continuityHintFromEntries()；獨立成檔是為了讓這份繁中措辭跟排序、cap、資料整理等邏輯
// 分開，換語言或市場時只需替換這份資料。
export const STORYLINE_BLOCK_USER_TEXT = {
  heading: '## 追蹤中敘事線（今日有進展）',
  valenceLabel: (valence: 'support' | 'challenge' | 'extend'): string => {
    const labels = { support: '今日支持', challenge: '今日反向訊號', extend: '今日進展' } as const
    return labels[valence]
  },
  arcSuffix: (arcDays: number): string => ` ｜ 已追蹤 ${arcDays} 天`,
  entryHeaderLine: (title: string, valenceLabel: string, thesis: string, arcSuffix: string): string =>
    `- 【${title}】（${valenceLabel}）論點：${thesis}${arcSuffix}`,
  priorLine: (priorDate: string, priorNote: string): string => `  先前（${priorDate}）：${priorNote}`,
  todayLine: (note: string): string => `  今日進展：${note}`,
  resolveLine: (resolveToday: 'confirmed' | 'refuted'): string =>
    `  ※今日論點${resolveToday === 'confirmed' ? '兌現（confirmed）' : '被證偽（refuted）'}`,
  continuityArcSuffix: (arcDays: number): string => `（已追蹤 ${arcDays} 天）`,
  continuityHint: (title: string, arcSuffix: string, note: string): string =>
    `延續主線「${title}」${arcSuffix}：${note}`,
}
