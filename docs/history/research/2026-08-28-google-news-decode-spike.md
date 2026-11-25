# Google News 轉址解碼可行性 spike（2026-08-28）

> N0-2.5 第三刀的前置量測。回答的是「**能不能**解碼、解出來**能不能**抓到正文」，
> 不是「該不該做」——後者是使用者的決定，本文只把數字與取捨攤開。
> 所有數字出自本機（台灣家用 IP）實跑，產物路徑見文末。**機房 IP 一律未驗。**

## 一句話

**Google News 的轉址解碼在技術上完全可行**（49/49 拿回發行商 URL、壓測未觸發限流），
但**解碼不等於拿得到正文**：按第三刀真實母體加權，能落地成可用正文的是
**34%（不抓中時系）到 55%（抓）**，不是初測印象中的 74%。現況是這 10 個來源
**近乎 0%**（近 30 天 9,786 則裡只有 3 則有超出標題的內文），所以即使取下界也是實質躍升。

## 為什麼需要它

第一刀之後，21 個日報來源裡還有 10 個是 `title-only` + `no-scrape`：7 個關鍵字型
Google News 代理，加 `google-news-ctee`／`bloomberg-markets`／`wsj-markets`。它們的
RSS item link 指向 `news.google.com` 轉址頁，進了選稿池只有標題、零資訊。

## 機制（實測，非推測）

新格式的 base64（`AU_yqL…`）解出來是 protobuf blob，**沒有內嵌網址**；舊的「直接
base64 decode 拿 URL」已失效。可行的路徑是重現 Google 未公開的 `batchexecute` RPC：

1. `GET https://news.google.com/rss/articles/<id>` 取中介頁，從 HTML 讀
   `data-n-a-sg`（簽章）／`data-n-a-ts`（時戳）／`data-n-a-id`
2. `POST https://news.google.com/_/DotsSplashUi/data/batchexecute`，rpcid **`Fbv4je`**，
   payload `["garturlreq",[…],<id>,<ts>,<sg>]`

**★ 一項曾被記為「已查證」的事實是錯的**：中介頁**有**簽章，屬性名是 `data-n-a-sg`。
`grep -o` 對中介頁（591,049 bytes ＝ 577 KiB）計數：`data-n-a-sg=` 1 次、`data-n-a-sig=` **0 次**。
先前查不到只是查錯字串，不是 Google 拿掉了它。

每則成本＝**2 次 Google 請求**。簽章不是短 TTL：15 分鐘前取得的 `ts`＋`sg` 重打仍成功，
可以批次快取。

## 三個數字（修正後）

**(a) 解碼成功率 49/49。** 抽 50 則實跑，其中兩則是同一個 gnUrl（cnyes/6590541），
去重後母數 49。全數拿回非 google host 的發行商 URL，43 個不同 host，0 則落在
consent／AMP 頁。

**(b) 目標站可達 39/50（78%）。** 11 則失敗全是**發行商端擋人**，不是解碼壞掉——
獨立用瀏覽器 UA 重抓 50 則得到完全相同的狀態碼，且失敗頁的 `<title>` 是
`Just a moment...`（Cloudflare）／`Bloomberg - Are you a robot?`／`Vercel Security
Checkpoint`。403×10、429×1。

**(c) 真正可用正文 32/50（64%）。** 這是本 spike 最容易被高估的數字，初測報的
「37/39（95%）」有三層灌水，逐則讀完 37 份正文才看得出來。**從 39 則可達起算、扣掉
7 則相異**（下表的則號互不重複；第一版的表把 hket 同時列進「抽不到」與「解到首頁」而
重複扣了一次，也漏了 i=17 那則付費牆）：

| 扣除項 | 則數 | 則號 | 說明 |
|---|---|---|---|
| 抽不到正文 | 2 | i=16、i=35 | `invest.hket.com`、`stock.ltn.com.tw`，cheerio 選不到 `p`，`textLen`=0。★ i=16 同時也是全樣本**唯一**「解出的 URL 不是那篇」（回的是頻道首頁），但它只扣一次 |
| Big5 亂碼 | 2 | i=13、i=21 | `cb.yna.co.kr`、`www.moneydj.com` 的 HTTP header 都宣告 `charset=big5`，而 `scrapeArticle` 用 `res.text()`（undici 一律當 UTF-8）→ 必亂碼。`hasBodyBeyondTitle` 照樣判 true。**可修**：`TextDecoder('big5')`，repo 在 TAIFEX 那刀有前例 |
| 付費牆殘段 | 3 | i=11、i=17、i=45 | `zh.cn.nikkei.com` 236 字是摘要＋「敬請登錄以便觀看全部文章」；`money.udn.com` 兩則（547／683 字）全是導覽＋「本文共 N 字」的 CTA＋「此為訂戶獨享」，一句內文都沒有 |

39 − 7 = **32**。可用集的長度：n=32、**p50 1,412／p90 5,176**（初測報的 p50 1,184
分母含 0 字與亂碼）。★ n=50 的 64% 誤差帶約 ±13pp，下面的加權數字是點估計、不是精密值。

