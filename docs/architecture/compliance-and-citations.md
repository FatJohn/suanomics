# Compliance 與 Citations

本頁定義產品不可退讓的政策邊界。各 agent 如何把規則放進 prompt、structured output 與 post-processing，見 [Agents 與 Prompts](agents-and-prompts.md)；驗證、組裝與持久化發生在哪個 runtime 階段，見 [Runtime Flows](runtime-flows.md)。

## 不可協商規則

- 前端程式碼絕對不能直接呼叫 LLM provider。
- API key 留在 backend 環境變數中、絕對不 commit。
- 跨 feature 邊界的 LLM output 必須經 schema 與對應的程式 gate 驗證；prompt 指示不能取代驗證。
- 面向使用者的財經事實主張必須可追溯到 citations；無足夠來源時應明示資料不足或降級，不得補造來源。

## 投資建議邊界

系統不能對證券或 ETF 提供個人化的買、賣、持有、加碼、減碼指示，也不能使用保證獲利或斷言漲跌的語言。產品只提供描述性 context 與條件式傳導分析，並保留「非投資建議」聲明。

`packages/shared/src/compliance.ts` 是目前 canonical 的程式執行規則：`FORBIDDEN_PHRASES` 保存禁用語，`checkCompliance` 先檢查這份清單，再檢查個股／公司名稱附近的方向性用語。明確第三方歸因的例外只適用於後一層 ticker-direction proximity 檢查；若文字本身含有已列入 `FORBIDDEN_PHRASES` 的「看多」、「偏多」或「增持」等詞，仍會先被禁用語檢查命中。

這套 lexical／pattern gate 是目前輸出接受前的 final program gate，不等於完整法律合規保證。Prompt 會預防性約束模型；Worker post-processing 則讓 Synthesizer retry／sanitize，讓最終 brief 逐欄位掃描並移除違規句，Narrative 與 Podcast 也會在輸出接受前 sanitize、重驗與降級。逐 agent 行為與失敗語意以 [Agents 與 Prompts](agents-and-prompts.md) 為準。

## Citation 規則

- Tier 1 Analyst 只能引用本次 retrieved URLs，加上合法的 `http(s)` 主新聞 URL；Tier 2 只能引用該 parent 的 retrieved URLs。既有分析只可作為 context，不能直接成為 citation。
- Analyst 若輸出 allowlist 外 URL，會收到 feedback 重試；最後仍違規時 strip 未授權 citation，保留可用分析而不接受捏造連結。
- Daily Brief 組裝只接受 `http(s)` analyst citations，並去重、排序與設上限；`relatedNews` 由 selected-news id 反查真實 URL，無法 resolve 或非 `http(s)` 就移除。
- Narrative 與 Podcast 的 citation URLs 必須是已接受 `MarketBrief.citations` 的 subset；normalizer 先過濾，shared schema 再驗證。
- 沒有可佐證的外部 URL 時，可使用不可外開的 `data:insufficient` sentinel 表示資料不足；UI 不應把它當成來源連結。

這些 gate 位於 Worker 的 agent runner、brief assembly 與 shared schema 邊界，通過後才把 analysis／daily brief／podcast JSON 寫入 Postgres；API 只讀已保存結果，不在讀取時重新產生 citation。完整位置與資料生命週期見 [Runtime Flows](runtime-flows.md)。

Google News 代理來源（`isGoogleNewsProxySeed`）的 `news_items.url` 就是 RSS `<link>`
給的 `news.google.com/rss/articles/...` 轉址頁——這批來源在 feed 層整批跳過抓正文，
不會有任何步驟把它換回發行商網址。citation allowlist 的 base 直接取自 `news_items.url`，
所以這批來源的 citation 讀者點開會先落在 Google 的轉址頁，不是文章本身；這是讀者可見的
限制，不是缺陷。需要發行商網址的話，改用該發行商自己的公開 feed（`packages/db/src/seed.ts`
裡 cnyes／udn／yahoo-stock 是先例），或自行在 `apps/server/src/news/refresh.ts` 的
`resolveArticleTarget`／`fetchAndStoreBody` 接上 URL 解析。

## Cascade 注意事項

Cascade 依賴 corpus retrieval 與 citations 提供可追溯的推理鏈。沒有 citation 的二階 chain 可保留為 `speculative`，但必須用條件式語氣呈現、不能冒充已佐證事實；此標記由程式依 citation 是否存在決定，不由 LLM 自報。
