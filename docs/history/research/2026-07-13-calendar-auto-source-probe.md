# 財經行事曆自動化源頭探測報告

> 日期：2026-07-13
> 目的：verify-first 探測「公司事件」（T9：法說會/除權息）與「總經事件」（未來換源）兩類免費官方源的實際請求格式與回傳結構。**本報告只探測、不寫 code、不接 pipeline。**
> 誠實聲明：以下每個結論皆附「真實 curl / firecrawl 輸出截段」，抓不到的明確標「未取得」。沒有任何端點是憑訓練記憶編造——中途曾誤用一個猜測的央行網址（見 B3 節說明），已改用 firecrawl-search 找到真實網址並重新驗證。

---

## A 類：公司事件源（T9 優先）

### A1. TWSE 開放資料平台 — 上市股票除權除息預告表（`TWT48U_ALL`）

- **URL**：`https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL`
- **請求方式**：`GET`，無 query 參數，無分頁，無需任何 API key / cookie / referer。
- **真實 response 截段**（2026-07-13 實測，`curl -sS "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL"`，HTTP 200，78,284 bytes）：
  ```json
  {
    "Date": "1150709",
    "Code": "00400A",
    "Name": "主動國泰動能高息",
    "Exdividend": "息",
    "StockDividendRatio": "",
    "SubscriptionRatio": "",
    "SubscriptionPricePerShare": "",
    "CashDividend": "0.120000",
    "SharesOffered": "",
    "SharesEmpOwner": "",
    "SharesholderOwner": "",
    "StockHoldingRatio": ""
  }
  ```
- **回傳格式**：JSON array（298 筆，2026-07-13 當下）。編碼 UTF-8。Swagger 文件（`https://openapi.twse.com.tw/v1/swagger.json`）標註同一端點也支援 `text/csv`（`produces: ["application/json", "text/csv"]`，未實測 CSV 分支）。
- **關鍵欄位對應**：
  - `date`：`Date` 欄為**民國年 7 碼字串**（`1150709` = 115 年 07 月 09 日 = `2026-07-09`），需寫 ROC→ISO 轉換 helper。
  - `title`：無現成 title 欄，需自組（`Name` + `Code` + `Exdividend` 語意，如「元大台灣50（0050）除息」）。
  - `region`：無此欄，恆為 `TW`。
  - `importance`：無此欄，需自訂預設值。
- **更新頻率／認證**：文件未明載更新頻率（推測隨櫃買中心/證交所公告即時更新，未做跨日重複請求驗證）。免 key、免註冊。
- **資料窗口**：實測 298 筆涵蓋日期範圍 `1150708`～`1150817`（2026-07-08～2026-08-17），約 6 週的滾動預告窗，**只涵蓋「上市」（TWSE 主板）**，不含上櫃（TPEx）。
- **來源**：`https://openapi.twse.com.tw/v1/swagger.json`（path `/exchangeReport/TWT48U_ALL`，summary「上市股票除權除息預告表」）

### A2.（順帶找到、非題目原點名但高度相關）TWSE 開放資料 — 股東常會日期地點（`t187ap41_L`）

- **URL**：`https://openapi.twse.com.tw/v1/opendata/t187ap41_L`
- **請求方式**：`GET`，無參數，免 key。
- **真實 response 截段**（HTTP 200，497,858 bytes，1,104 筆）：
  ```json
  {
    "出表日期": "1150712",
    "公司代號": "1101",
    "公司名稱": "台泥",
    "股東常(臨時)會": "常會",
    "開會日期": "1150522",
    "開會地點": "臺北市中山區中山北路二段113號3樓(台泥大樓3樓士敏廳)",
    "是否改選董監": "否",
    "是否採電子投票": "強制"
  }
  ```
- **回傳格式**：JSON，欄位名為中文 key（非 A1 的英文 key），編碼 UTF-8。
- **關鍵欄位**：`開會日期` 同樣民國年格式；`region` 恆 TW；無 `importance`、`title` 需自組。
- **備註**：這是「股東常會」不是「法說會」，題目沒點名，但同樣可程式化取得、可作為 T9 未來擴充候選（例如「董監改選」旗標可作 importance 依據）。
- **來源**：`https://openapi.twse.com.tw/v1/swagger.json`（path `/opendata/t187ap41_L`）

### A3. MOPS 公開資訊觀測站 — 法人說明會一覽表（`t100sb02_1`）