**★ 「解出來的是不是那一則」單獨驗過**：39 則 200 的頁面抓 `<title>` 與 RSS title 比對，
38 則是同一篇；被擋的 11 則用 URL slug 判，9 則逐字對應、2 則無 slug 無法判定。
**47/50 對得上、1 對不上、2 無法判定。** 這條若不成立，前兩個數字全部無意義。

## ★★ 抽樣只涵蓋一半母體，而漏掉的那半更難

spike 只抽了 7 個關鍵字型代理。第三刀的真實母體是 **10 個來源、近 30 天 9,794 則**：

| slug | 30 天篇數 | 佔比 | 解碼後可達？ |
|---|---|---|---|
| `google-news-ctee` | 2,087 | 21.3% | **30/30 解碼＋200＋有正文**（補測，見下）；但有政策問題 |
| `bloomberg-markets` | 1,439 | 14.7% | **0/10，全數 403** |
| `google-news-oil` | 1,384 | 14.1% | 已測，含在 39/50 內 |
| `wsj-markets` | 1,089 | 11.1% | **0/10，全數 401** |
| `google-news-china` | 877 | 9.0% | 已測 |
| `google-news-us-macro` | 863 | 8.8% | 已測 |
| `google-news-ai-econ` | 700 | 7.1% | 已測（本組最差，3/7 有正文） |
| `google-news-fin` | 521 | 5.3% | 已測 |
| `google-news-global-macro-fin` | 507 | 5.2% | 已測（3/7） |
| `google-news-cbc` | 327 | 3.3% | 已測 |

抽樣框＝7 個關鍵字型＝5,179 則＝**母體的 52.9%**。

**現況基準線（要有數字才知道躍升多少）**：這 10 源近 30 天 9,786 則，`content_source`
**零則是 `scrape`**，而以 SQL 近似 `hasBodyBeyondTitle`（剝標記與 entity、去非
alnum、小寫，再判 title 是否涵蓋 body）只有 **3 則**為 true（`-cbc` 1、`-us-macro` 2）
＝ **0.03%**。★ 近似法自身驗過：同一條 SQL 對有 scrape 的 `ltn-business` 跑，
1,045/1,045 全 true——CJK 沒有被 `[^[:alnum:]]` 吃掉，所以那個 0.03% 不是量法造成的。

**★ 一個容易算錯的地方**：若用「近 30 天 `news_items.url LIKE '%news.google.com%'`」
取母體，會多撈到 `google-news-udn`(2,097)／`-yahoo-stock`(1,937)／`-cnyes`(739)——
那是**第一刀換直連之前的歷史殘留**，它們的 `rss_url` 現在已經是 `money.udn.com`／
`tw.stock.yahoo.com`／`news.cnyes.com`，不再是第三刀的對象。母體要從
`news_sources.rss_url LIKE 'https://news.google.com/%'` 認，不是從歷史 URL 認。

**中時系補測（2026-08-28 追加，30 則）**：解碼 30/30、全部 HTTP 200、`hasBodyBeyondTitle`
30/30 true，`content-type` 全是 `charset=utf-8`、零亂碼，逐則讀過都是真財經內容
（長度 p50 806／min 330／max 1,652，比關鍵字型組短——中時系是日報體例）。唯一噪音是每篇
開頭固定一句「已將目前網頁的網址複製到您的剪貼簿！」。**所以下面的 55% 不是外推，是實測。**

**加權後的落地率**（分子分母都寫出來，兩組的條件不同）：

- `bloomberg`＋`wsj` 合計 25.8%：**各抽 10 則、20/20 全數 403／401，未見任何一則可達**。它們的條目指向 bloomberg.com／wsj.com 本身，解碼成功也進不去。（不寫「確定」——20 則、單一 IP／UA／單一時點。）
- 抓中時系：52.9%×**64%**（32/50，無條件率）＋ 21.3%×**100%**（30/30）≈ **55%**
- 不抓中時系：52.9%×64% ≈ **34%**

## 中時系（`ctee`）是政策題，不是技術題

`www.ctee.com.tw/robots.txt` 封鎖的是一份**具名清單**（`anthropic-ai`／`ClaudeBot`／
`GPTBot`／`PerplexityBot`／`CCBot`／`Bytespider` 等 30 餘個 AI bot，`Disallow: /`），
並另外具名允許 Google／Meta 的爬蟲。**全檔沒有 `User-agent: *` 段**——依 robots 規範，
沒有匹配 group 就不受限制，而本 repo 的 scraper UA 是
`Mozilla/5.0 lab-ai-john/1.0 (news analyzer)`（[scraper.ts:61](../../apps/server/src/external/scraper.ts)），不在封鎖清單內。

所以：**規範上可抓、精神上它明擺著不想被 AI 爬。** 這 21.3% 算不算，是使用者的決定，
不是工程判斷。（先前 backlog 記「robots.txt 明擋所以不該繞」——擋是真的，但那份清單
不含我們，這一句要補上。）

## 脆弱性

