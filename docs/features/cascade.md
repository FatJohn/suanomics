# Cascade

## 用途

Cascade 把財經新聞轉換成可追溯的市場 context：每日 brief、單則新聞分析、multi-agent 推理鏈、citations，以及有產製時可播放的 podcast。這是本專案目前的主產品。

Web 以 `/` 顯示最新報告、`/d/:date` 顯示指定日期；舊入口 `/brief` 只負責 redirect 到 `/`。日期選擇器由 `GET /api/brief/dates` 提供可用日期。

## 當前使用流程

### 每日 Brief

1. News、external articles、市場資料與跨日 storylines 被收進 Postgres。
2. Daily Brief job 挑選新聞、載入 context，執行 multi-agent pipeline，組裝並驗證 structured market analysis、cascade chains、citations 與 narrative。
3. Worker 保存報告後，best-effort enqueue `podcast-generate`；只有新產生 podcast 成功時才再 best-effort enqueue `podcast-tts`。若命中既有 podcast 而跳過產生，這次不會補排 TTS；報告也不因後續 podcast chain 失敗而回滾。
4. Web 在 `/` 或 `/d/:date` 讀取已保存的報告，呈現所選新聞、narrative、cascade chains、podcast 文字與已存在的 audio。

### 單則新聞 Analyze

1. 使用者送出 title、content、與可選的 URL 到 analyze form。
2. `POST /api/brief/analyze` 驗證輸入後建立或沿用既有 audit；只有需要新執行時才把分析 job 排進同 process 的 runner，並回傳 `202` 與可供等待的 job／result reference。
3. Web 非同步等待分析；Worker 視需要載入 corpus、執行分析並把結果存進 Postgres。完成後 Web 讀取 analysis payload，渲染 citations 與 cascade-chain UI。

Audit reuse、routing modes、polling、取消等待與 job lifecycle 的精確行為見 [Runtime Flows](../architecture/runtime-flows.md#ad-hoc-analyze)。

## Pipeline

- Corpus ingestion 與 enrichment 蒐集候選財經 context。
- Retrieval 找到相關 articles、sources、與 entity 對應。
- Agent 階段做選稿、decompose、retrieve、tiered analysis、synthesize 與 narrative；podcast writer 在獨立 job 接續已保存的 brief。
- Output 經 shared schemas、citation allowlist、URL 組裝與 compliance gate 驗證；來源涵蓋不足時採明確降級，不接受捏造 URL。

完整 job、persistence、retry、降級與 audio delivery 見 [Runtime Flows](../architecture/runtime-flows.md)；agent 順序、prompt contract、model / provider 與 failure semantics 見 [Agents 與 Prompts](../architecture/agents-and-prompts.md)。

## 資料來源

- 在 backend seed data 中設定的 RSS 與 official / external sources。
- 存在 Postgres 的 external article corpus。
- 產出的 analyses、daily briefs、narrative JSON、podcast JSON、與 podcast audio path。
- 市場時間序列、經濟行事曆與跨日 storylines；不可用時各自降級，不阻擋所有產製。
- Prompt-research artifact 只有經人工 review 並進入 production prompt 後，才會改變 Cascade runtime。

## API 與 UI 入口

- API：`GET /api/brief/daily`
- API：`GET /api/brief/by-date/:date`
- API：`GET /api/brief/dates`
- API：`GET /api/brief/news/:id`
- API：`GET /api/brief/analyses/:id`
- API：`POST /api/brief/analyze`
- API：`GET /api/jobs/:jobId`
- API：`GET /audio/podcast/:filename`
- Web：`/`、`/d/:date`、`/brief/news/:id`、`/brief/analyze`；`/brief` 僅為相容舊網址的 redirect。

## 維運

- 本機開發細節見 [本機開發](../operations/local-dev.md)。
- 部署細節見 [部署](../operations/deploy.md)。
- 部署驗證見 [Smoke Test](../operations/smoke-test.md)。

## 已知限制

- Corpus refresh、brief generation、podcast generation、TTS audio 部分流程仍可能需要手動或外部觸發。
- Podcast audio 在 local dev 可使用本機暫存；分離部署則由 Worker 寫入 R2 / S3-compatible storage，API 以 redirect 交付。兩種模式的設定與限制見 [Runtime Flows](../architecture/runtime-flows.md)。
- 來源品質取決於設定的 sources、scraping 可靠度、與 enrichment 品質。
- 產品必須維持 citation 可追溯性、與投資建議邊界的可見度。

## 未來方向

見 [Shared Finance Knowledge](../architecture/shared-finance-knowledge.md)。