- **URL（查詢頁）**：`https://mopsov.twse.com.tw/mops/web/t100sb02_1`
- **URL（實際資料端點）**：`https://mopsov.twse.com.tw/mops/web/ajax_t100sb02_1`
  - 注意：`mops.twse.com.tw`（無 ov）直接 GET 該頁會被安全機制擋（見下方 403-like 錯誤頁），須用 `mopsov.twse.com.tw` 網域。
- **請求方式**：`POST`，`Content-Type: application/x-www-form-urlencoded`。**免 cookie、免 referer、免 UA 偽裝**（實測拿掉 `-e`/`-A` 依然 200）。
- **請求參數**：`step=1&firstin=true&off=1&TYPEK=sii&year=115&month=07`
  - `TYPEK`：市場別，`sii`=上市／`otc`=上櫃／`rotc`=興櫃／`pub`=公開發行
  - `year`：民國年（3 碼，如 `115`）
  - `month`：`01`~`12`，**留空則回傳整年資料**（實測 `month=` 空值、`TYPEK=sii`、`year=115` 回傳 1,634 筆、2.3MB，單月 `07` 回傳 42 筆）
- **真實 response 截段**（HTTP 200，64,660 bytes，`month=07` 查詢）：
  ```html
  <tr class='even' data-type='body' >
  <td style='text-align:left !important;'>1432</td><td>大魯閣</td>
  <td align='center'>115/07/02</td>
  <td align='center'>15:30</td>
  <td style='text-align:left !important;'>臺灣證券交易所1樓資訊展示中心 (台北市信義區信義路五段7號1樓)</td>
  <td style='text-align:left !important;'>完整資訊請至公開資訊觀測站或本公司網站查閱</td>
  ...
  ```
- **回傳格式**：**純 HTML `<table>`**（無 JSON 選項），編碼 UTF-8（HTTP header 標 `charset=UTF-8`，實測正確）。
- **CSV 匯出分支**（form 內另有 `filename` 隱藏欄，兩段式請求）：
  - Step 1：上面的 `ajax_t100sb02_1` 回應內含 `<input type='hidden' name='filename' value='t100sb02_1_20260713_181040530.csv'>`（含時間戳、每次查詢動態產生）
  - Step 2：`POST https://mopsov.twse.com.tw/server-java/t105sb02`，body `firstin=true&step=10&filename=<上一步拿到的檔名>`
  - **回傳 HTTP header 宣稱 `charset=iso-8859-1`，但實際 bytes 是 Big5**（`curl` 直接讀成亂碼，需 `iconv`/Python `encoding='big5'` 手動解碼）。真實截段（Big5 解碼後）：
    ```csv
    "公司代號","公司名稱","召開法人說明會日期","召開法人說明會時間","召開法人說明會地點",...
    "1432","大魯閣","115/07/02","15:30","臺灣證券交易所1樓資訊展示中心 ...",...
    ```
  - 兩段式且 filename 帶時間戳，性質像「先產生暫存檔、再下載」，穩定性略低於直接讀 HTML table；若要程式化建議優先解析 HTML table，CSV 分支備用。
- **關鍵欄位對應**：
  - `date`：`召開法人說明會日期` 為 `115/07/02` 格式（民國年/月/日，斜線分隔，同樣需 ROC→ISO）
  - `title`：無現成欄，需自組（公司名稱＋代號＋「法說會」）
  - `region`：無此欄，恆 TW
  - `importance`：無此欄，需自訂預設值——且**該月即有 42 家上市公司法說會**，若全部塞進行事曆會嚴重洗版，需篩選（自選觀察名單／權值股）
- **更新頻率**：未明載，法說會為公司自行申報，通常提前數週到數月不等公告。
- **來源**：`https://mopsov.twse.com.tw/mops/web/t100sb02_1`（查詢表單頁，內含 `action='/mops/web/ajax_t100sb02_1'`）

### A4.（對照組，證明「無 ov 版」被擋）`mops.twse.com.tw` 直接 GET

- **URL**：`https://mops.twse.com.tw/mops/web/t100sb02_1`
- **真實 response**（HTTP 200，但是安全阻擋頁，非資料）：
  ```html
  因為安全性考量，您所執行的頁面無法呈現。<BR>
  FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED.<BR>
  ```
- **結論**：MOPS 兩個網域（`mops` vs `mopsov`）行為不同，後者（`mopsov`）才是可程式化存取的入口，前者對非瀏覽器 GET 直接擋。

