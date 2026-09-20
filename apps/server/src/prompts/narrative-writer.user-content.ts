// narrative-writer.ts 每次呼叫組給模型的 user content 模板：段落標題與指示句。
// 對應 apps/server/src/agents/narrative-writer.ts 的 formatUserContent()；獨立成檔是為了讓
// 「怎麼描述素材給模型看」這份繁中模板，跟組裝順序、截斷、條件分支等邏輯分開，換語言或
// 市場時只需替換這份資料，不必動 runner 的組裝邏輯。
export const NARRATIVE_WRITER_USER_TEXT = {
  intro: (briefDate: string): string => `今天 ${briefDate}、請依下列素材產 narrative：`,
  dailyThesisHeading: '## 本日論點（thesis 脊椎、全文貫穿）',
  // 這句與 system prompt 的「# 結構」節是同一條指示的第二個現場（見 narrative-writer.ts
  // formatUserContent 呼叫處註解）、措辭需與那邊一起換。
  dailyThesisInstruction: 'intro 以此立論、每個主題段用內容承接它（不要寫「這正印證了本日論點」這類宣告句）、outro 回到這條主線收尾。',
  mainThemesHeading: '## 0. 當日主軸（narrative 組織骨幹）',
  mainThemesInstructionProvided: '依這些主軸把相關新聞與 cascade 編織成 1-4 個主題段落、不要逐則新聞各寫一段。',
  mainThemesInstructionMissing: '（未提供）請自行從下列選稿歸納 1-4 個當日主軸、依主軸組織主題段落、不要逐則新聞各寫一段。',
  newsSectionHeading: (count: number): string => `## 2. 每則新聞 + analyst 結果（共 ${count} 則）`,
  publishedLabelLine: (label: string): string => `發布時間：${label}`,
  citationsHeading: (count: number): string => `## 3. 可用 citations（共 ${count} 條、citationUrls 必須是這個 subset）`,
  claimLedgerHeading: (count: number): string => `## 4. 本日已核對的證據（claim ledger、共 ${count} 條）`,
  calendarSectionHeading: '# 行事曆參考（前瞻素材；只可引用列出的事件與日期）',
  storylineSectionHeading: '# 敘事線參考（依「跨日連續性」節處理：只在真有延續的主線講今日相對「先前」的 delta 與伏筆兌現；無延續勿硬提、稀疏日冷開場）',
  officialSectionHeading: '# 主管機關公告（一手素材；只可引用列出的機關、日期與內容，不可據此推論未列出的數字或政策）',
  outputInstruction: '請輸出 narrative JSON。',
}
