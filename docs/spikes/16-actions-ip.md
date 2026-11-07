# Spike #16：GitHub Actions runner 能不能打到 v1 資料源

讀者：維護者、盤點 session（回寫 ADR 0002／0007 用）
型別：說明

**結論：Phase 1 的 ingest 可以全部跑在 Actions。** 16 個 endpoint 在 Actions ubuntu runner 上全部連得到，沒有 403、429、連線失敗或逾時；狀態碼與內容判定和本機對照組逐列相同。要另外處理的只有兩件與 IP 無關的事：NHK World 沒有找到官方的文字新聞 RSS（見〈未解項目〉），TPEx 日收盤 JSON 在 runner 上要 22 秒。

## 量測條件

| 項目 | Actions | 本機對照 |
|---|---|---|
| 量測時間（UTC） | 2026-11-07T15:03:54Z | 2026-11-07T15:02:50Z |
| 環境 | GitHub-hosted `ubuntu-latest`（Linux ubuntu24 20261101.360.1） | macOS arm64，台灣家用網路 |
| 腳本 commit | `fdd74ce8e061c5a2944a588112d9b8d5b6747be1` | `fc6bfb2` 上未 commit 的 `spikes/16/probe.sh`（與 fdd74ce 的差異只在 log 截斷用的 `tr` 加 `LC_ALL=C`，不影響表格欄位） |
| Run | https://github.com/FatJohn/suanomics/actions/runs/42384531407 | — |

做法：`spikes/16/probe.sh` 對每個 URL 用 curl 打 1 次（跟隨轉址、連線逾時 15 秒、總逾時 40 秒），請求間隔 2 秒，User-Agent `Mozilla/5.0 (compatible; suanomics-probe/0.1)`，不帶任何 key。內容判定：RSS 數 `<item` 標籤；JSON 用 Python `json.load`；需要 key 的端點（FRED、EIA）回 4xx 且帶該服務自己的錯誤 JSON 就判「網路可達、未被擋」。重跑：`bash spikes/16/probe.sh`。

## 結果

「預期內容」欄是 Actions 上的判定；本機判定逐列相同，只有 cnyes 與 udn 的 bytes 不同（feed 在兩次量測之間更新）。

| # | 來源 | URL | Actions HTTP | Actions 預期內容 | Actions 耗時 s | 本機 HTTP |
|---|---|---|---|---|---|---|
| 1 | TWSE MI_INDEX | https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX | 200 | 是：JSON list 267 筆 | 1.72 | 200 |
| 2 | TPEx 上櫃日收盤 | https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes | 200 | 是：JSON list 13618 筆（5.3 MB） | 22.24 | 200 |
| 3 | FRED（不帶 key） | https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&file_type=json | 400 | 可達：FRED 錯誤 JSON `error_code` 400（`api_key is not set`） | 0.28 | 400 |
| 4 | EIA v2（不帶 key） | https://api.eia.gov/v2/petroleum/pri/spt/data/ | 403 | 可達：EIA 錯誤 JSON `API_KEY_MISSING` | 0.33 | 403 |
| 5 | 央行 新聞稿 | https://www.cbc.gov.tw/tw/rss-302-1.xml | 200 | 是：`<item>` 500 | 4.38 | 200 |
| 6 | 金管會 新聞稿 | https://www.fsc.gov.tw/RSS/Messages?serno=201202290009&language=chinese | 200 | 是：`<item>` 601 | 2.68 | 200 |
| 7 | 行政院 本院新聞 | https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3 | 200 | 是：`<item>` 50 | 1.70 | 200 |
| 8 | cnyes 頭條 | https://news.cnyes.com/rss/v1/news/category/headline | 200 | 是：`<item>` 100 | 1.08 | 200 |
| 9 | udn 經濟日報 要聞 | https://money.udn.com/rssfeed/news/1001/10846?ch=money | 200 | 是：`<item>` 20 | 0.36 | 200 |
| 10 | Yahoo 股市 新聞 | https://tw.stock.yahoo.com/rss?category=news | 200 | 是：`<item>` 50 | 0.55 | 200 |
| 11 | 中央社 財經 | https://feeds.feedburner.com/rsscna/finance | 200 | 是：`<item>` 20 | 0.20 | 200 |
| 12 | BBC Business | https://feeds.bbci.co.uk/news/business/rss.xml | 200 | 是：`<item>` 54 | 0.38 | 200 |
| 13 | Al Jazeera All | https://www.aljazeera.com/xml/rss/all.xml | 200 | 是：`<item>` 25 | 0.17 | 200 |
| 14 | NHK World Radio English（podcast RSS） | https://www3.nhk.or.jp/rj/podcast/rss/english.xml | 200 | 是：`<item>` 1 | 0.56 | 200 |
| 15 | NHK World news JSON | https://www3.nhk.or.jp/nhkworld/data/en/news/all.json | 200 | 是：JSON object（`data` 陣列） | 0.77 | 200 |
| 16 | TechNews 科技新報 | https://technews.tw/feed/ | 200 | 是：`<item>` 40 | 0.79 | 200 |