---

## B 類：總經事件源（未來換源用）

### B1. 美國 BLS — CPI / 非農release schedule 頁（HTML）

- **URL**：`https://www.bls.gov/schedule/news_release/cpi.htm`、`https://www.bls.gov/schedule/news_release/empsit.htm`
- **請求方式**：`GET`
- **真實 response（純 curl，含常見瀏覽器 UA）**：**HTTP 403**，Akamai bot 阻擋頁：
  ```html
  <title>Access Denied</title>
  <h2>Access Denied</h2>
  <p>The BLS is committed to providing data promptly and according to established schedules.
  Automated retrieval programs (commonly called "robots" or "bots") can cause delays...
  bot activity that doesn't conform to BLS usage policy is prohibited.</p>
  ```
  同一擋法連首頁 `https://www.bls.gov/` 都擋（403），確認是整站層級的 Akamai bot 偵測，不是單一頁面規則。
- **透過 firecrawl（瀏覽器渲染）成功取得**，真實 response 截段（`firecrawl scrape` → markdown）：
  ```
  ## Schedule of Releases for the Consumer Price Index
  | Reference Month | Release Date | Release Time |
  | --- | --- | --- |
  | June 2026 | Jul. 14, 2026 | 08:30 AM |
  | July 2026 | Aug. 12, 2026 | 08:30 AM |
  | August 2026 | Sep. 11, 2026 | 08:30 AM |
  ```
- **回傳格式**：HTML table（無 JSON API）。
- **關鍵欄位對應**：`date`＝Release Date 欄（英文月份格式，需解析）；`title`＝固定「CPI」/「Employment Situation」；`region`固定 US；`importance`無、需自訂。
- **認證需求**：免 key，但**直接 HTTP 請求（curl / server-side fetch）會被 Akamai 擋**，只有瀏覽器渲染（或走 firecrawl 這類代理）能拿到內容——這對「worker 排程直接打 API」的自動化方式是硬性障礙。

### B2. 美國 BLS — `.ics` 行事曆訂閱 feed（**本次最大發現**）

- **URL**：`https://www.bls.gov/schedule/news_release/bls.ics`（頁面上寫的官方訂閱連結，供 Outlook / Google Calendar 訂閱用）
- **請求方式**：`GET`
- **純 curl 結果**：同樣 **HTTP 403**（Akamai 擋，即使帶完整瀏覽器 UA + cookie jar + referer 仍擋）。
- **透過 firecrawl 成功取得**，真實 response 截段（`firecrawl scrape ... -f rawHtml`）：
  ```
  BEGIN:VCALENDAR
  PRODID:-//Department of Labor//Bureau of Labor Statistics//EN
  VERSION:2.0
  ...
  BEGIN:VEVENT
  SEQUENCE:1
  UID:3a09855e-d5c6-45b2-a74f-2429f44d0418
  DTSTART;TZID=US-Eastern:20250110T083000
  DURATION:PT0M
  SUMMARY:Employment Situation
  LOCATION:Washington\, DC
  CATEGORIES:IMPORTANT, BLS
  END:VEVENT
  ```
- **回傳格式**：**標準 iCalendar（RFC 5545）**，一個 feed 內含 BLS 全部發布項目（CPI、非農/Employment Situation、PPI、JOLTS 等都在同一份），欄位乾淨（`DTSTART`＝日期時間、`SUMMARY`＝標題、`LOCATION`）。這是所有 B 類源裡**結構化程度最高**的一份。
- **關鍵欄位對應**：`date`＝`DTSTART`（`20250110T083000` 可直接切出 `2025-01-10`）；`title`＝`SUMMARY`（英文，如「Employment Situation」「Consumer Price Index」，需自行過濾只留 CPI/非農兩類，或全收）；`region`固定 US；`importance`：`CATEGORIES` 有 `IMPORTANT` 標記可用！
- **認證需求**：免 key，但**同樣卡在 Akamai bot 阻擋**——只能透過瀏覽器渲染/代理服務取得，無法從 worker 容器內直接 `fetch()`。

### B3. Fed FOMC 會議行事曆

- **URL**：`https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm`
- **請求方式**：`GET`，純 curl（帶瀏覽器 UA）即可，**無阻擋**。
- **真實 response 截段**（HTTP 200，164,095 bytes）：
  ```html
  <div class="panel panel-default"><div class="panel-heading"><h4><a id="42828">2026 FOMC Meetings</a></h4></div>
  <div class="row fomc-meeting">
    <div class="fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>January</strong></div>
    <div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">27-28</div>
    ...
    <a href="/monetarypolicy/files/monetary20260128a1.pdf">PDF</a>
  ```
