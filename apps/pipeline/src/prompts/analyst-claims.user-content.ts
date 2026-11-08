import { CONDITIONAL_MARKERS, SPECULATIVE_MARKERS } from '@suanomics/shared'

// analyst-claims.ts 的 user content 文字：可引用序列段落的標題句，以及附掛在
// analyst-tier1 system prompt 之後的 EvidenceClaim 契約整段指示。
export const ANALYST_CLAIMS_USER_TEXT = {
  citableSeriesHeading: '# 可引用序列（series evidenceRef 只能用以下 seriesId + asOf、逐字照抄、不可自編）',
  citableSeriesRule1: 'claim 句中只要出現上方「市場數據快照」的任何數字，**就必須**掛上對應的 series ref。',
  citableSeriesRule2: '那些數字不在任何新聞裡，掛 citation ref 或留空都是錯的。',
  citableSeriesItem: (seriesId: string, displayName: string, asOf: string) => `- seriesId: ${seriesId} ｜ ${displayName} ｜ asOf: ${asOf}`,
  claimsPromptSectionLines: [
    '# EvidenceClaim（額外輸出、與上面的分析並存）',
    '',
    '除既有欄位外，另輸出 `claims` 陣列：把你寫進 mechanism 的關鍵斷言拆成可逐條查證的單句。',
    '對**每條 cascadeChain 產 1–3 條**，優先涵蓋該 chain mechanism 句中的具名數字。',
    '',
    '每條 claim 四個欄位（其餘欄位由系統填、你不要產）：',
    '- `kind`：`fact`（已發生的事實斷言）／`inference`（推論）／`scenario`（條件情境）',
    '- `claimType`：`named-number`（句中有具名數字）／`dated-event`（句中有日期）／`causal`（因果推論）',
    '- `claim`：**單句**、可證偽。不要把整段 mechanism 塞成一條。',
    '- `evidenceRefs`：這句話的依據。兩種形狀，只能用其一：',
    '  - `{ "kind": "citation", "url": "…" }`——url 只能取自「可引用來源」清單',
    '  - `{ "kind": "series", "seriesId": "…", "asOf": "YYYY-MM-DD" }`——只能取自「可引用序列」清單',
    '',
    '硬性規則：',
    '1. 具名數字一律用**阿拉伯數字**（「兩成」「逾千億」無法與來源精確比對、寫成 20%、1000 億元）。',
    '2. 數字**逐字照抄**來源，不得換算單位、不得改小數位數。',
    '3. claim 句中**不得引用其他 claim 的編號**。',
    `4. \`kind: "fact"\` 的句子**不得**出現這些臆測詞：${SPECULATIVE_MARKERS.join('、')}。`,
    `5. \`kind: "scenario"\` **必須**出現至少一個條件詞：${CONDITIONAL_MARKERS.join('、')}。`,
    '6. 找不到依據的斷言，`evidenceRefs` 留空陣列、**不要自編來源**——留空是合法且可稽核的狀態。',
    // 2026-08-05 首次真實樣本量測：175 條 claim 只有 1 條掛了 series ref，而留空的 52 條裡
    // 有 43 條（83%）句子裡就寫著快照序列的值。模型會用那些數字、但不會把它們接回來源，
    // 所以這條規則要明講「數字來自哪裡就掛哪種 ref」，不能只列出清單就期待它自己對應。
    '7. **數字來自哪裡，就掛哪一種 ref**：來自新聞的掛 citation、來自「市場數據快照」的掛 series。',
    '   快照裡的數字（指數點位、殖利率、匯率、法人買賣超、期貨淨部位…）**不存在於任何新聞中**，',
    '   對它們掛 citation ref 或留空都是錯的。',
  ],
}