URL 的出處：TWSE 由 issue 指定；TPEx 路徑列在 `https://www.tpex.org.tw/openapi/swagger.json`；央行、行政院、中央社、cnyes 取自各自官網頁面的 RSS 連結（央行 `lp-302-1.html`、行政院 RSS 頁、中央社 `about/rss.aspx`、cnyes 頭條頁的 `application/rss+xml` link）；金管會取自其 RSS 頁 `main.jsp?websitelink=rss.jsp`；udn 的 `10846` 是經濟日報「要聞」分類編號；FRED、EIA 是兩者官方 API 的 series／data 端點。

## 被擋的來源

本次量測沒有被擋的來源：16 列都沒有 403（非 key 造成）、429、連線失敗或逾時。FRED 的 400 與 EIA 的 403 是沒帶 key 的預期回應，回應內容是兩家服務自己的錯誤 JSON，代表請求已到達服務端。

| 來源 | 現象 | 替代方案 | 替代方案實測 |
|---|---|---|---|
| （無） | — | — | — |

## 未解項目

| 項目 | 現況 | 建議 | 實測 |
|---|---|---|---|
| NHK World 文字新聞 RSS | NHK World 英文站是 JS 渲染，頁面沒有 RSS link；試過的 `nhkworld/en/news/rss.xml` 與 `nhkworld/data/en/news/rss.xml` 本機回 404。找到的兩個官方網域 endpoint：podcast RSS（只有 1 個 `<item>`，是廣播音檔）與 `all.json`（未公開文件化的站內 JSON） | 用 `all.json` 取標題與連結，或改走 RSSHub 的 NHK route，或放棄 NHK 只留 BBC、Al Jazeera；由 #18（RSSHub spike）或 ingest issue 決定 | `all.json` 已在 Actions 實測 200 且 parse 得過；RSSHub route 未實測 |
| TPEx 日收盤耗時 | Actions 22.24 秒、本機 0.78 秒，回應 5.3 MB | ingest 的單一請求逾時至少設 60 秒；若只需要指數，改查較小的 TPEx endpoint | 未實測 |
| FRED／EIA 帶 key 的真實請求 | 本次依 #20 前不帶 key 的約束，只證明網路可達 | #20 完成、key 進 GitHub Environment 後，在 ingest issue 首次實跑時確認 200 | 未實測 |

## 量測的限制

- 每個 URL 只在一個 runner、一個時間點打 1 次。GitHub-hosted runner 的出口 IP 每次 run 可能不同，這次 200 不保證每天都 200；ingest 對每個來源要記錄狀態碼，連續失敗時告警。
- 沒有收集各來源的使用條款連結；條款整理在建 `docs/sources.md` 的 issue 處理。
