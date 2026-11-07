---
status: accepted
date: 2026-11-07
---

# 網站用 Astro 靜態產生

網站要讓人搜得到。v0 是 Vue SPA，頁面內容在瀏覽器執行期才向 API 抓，搜尋引擎看到的是空殼。pipeline 改成批次後，每日資料在 build 時就已確定，沒有理由在執行期才渲染。決定用 Astro 在同一個 Actions job 內 build，直接讀 Postgres 產出每一天的純 HTML，Tailwind 沿用；需要互動的小塊（podcast 播放器、閱讀／收聽切換）以 Astro island 處理，v1 不含任何 island。

## Considered Options

- **Vue SPA 讀靜態 JSON**：改動最少，但 SEO 問題不變，且多一層 JSON 中介。
- **Astro 靜態產生**（採用）：純 HTML、SEO 直接解決、island 保留互動空間；Vue 元件可作 island 重用。
- **Next.js／Nuxt SSR**：需要執行期 server，與 [排程批次加靜態網站](0002-batch-pipeline-and-static-site.md) 衝突。

## Consequences

- 版面由 `impeccable` 從零重新設計，舊 DESIGN.md 與 mocks 只作「上一版」輸入；設計排在 v1 pipeline 連續產出真實資料之後。
- 部署流程是一條：pipeline → Astro build → `wrangler pages deploy`，v1 用不到 R2。
- 自訂網域 `suanomics.everbegin.net` 由 Cloudflare DNS 接到 Pages。
