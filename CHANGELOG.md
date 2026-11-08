# Changelog

這個檔案記錄每個版本對使用者看得見的變更。格式依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版號依 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

從空樹重寫（`rewrite` branch），完成驗收後接回 `main`；v0 的程式碼與文件保留在 tag `v0-legacy`。各項取捨見 `docs/adr/`。

### 變更

- 架構改成每日排程的批次 pipeline 加靜態網站，不再有常駐 server：GitHub Actions 跑 pipeline，Astro 在同一個 job 內讀 Postgres 產出純 HTML，部署到 Cloudflare Pages（`suanomics.everbegin.net`）。
- 觸發器以 Cloudflare Worker 的 Cron Trigger 為主，Actions `schedule` 為備援。
- 持久狀態放 Neon Postgres，drizzle schema 與 migration 沿用。
- LLM 呼叫層改用 Vercel AI SDK（`generateText` 加 `Output.object`）；預設 provider 是 Anthropic，Gemini 只給品質評審。
- 網站由 Vue SPA 改成 Astro 靜態產生。
- monorepo 縮成三個 workspace：`packages/shared`、`apps/pipeline`、`apps/web`。
- 新聞來源只收官方機構與發行商自己的 feed，正文在 pipeline 內抽取。
- v0 上游 repo `macroeconomics-report` 的變更紀錄、研究報告與產品事實搬進 `docs/history/`。

### 移除

- 線上即時分析（`/brief/analyze`），改為維護者本機的 CLI。
- in-process job runner 與 `background_jobs` 表。
- OpenAI 相容端點路徑與自寫的 provider adapter。
- Gemini TTS 路徑。
- Prompt 研究工具 `packages/prompt-research` 不帶進本 repo，歸獨立 repo `baguanomics`。

## [0.1.0] - 2026-09-20

首次公開釋出。

### 內容

- 每日總經報告的 multi-agent pipeline：新聞抓取與分類、編輯選題、連動假說拆解、兩層分析、綜合、敘事寫手、正反觀點辯論、podcast 逐字稿與語音。
- 連動鏈（產業／機制／標的／方向）與引用來源驗證；敘事中的具名數字可追溯回證據（claim ledger）。
- 輸出前的合規攔截（`FORBIDDEN_PHRASES`）。
- LLM provider 可替換：Gemini（預設）、Anthropic，以及 OpenAI 相容端點。
- 單一 job 內的並行與呼叫數上限，批次腳本開跑前的呼叫量預估閘門。
- 離線品質量測工具：pairwise judge、canary 回歸偵測、model A/B、claim 指標。
- 讀者面 web（報告層與佐證層）、不需抓新聞的 demo 路徑（合成 fixtures）。
- 本機開發用的 docker compose 與參考部署設定。
- 所有送給模型的文字（system prompt 與 user content）集中在 `apps/server/src/prompts/`，與 agent 邏輯分開。
