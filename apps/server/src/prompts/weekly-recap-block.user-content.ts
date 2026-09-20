// weekly-recap-block.ts 組給模型的「本週敘事線回顧」區塊文字：標題、valence／status 標籤、
// 逐行模板。對應 apps/server/src/agents/weekly-recap-block.ts 的 buildWeeklyRecapBlock()；
// 獨立成檔是為了讓這份繁中措辭跟區間篩選、排序等邏輯分開，換語言或市場時只需替換這份資料。
export const WEEKLY_RECAP_BLOCK_USER_TEXT = {
  heading: '## 本週敘事線回顧',
  titleLine: (title: string, thesis: string): string => `- 【${title}】論點：${thesis}`,
  updateLine: (briefDate: string, valenceLabel: string, note: string): string => `  ${briefDate}（${valenceLabel}）：${note}`,
  valenceLabel: (valence: 'support' | 'challenge' | 'extend'): string => {
    const labels = { support: '支持', challenge: '反向訊號', extend: '進展' } as const
    return labels[valence]
  },
  statusLabel: (status: 'confirmed' | 'refuted' | 'open' | 'dormant'): string | null => {
    const labels: Record<'confirmed' | 'refuted' | 'open' | 'dormant', string | null> = {
      confirmed: '本週兌現（confirmed）',
      refuted: '本週被證偽（refuted）',
      open: null,
      dormant: null,
    }
    return labels[status]
  },
  statusLine: (status: string): string => `  ※${status}`,
}
