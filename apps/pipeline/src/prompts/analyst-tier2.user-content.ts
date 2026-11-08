// analyst-tier2.ts 的 user content 文字：組給模型的段落標題、指示句，
// 以及 citation 幻覺時的重試 feedback 訊息。與 analyst-tier1 的模板刻意分開維護
// （即使目前有幾句文字相同），因為兩個 tier 的 system prompt 契約不同，未來會各自演化。
export const ANALYST_TIER2_USER_TEXT = {
  mainNewsHeading: '# 主新聞',
  newsTitleHeading: (title: string) => `## 標題: ${title}`,
  newsBodyHeading: (text: string) => `## 內文:\n${text}`,
  tier1ChainHeading: '# Tier 1 Cascade Chain（context、不要當 citation 來源）',
  nominatedPartnersLine: (joinedEntities: string) => `- 已提名 tier 2 partner: ${joinedEntities}`,
  emptyRetrieverHeading: '# Retriever 結果',
  emptyRetrieverNote: '(retrieve 為空、依紀律 cascadeChains 留空陣列、不要靠內建知識硬寫)',
  retrieverHeading: '# Retriever 結果（你只能用以下 url 當 citation）',
  retrieverNote: '- 若該 tier 2 chain 內容無法由以下任何 url 佐證、請把 citations 留空陣列、不要編造 url',
  fabricationFeedback: (fabricatedUrls: string[], allowedUrls: string[]) =>
    `\n# 你上次輸出含未授權的 citation url（不在 retrieve 結果裡）：\n${fabricatedUrls.map(u => `- ${u}`).join('\n')}\n請只用以下 url、若無相關來源請把 citations 留空陣列：\n${allowedUrls.map(u => `- ${u}`).join('\n')}`,
}
