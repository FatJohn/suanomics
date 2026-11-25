# Google News 解碼路徑首輪實跑（2026-09-07）

> N0-2.5 第三刀（#356／#358／#362）merge 之後，第一次帶解碼跑完整的 `news:refresh`。
> 回答三件事：**真實落地率**（spike 加權預期 34%）、**#296 重量**（原數字 88.8%）、
> **#362 canary 拿到第一筆樣本後印什麼**。所有數字出自本機（台灣家用 IP）實跑，
> **機房 IP 仍未驗（#355）**。spike 的量法與母體見
> [2026-08-28 spike](2026-08-28-google-news-decode-spike.md)。

## 一句話

**解碼路徑上線後第一輪：359/359 解碼成功、零簽章被拒；10 個代理來源 449 則裡 212 則
落地成有內文的正文（47.2%），高於 spike 的 34% 下界。** 日報輸入「只有標題」的比例
從 08-23 量的 88.8% 降到本輪的 27.5%，而剩下的 27.5% 有八成是結構性的
（`ctee` 政策不抓、`bloomberg`／`wsj` 全數 401／403）。

## 這一輪

| 項目 | 值 |
|---|---|
| 觸發 | `pnpm --filter server news:refresh --timeout=5400`（本機、in-process runner） |
| 時間 | 2026-09-07 23:10:57–23:18:43 台北，**466 秒** |
| `background_jobs.id` | `2e3506ec-c060-4416-9d19-82a84b701dc3`（`status=completed`） |
| 來源 | 24 個啟用來源、0 個來源失敗 |
| 新增 | **862** 則（上一輪 09-05 22:05 之後的積壓，約 49 小時；`after-run-extra.txt`） |
| 併發 | `NEWS_FETCH_CONCURRENCY=3`（每來源內），來源之間序列 |
| LLM | 862/862 `tagged_at`、862/862 `category` 皆非 null（Gemini key 確認可用；`after-run-extra.txt`） |

★ 本機一輪 8 分鐘，不是交接裡寫的 31 分鐘——那是舊 prod 的數字。CLI 預設 timeout
20 分鐘對本機夠用。

## 解碼層（`perSource` 計數，出自 `background_jobs.metadata`）

| 計數 | 值 | 說明 |
|---|---|---|
| `decoded` | **359** | 10 源中 7 個關鍵字型代理＋`bloomberg`／`wsj` 的全部新條目 |
| `decodeFailed` | 0 | `no_signature`／`rpc_error`／`http_error`／`timeout` 全 0 |
| `signatureRejected` | 0 | |
| `feedSkipped` | 90 | 全部是 `google-news-ctee`（`site:` 型、feed 層短路） |
| `bodyDenied` | 4 | 解碼後落到 `ctee.com.tw`（`google-news-oil` 1、`-us-macro` 3） |

Google 請求量：359 × 2 ＝ **718 次、8 分鐘內、零錯誤**。這是目前單輪最大的一次
（spike 壓測是 460 次），但**仍是家用 IP**，撐不起機房結論；#355 不因此結案。

## 落地率（本輪新增、10 個代理來源）

「落地」＝ `content_source='scrape'` 且 `hasBodyBeyondTitle` 判 true（與 `news:health`
及 SLO 端點同一支函式）。本輪兩者逐源相等。

| 來源 | 新增 | 落地 | 比例 |
|---|---|---|---|
| `google-news-oil` | 84 | 72 | 85.7% |
| `google-news-us-macro` | 54 | 46 | 85.2% |
| `google-news-china` | 45 | 38 | 84.4% |
| `google-news-fin` | 26 | 22 | 84.6% |
| `google-news-global-macro-fin` | 26 | 15 | 57.7% |
| `google-news-ai-econ` | 12 | 10 | 83.3% |
| `google-news-cbc` | 11 | 9 | 81.8% |
| 七個關鍵字型代理小計 | **258** | **212** | **82.2%** |
| `bloomberg-markets` | 61 | 0 | 61/61 scrape 失敗（403） |
| `wsj-markets` | 40 | 0 | 40/40 scrape 失敗（401） |
| `google-news-ctee` | 90 | 0 | 政策不抓（`feedSkipped`） |
| **10 源合計** | **449** | **212** | **47.2%** |

**與 spike 的對照**：spike 按近 30 天母體加權給的下界是 34%（不抓中時系），本輪 47.2%。
差距主要來自關鍵字型代理的 scrape 成功率——spike 對「可達」樣本扣掉相異後的真值是
64%（±13pp），本輪是 82.2%。單輪、449 則、家用 IP，**是一個點估計不是趨勢**。

**★ 47.2% 是「有內文」的上界，不是「有資訊」**。隨機抽 8 則落地正文逐字看：
自由時報開頭夾「為達最佳瀏覽效果，建議…」的站台樣板、TradingKey 開頭是「掃碼下載」、
一則 51 字元的「親愛的會員，您已經登出」（被判 usable）、MoneyDJ 一則 Big5 亂碼
（spike 預告過的 `res.text()` 問題）。全體 212 則：長度 p50 1,438／p90 4,055 字元、
<200 字元 7 則、含 U+FFFD 1 則。這些是 `scrapeArticle` 的題目，不是解碼的題目。

