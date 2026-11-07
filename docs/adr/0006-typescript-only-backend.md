---
status: accepted
date: 2026-11-07
---

# 後端維持 TypeScript

重寫時考慮過把 pipeline 換成 Go 或 C#。pipeline 是 I/O-bound（等 LLM、等 HTTP），執行效率在這裡換不到東西，但要付三個代價：經五個月調校的 15 支 prompt builder、normalizer、Zod schema、drizzle repos 全部重寫；pipeline 與 Astro 網站共用 Zod 契約的 `shared` package 做不到，要改成 JSON Schema 產生再兩邊 codegen；Vercel AI SDK 是 TypeScript 專屬，換語言就回到各家 SDK 自己包 provider 層。決定後端只有 TypeScript。

## Consequences

- 真的出現 CPU-bound 的步驟時，寫成獨立 CLI 由 pipeline 呼叫，不改主語言。
- GitHub Actions runner 內建 Node，pnpm 用 `pnpm/action-setup` 安裝，沒有額外 runtime。
