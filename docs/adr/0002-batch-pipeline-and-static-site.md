---
status: accepted
date: 2026-11-07
---

# 排程批次加靜態網站，不養常駐 server

v0 架構是 Hono 常駐 process 兼 in-memory job runner 加 Postgres，每個頁面請求都查資料庫。這個形狀需要一台 24 小時開著的機器（Railway／Fly 最低約 US$5/月，VPS 相近），而 in-memory queue 只能單 instance。產品的核心輸出「每個交易日一份報告」在排程裡跑完就固定了，不需要有人來才算。決定把系統改成：GitHub Actions 每日跑一次 pipeline CLI，同一個 job 內 Astro 直接讀 Postgres 產成靜態網站，部署到 Cloudflare Pages。

## Considered Options

- **A. 排程批次加靜態讀**（採用）：讀路徑零 server、零資料庫曝露；public repo 的 Actions 免費不限分鐘。
- **B. Cloudflare 全家桶**：Pages 加 Workers 上跑 Hono 當讀 API 加 D1；多一層 API 保留日後互動功能的空間，但 Workers 的 CPU 上限不適合跑 30–60 分鐘的 pipeline，pipeline 仍要回到 Actions。留作升級路徑。
- **C. 容器**：現有架構幾乎原樣搬，加 scheduler；每月固定支出，單 instance 限制不變。

## Consequences

- 線上即時分析（`/brief/analyze`：讀者貼文章、後端即時算、前端輪詢 job）取消，降為維護者本機的 CLI。
- `@suanomics/jobs` 的 in-memory queue、retry、payload dedupe 在批次 CLI 裡沒有用處，由順序執行的 orchestrator 取代。
- 原本在 Postgres 的跨日狀態（storylines、market data 歷史、近日 brief 摘要、news 候選池）仍要有持久層，見 [持久狀態放 Neon Postgres、沿用 drizzle](0003-neon-postgres.md)。
- Actions runner 的 IP 會不會被資料源擋，已由 spike #16 實測（2026-11-07，[結果](../spikes/16-actions-ip.md)）：spike 當時預定的 16 個 endpoint 在 Actions 上全部可達，沒有被擋（FRED 的 400 與 EIA 的 403 是未帶 key 的預期回應），也沒有 429、連線失敗或逾時，ingest 可以全部跑在 Actions。只量了單一 runner、單一時間點，出口 IP 每次 run 可能不同，ingest 要逐來源記錄狀態碼、連續失敗時告警。TPEx 日收盤 JSON 在 runner 上要 22 秒，單一請求逾時至少設 60 秒。FRED、EIA 帶 key 的請求要等 #20 之後才實測。