## scrape 失敗 127 則（`scrapeFailed`）

| 來源 | 失敗 | 備註 |
|---|---|---|
| `bloomberg-markets` | 61 | 全數；log 抽樣 3 則皆 HTTP 403 |
| `wsj-markets` | 40 | 全數；log 抽樣 3 則皆 HTTP 401 |
| 七個關鍵字型代理 | 25 | `global-macro-fin` 10、`oil` 6、`us-macro` 3、`china` 2、`ai-econ` 2、`fin` 1、`cbc` 1 |
| `cnyes-world` | 1 | 非代理來源（直連 feed）；log 抽樣是 `news.cnyes.com` timeout |

log 每來源只印前 3 筆失敗，所以下面是**抽樣**不是全量：HTTP 403 × 12（`ftvnews.com.tw` 3、
`bloomberg` 3、`macromicro.me`／`gurufocus`／`axios`／`wantrich.chinatimes.com`／
`seekingalpha`／`ng.investing.com` 各 1）、HTTP 401 × 3（`wsj`）、
**`Headers Overflow Error` × 5（全部 `hk.finance.yahoo.com`）**、timeout 10 秒 × 2。
`Headers Overflow` 是 Node undici 的標頭上限，不是對方擋——這個 host 在關鍵字型代理裡
出現頻繁，值得單獨處理，已開 #366。

## #296 重量（「日報輸入只有標題」）

| 量法 | 只有標題 | 母體 |
|---|---|---|
| #296 原數字（2026-08-23、prod、18 源、近 7 天） | **88.8%** | 2,525 則 |
| 本輪跑前的 7 天窗（`news:health --days=7`） | 55.0% | 1,534 則（代理 842 則 usable 0） |
| **本輪新增** | **27.5%**（237 則） | 862 則 |
| 本輪跑後的 7 天窗 | 45.1% | 2,396 則（混了跑前的舊條目） |

本輪那 237 則裡：`ctee` 90 ＋ `bloomberg` 61 ＋ `wsj` 40 ＝ **191 則是結構性的**
（政策或付費牆，解碼救不了），另 46 則是七個關鍵字型代理留在 `rss-excerpt` 的
（`after-run-extra.txt` 逐源）。這 46 則只有 29 則有計數器承接——`scrapeFailed` 25 ＋
`bodyDenied` 4——**另 17 則（258 則的 6.6%）沒人算**：解碼成功、發行商站回 200、但
extractor 抽不到正文，`fetchAndStoreBody` 對 `ok: true, text: null` 既不計數也不 log，
只能拿 DB 減法倒推（#367）。要再往下壓，剩的槓桿是 scrape 那層（`hk.finance.yahoo.com`
標頭 #366、403 站台、#367 那 17 則的 extractor），不是解碼。

## #362 canary 的第一筆樣本

`summarizeDecodeHealth(getRecentDecodeRuns(5))` 對現況的輸出：`runs` 1 筆（359 attempts、
0 rejected）、`skippedRuns` 4（09-05 之前那些沒有解碼計數的輪）、**`decided: false`**、
`flags: []`。門檻是連續 2 輪，所以 watchdog 現在仍會印 `NO-DECODE-DATA`；再跑一輪才會
第一次做出判定。這一輪也證實 #363 要的資料在：10 個代理的 `perSource.inserted`
合計 449，判「這一輪有沒有代理新聞進來」用它就夠。

## 沒有量到的

- **機房 IP**（#355）：限流、可達性、簽章頁——三項全部未驗，本文任何數字都不能外推過去。
- **中時系的邊界**：`wantrich.chinatimes.com` 不在 `BODY_FETCH_DENIED_HOSTS`（只有
  `ctee.com.tw`），本輪有一則嘗試抓、回 403。拍板寫的是「`ctee` 不抓」，`chinatimes.com`
  其他站算不算中時系是政策題，留給使用者。
- **`yahoo-finance`（#352）沒有參與**：本機 `news_sources` 沒有這一列（24 源裡沒有它），
  是本機 DB 沒有重新 seed，不是程式問題。本 session 跑完之後已 `pnpm --filter @lab/db db:seed`
  補上（25 源），下一輪會有。
- 落地正文的**資訊量**只抽了 8 則，沒有像 spike 那樣逐則對「解出來的是不是那一則」。

## 產物

本機 scratchpad（session 結束會消失，數字已抄進本文）：`run.log`（完整 console 輸出）、
`before-health.json`／`after-health.json`（`news:health --json --days=7` 跑前跑後）、
`after-run.txt`（`perSource` 表、逐源落地率、canary 輸出）、`after-run-extra.txt`（LLM 覆蓋、
上一輪時間、七個關鍵字型代理逐源 `rss-excerpt` 數）、`_after.mjs`（量測腳本，
在 `packages/db` 底下以 `DATABASE_URL`／`RUN_START`／`AUDIT_ID` 執行）。

相關 issue／PR：#355（機房 IP 複驗）、#296（重量結果已回貼）、#362（canary 的 PR）／#363（canary
的分母問題）、#366（`hk.finance.yahoo.com` 標頭溢位）、#367（沒人算的那 17 則）。
