---
status: accepted
date: 2026-11-07
---

# LLM 呼叫層用 Vercel AI SDK、不用 agent 框架

pipeline 是固定的 DAG：15 個階段各自「給 system prompt 與結構化輸入，要一份符合 schema 的 JSON」，沒有「模型自己決定下一步查什麼」的迴圈。需求是「每個階段可換 model、可換 provider」。v0 自寫三個 provider adapter，另有 7 個檔直接綁 `@google/genai` 繞過抽象，OpenAI 相容路徑從未對真端點跑過。決定改用 Vercel AI SDK（`ai` v7：`generateText` 加 `Output.object({ schema })`；`generateObject` 已標 deprecated 不採用），provider 目前只用 `@ai-sdk/anthropic`。

## Considered Options

- **Google ADK、Hermes Agent 之類的 agent 框架**：為自主 agent 迴圈設計，套在決定性 DAG 上是用錯形狀，且各自帶 runtime（ADK 偏 Google 生態、Python 優先）。
- **自寫 provider 層**（v0 做法）：每家 SDK 的結構化輸出形狀都不同，維護成本落在自己身上，且已出現繞過抽象的例外。
- **Vercel AI SDK**（採用）：MIT、不綁雲、model 是每次呼叫傳入的參數，剛好對上「一張表決定哪個 agent 用哪個 model」。

## Consequences

- OpenAI 相容路徑刪除，不帶進新架構。
- judge 用與產出不同家族的 model，可避免同家族評自己的輸出；judge 不在每日路徑上。目前全部用 Anthropic，judge 用哪一家在接回 judge 時（#33）決定。
- 每日花費硬閘沿用 v0 的 `totalCostUsd` 計量，加上 Anthropic Console 的 workspace spend limit。
- Anthropic 的 prompt caching 走 `providerOptions.anthropic.cacheControl`。
