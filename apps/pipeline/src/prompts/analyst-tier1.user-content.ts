// analyst-tier1.ts 的 user content 文字：組給模型的段落標題、指示句，
// 以及 citation 幻覺時的重試 feedback 訊息。
export const ANALYST_TIER1_USER_TEXT = {
  mainNewsHeading: '# 主新聞',
  newsTitleHeading: (title: string) => `## 標題: ${title}`,
  publishedAtHeading: (label: string) => `## 發布時間: ${label}`,
  newsBodyHeading: (text: string) => `## 內文:\n${text}`,
  decomposerResultHeading: '# Decomposer 結果',
  primaryNewsCitableSummary: '主新聞本身（分析直接源於此則新聞的論點請引用這條）',
  noCitableSourcesHeading: '# 可引用來源',
  noCitableSourcesNote: '(無可引用 url、citations 一律留空陣列、不要編造)',
  citableSourcesHeading: '# 可引用來源（citations 只能用以下 url、quote ≤200 字、無法佐證的 chain 留空陣列、不要編造）',
  priorChainsHeading: '# 近 7 天類似新聞分析（prior context、僅供參考、不要當 citation）',
  fabricationFeedback: (fabricatedUrls: string[], allowedUrls: string[]) =>
    `\n# 你上次輸出含未授權的 citation url（不在 retrieve 結果裡）：\n${fabricatedUrls.map(u => `- ${u}`).join('\n')}\n請只用以下 url、若無相關來源請把 citations 留空陣列：\n${allowedUrls.map(u => `- ${u}`).join('\n')}`,
}