- **依賴未公開端點**：rpcid `Fbv4je`。Google 改動就會壞。
- **壞掉的方式**：簽章不符時 RPC 回 **HTTP 200**、內層 payload 為 `null`。★ 但**不是
  完全無訊號**——envelope 第 6 欄成功是 `null`、失敗是 `[3]`，可機械判定：
  好簽章 `["wrb.fr","Fbv4je","[\"garturlres\",…]",null,null,null,"generic"]`；
  壞簽章 `["wrb.fr","Fbv4je",null,null,null,[3],"generic"]`。rpcid 被改名則回 400 + `["er",…]`。
  接進管線要配一支 canary：連續 N 則 payload 為 null 就告警，否則會靜默退回今天的
  title-only 狀態而沒人發現。
  ★ **這個形態當晚就重現了一次，而且是假警報**：補測中時系時腳本一口氣 50/50 全部
  `DECODE_FAIL`，看起來完全像被 Google 封了——實際是我把 `batchDecode` 的回傳（物件
  `{ok,url}`）當成字串接，`new URL(undefined)` 拋 `Invalid URL`。**「整批失敗」的第一
  嫌疑人永遠是量測端，不是被測端**；修好之後同一批樣本 40/50 正常（另 10 則是 wsj 的 401）。
- **限流：本機住宅 IP 單次約 460 請求未觸發任何 429**（sequential 100 req/≥52.7s、
  burst 30 concurrent 60 req/4.9s、持續 300 req/28.6s）。★ **這個測法的射程只到這裡**：
  三批量測合計不到三分鐘的實際打點時間，量不到延遲生效或滾動時窗的封鎖；沒有每日累計量測試
  （**這 10 源近 30 天實測**：台北曆日均 326 則、有資料日均 316、單日最高 510
  → 每天約 650 次 Google 請求、峰值約 1,020 次，是本次單輪的兩倍且天天發生。
  ★ 第一版寫的「每天約 486 則」查無出處，已用 SQL 重算取代）；最關鍵的是
  **測試從住宅 IP 打、生產在機房 IP**，而本 repo 已有記錄在案的反例（udn feed 本機 200、
  prod 容器 403，見 #269）。**要做之前必須從 prod 容器補一輪。**

## 對照組：加直連 RSS 來源（同日實測）

★ **這一節的百分比與上面不同底**：分母是「**7 個關鍵字型代理近 90 天**」的 11,575 則，
不是上面那個「10 源近 30 天」的 9,794 則。換算到 10 源母體，下面的 5.24% 約當 2.8%。

top-30 未覆蓋發行商佔那 7 個代理近 90 天的 29.5%，但逐一探測後只有 4 個 feed 真的可用
（`tw.news.yahoo.com/rss` 與 `/rss/finance`、`newtalk.tw/rss/all`、`bastillepost` 香港），
**合計只補得回 5.24%**（607/11,575）。樂觀上限 7.24% 是把 Yahoo 作為再供稿聚合層帶出的
三立／FTNN／太報轉載算進去，**那 +2.00% 是上限估計、未驗證**——代理收到的那則不保證
Yahoo 也收。其餘不是 title-only（Investing.com、HKET、PChome），就是 robots.txt
明擋（大紀元／RFI／太報）或根本沒有 feed（商傳媒、富聯網、非凡、信報、香港01…）。

★ 探測過程抓到兩個**假陽性**，值得記住這個形態：TradingView 的 feed 三項檢查全過，
但內容是社群交易觀點、不是我們收到的新聞流；FXStreet 英文 feed 過，但 DB 裡那 89 則
是中文稿、來自 403 的 `cn.fxstreet.com`。**「feed 可用」與「feed 裝的是同一批內容」是
兩件事。**

**結論：這條補不回主體，不能當成解碼路徑的替代品**，但 Yahoo 那條成本是一列
`news_sources`、順帶撿到三家我們直接進不去的媒體，可以獨立於第三刀先做。

## 待決（使用者決定，不預設）

1. **要不要走解碼路徑**。上界 55%／下界 34%（現況 0.03%），代價是一條依賴 Google 未公開
   RPC 的路徑＋一支必要的靜默失敗 canary＋每則 2 次額外請求（每天約 650 次、峰值 1,020）。
2. **中時系那 21.3% 抓不抓**（見上節，政策題）。
3. 若要做，**先從 prod 容器補限流與可達性複驗**——住宅 IP 的數字撐不起機房的結論。

## 產物

本機 scratchpad（session 結束會消失，數字已抄進本文）：
`gn-decode-spike/`（`results.csv` 逐則、`decode-results.json`、`scrape-results.json`、
`fragility.json`、`loadtest.json`、`decoder.mjs` 等腳本；中時系補測是
`ctee-sample.json`／`ctee-results.json`／`run-ctee.ts`）、`verify/`（獨立重抓的
`refetch.json`、逐則正文 `pages/*.txt`、被排除來源的 `excluded-probe.json`）、
`rss-alt-survey/`（`REPORT.md`、`top30-uncovered.sql`、`probe-log.txt`）。