- **回傳格式**：HTML（Bootstrap `div.row.fomc-meeting` 區塊），無 JSON、無 ics（頁面內未找到 `.ics`/`rss` 連結）。
- **關鍵欄位對應**：`date`＝`fomc-meeting__date`（範圍格式如「27-28」，需搭配月份、且決策日通常是**第二天**——與現有種子 JSON 的既有備註方法論一致：「用決策日＝會議第二天」）；連結內嵌 `monetary20260128a1.pdf` 這類檔名也含完整日期，可交叉驗證；`title`固定「FOMC 利率決策」；`region`固定 US；`importance`固定 high。
- **認證需求**：免 key，可直接 curl，**B 類三個源裡唯一完全無阻擋的**。

### B4. 台灣央行理監事會日程

- **重要更正**：探測過程中，我起初**猜測**了一個央行網址（`cbc.gov.tw/tw/cp-533-889-D4B9C-1.html`）並直接 curl，拿到 HTTP 200——但內容其實是網站導覽選單頁（只是剛好含「理監事」字樣的側欄連結），**不是**真正的會議日期公告。這是一個「URL 猜對格式但猜錯內容」的假陽性，已作廢，改用 `firecrawl search` 找到真實網址後重新驗證（見下）。
- **真實 URL**：`https://www.cbc.gov.tw/tw/cp-302-189514-82841-1.html`（新聞稿「115年中央銀行理監事聯席會議預定日期」，經 `firecrawl search "中央銀行 115年 理監事聯席會議 預定日期"` 找到、curl 驗證 title 相符）
- **請求方式**：`GET`，純 curl 即可，**無阻擋**。
- **真實 response 截段**（HTTP 200，41,061 bytes）：
  ```html
  <p><strong>中央銀行新聞稿</strong>                                                114年12月18日發布</p>
  <p><strong>115年中央銀行理監事聯席會議預定日期</strong></p>
  <p>茲預定本行115年理監事聯席會議日期如下：</p>
  <p>115年3月19日</p>
  <p>115年6月18日</p>
  <p>115年9月17日</p>
  <p>115年12月17日</p>
  ```
- **交叉驗證**：`2026-06-18`、`2026-09-17` 與本專案現有 `econ-calendar.json` 靜態種子的既有兩筆「台灣央行理監事聯席會議」條目日期**完全吻合**，證實舊種子資料本身是正確的。
- **回傳格式**：純 HTML 段落文字（無 table、無結構化標記），日期藏在自由格式的 `<p>115年3月19日</p>` 裡，需 regex 抓「N年M月D日」pattern。
- **關鍵欄位對應**：`date`需自 prose 解析（民國年）；`title`固定「台灣央行理監事聯席會議」；`region`固定 TW；`importance`固定 high。
- **更新頻率／認證**：**一年一則**，每年 12 月公告次年四季日期。免 key，但**網址每年不同**（`cp-302-189514-82841-1.html` 這串序號像 CMS 內部流水號，非可預測 pattern），需靠央行「新聞稿」列表頁（`https://www.cbc.gov.tw/tw/lp-302-1.html`，未逐一驗證此列表頁本身的結構）或每年搜尋才能找到當年連結——**不是穩定端點，是「每年手動/搜尋找新網址」的源**。

---

## T9 建議切法

### 公司源可行性

| 源 | 可行性 | 理由 |
|---|---|---|
| **TWSE openapi `TWT48U_ALL`（除權息）** | ✅ 最推薦 | 純 JSON、免 key、免表單、`GET` 一行 curl 搞定，資料乾淨 |
| **MOPS `ajax_t100sb02_1`（法說會）** | ✅ 可行但較繁 | 需 `POST` form data、回傳是 HTML table 需解析、CSV 分支要處理 Big5 編碼陷阱 |
| TWSE openapi `t187ap41_L`（股東常會，bonus） | ✅ 可行 | 同樣乾淨 JSON，題目未點名但可作未來擴充 |

**建議第一刀做除權息（`TWT48U_ALL`）**：純 JSON、無需解析 HTML、無編碼陷阱，工程成本最低、跟現有 T5 系列「新增一個 fetcher」的刀路模式一致。法說會（MOPS）可作第二刀，但要先解決「一個月 42 家公司會洗版」的過濾問題。

