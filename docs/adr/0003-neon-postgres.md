---
status: accepted
date: 2026-11-07
---

# 持久狀態放 Neon Postgres、沿用 drizzle

pipeline 改成批次後仍有跨日要讀回的狀態：storylines（敘事連續性與週回顧）、近三日 brief 摘要、market data 歷史（YoY／MoM 要前期值）、news 候選池與 dedupe。v0 的 drizzle schema 與 repos 經過五個月實戰，是整次重構裡最沒有理由換掉的部分。決定用 Neon 的免費 Postgres（2026-11-07 查核：每專案 1 GB、100 CU-hours/月、閒置 5 分鐘自動休眠），從 Actions 直連，drizzle 與 migration 原樣沿用。

## Considered Options

- **Neon Postgres 免費層**（採用）：schema 零改動；每日一次冷啟動可接受。
- **Cloudflare D1**：與 Pages／R2 同家，但從 Actions 寫入只能走 HTTP API，drizzle 的 D1 driver 要在 Workers 內才自然；好處要等網站有 Workers 層才兌現。
- **SQLite 檔 commit 回 repo 或放 R2**：零服務，但 migration 與併發自己管、git 內長二進位檔。

## Consequences

- `background_jobs` 表與 audio storage 抽象從 schema 移除。
- CI 的真資料庫測試用 Postgres service container，與 v0 相同；Neon 只有 production 一個專案。
