# Changelog

這個檔案記錄每個版本對使用者看得見的變更。格式依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版號依 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

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
