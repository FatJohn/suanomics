# 兩套語料系統：brief 選題 vs cascade 檢索

> 2026-06-13 新增。釐清 repo 內兩套**獨立、職責不同**的語料系統、避免把 `external_sources` 誤當 brief 的新聞來源。

repo 有兩套新聞語料系統、各有自己的來源表與文章表、**互不相通**：

| 系統 | 來源表 | 文章表 | 主要 reader | 用途 | 現況 |
|------|--------|--------|-------------|------|------|
| **Brief 選題語料** | `news_sources`（int PK、`packages/db/src/seed.ts` 的 `SEED`） | `news_items` | `selectNewsForBrief` / `getRecentNewsItems`（`packages/db/src/repos/news-repo.ts`）→ editor agent / recency fallback | 決定 daily brief **寫哪些新聞題目** | 在用 |
| **Cascade 檢索語料** | `external_sources`（uuid PK、`packages/db/src/seed-external-sources.ts` 的 catalog） | `external_articles` | `retriever.ts`（GIN on `entities` / `topic_tags`） | cascade chain 找 **citation** 佐證 | DB 通常為空（`corpus-worker` 未常態跑） |

## 關鍵區分

- **Brief 寫什麼題目、只由第一套決定。** `news_sources` 餵 `news_items`、`selectNewsForBrief` 從 `news_items` 取近窗候選、editor 選稿。要讓某類新聞（例：總經 CPI/油價/央行）出現在 brief、**來源必須加進 `news_sources`（`seed.ts` 的 `SEED`）**。
- **`external_sources` / `external_articles` 不影響 brief 選題。** 它是 cascade 檢索系統、供 analyst 在組 cascade chain 時撈 citation 用、且 `external_sources` 的 30 來源 catalog 與 brief 無關。
- `seed-external-sources.ts` 的來源網址清單**可重用**（已 curate）、但若目的是擴 brief 涵蓋、落點是 `news_sources`、不是 `external_sources`。

## Ingestion

- Brief 語料：`news:refresh`（`apps/server/src/news/refresh.ts`）→ `getActiveSources()` 讀 `news_sources` → `fetchRss` + `parseRssXml`（**只吃標準 RSS XML**）→ insert `news_items` → scrape 內文。
  - ★ Google News 代理來源（`isGoogleNewsProxySeed` 判準：`rss_url` 的 host 是
    `news.google.com`）到 insert 就停、不進 scrape 內文那一步——這批來源的 `<link>`
    是轉址頁，抓那一頁本身就拿不到正文。讀者拿到的是標題與轉址連結，需要正文請自行
    以合法方式取得：改用發行商自己的公開 feed（`seed.ts` 裡 cnyes／udn／yahoo-stock
    是先例），或自行在 `refresh.ts` 的 `resolveArticleTarget`／`fetchAndStoreBody`
    接上 URL 解析。
- Cascade 語料：`corpus-refresh`（`corpus-worker.ts`）→ `external_sources` → 支援 rss / html-selector / official-feed 三種 kind + LLM 豐富化（entities / topic_tags / summary）→ `external_articles`。

## Tech debt note

兩套來源表 + 兩套文章表本身是重複。是否統一（cascade 檢索與 brief 選題共用同一語料池）是未來工程、需另案評估、目前刻意分開。

## 沿革

- 2026-06-13：往 `news_sources` 加 9 個總經/國際/能源 RSS 來源（4 個繁中 Google News 查詢 + eia / oilprice / cnbc-markets / bloomberg-markets / wsj-markets）、修「brief 語料只有台股」的涵蓋缺口。