### 資料形狀 vs 現有 `EconCalendarSchema`

現有 schema（`apps/server/src/market-data/calendar.ts:3-12`）：
```ts
{ date: string (YYYY-MM-DD), title: string, region: 'US'|'TW'|'GLOBAL', importance: 'high'|'medium'|'low' }
```

兩個公司源都**不能直接映射**，需要轉換層：
1. **日期**：兩源皆為民國年格式（`1150709` 或 `115/07/02`），需寫 ROC→ISO 轉換 helper（純函式，適合嚴格 TDD）。
2. **title**：兩源都無現成 title 欄，需組字串（如「元大台灣50（0050）除息」「大魯閣（1432）法說會」）。
3. **importance**：兩源都無此欄，需自訂預設值——**且這是最大的實作風險**：除權息一個月有數十到上百檔、法說會一個月 42 家，若不篩選、全部塞進行事曆會把現有「本週財經行事曆」的 7 天窗口洗版成一長串公司清單，稀釋掉原本 11 筆高重要性總經事件的可讀性。需要先決定「篩選規則」（例如：只顯示 brief 當週有被 cascade 提及的公司代號、或只顯示特定權值股清單），這是**行為決策、不是格式問題**，建議實作前先問。
4. Schema 本身可能需要擴充一個 optional 欄位（例如 `companyCode`、`category: 'macro' | 'investor-conference' | 'ex-dividend'`）以利前端做不同視覺樣式，而不是把所有語意硬塞進 `title` 字串。

### 能否與現有靜態總經種子共存

**可以合併在同一個 JSON 陣列**（`buildCalendarBlock` 目前的 sort-by-date 邏輯天然支援混合來源），但建議：
- 加一個 optional `category` 欄位區分「總經」vs「公司事件」，讓 `buildCalendarBlock` 可以選擇分兩個 markdown 區塊呈現（「## 本週財經行事曆」+「## 本週公司事件」），而不是打散成一條時間序列——公司事件筆數量級遠高於總經事件，混排會讓總經事件被淹沒。
- 靜態總經種子（FOMC/CPI/非農/央行）目前手打、11 筆、季度更新一次，**短期不必急著換自動源**——B 類三源沒有一個是「免阻擋 + 免年年找新網址 + 結構化」三者兼備（見下表），換源的 ROI 目前不如先把 T9 公司事件做出來。

### 總結表：可 curl 直取 vs 卡 HTML/登入/阻擋

| 源 | 端點 | 可程式化存取？ | 備註 |
|---|---|---|---|
| TWSE openapi 除權息 | `openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL` | ✅ curl 直取，JSON | 免 key，格式最乾淨 |
| TWSE openapi 股東常會 | `openapi.twse.com.tw/v1/opendata/t187ap41_L` | ✅ curl 直取，JSON | bonus find，中文 key |
| MOPS 法說會 | `mopsov.twse.com.tw/mops/web/ajax_t100sb02_1` | ✅ curl 直取（需 POST），HTML table | `mops.`（無 ov）網域會被安全頁擋，須用 `mopsov.` |
| MOPS 法說會 CSV | `mopsov.twse.com.tw/server-java/t105sb02` | ⚠️ curl 可取，但兩段式+ Big5 編碼陷阱 | 備用分支，優先度低於 HTML table |
| BLS CPI/非農排程頁 | `bls.gov/schedule/news_release/{cpi,empsit}.htm` | ❌ 純 curl 被 Akamai 403 全站擋 | 需瀏覽器渲染/firecrawl 才能取得 |
| BLS `.ics` 行事曆 | `bls.gov/schedule/news_release/bls.ics` | ❌ 純 curl 被 Akamai 403 擋（同上） | 但透過 firecrawl 取得的內容是**目前所有源裡結構最乾淨的**（標準 iCalendar，含 IMPORTANT 分類） |
| Fed FOMC 行事曆 | `federalreserve.gov/monetarypolicy/fomccalendars.htm` | ✅ curl 直取，HTML div 結構 | 唯一完全無阻擋的 B 類源 |
| 台灣央行理監事日程 | `cbc.gov.tw/tw/cp-302-189514-82841-1.html`（2026 年版網址） | ✅ curl 直取，純 prose HTML | 一年一則、網址逐年變動，非穩定端點 |

---

## 我（主對話）接下來要親自交叉驗的具體端點（見回報訊息）
