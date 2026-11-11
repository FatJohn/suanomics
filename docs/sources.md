# 資料來源清單

讀者：維護者、新增或調整資料來源的 AI coding agent
型別：參考

本頁列出 pipeline 使用的每個外部來源、條款連結與允許用法，2026-11-08 查核。新增來源前先在這裡加一行；條款禁止 AI 用途、robots 擋 feed 路徑或查不到條款的來源不接。`apps/pipeline/src/db/seed-sources.test.ts` 比對 seed 與本頁，seed 裡的 URL 不在本頁或該行沒有條款連結時測試會紅。

抓取用法分三種，對應 `SeedEntry.content`：

| 用法 | 存什麼 |
|---|---|
| 正文 | 標題、連結、feed 摘要，並抓文章頁正文 |
| 前言 | 標題、連結、feed 摘要，不抓文章頁 |
| 標題連結 | 只存標題與連結 |

## 新聞來源

| 名稱 | slug | Feed URL | 類型 | 條款連結 | 允許用法 |
|---|---|---|---|---|---|
| 中央銀行新聞稿 | `cbc-press` | https://www.cbc.gov.tw/tw/rss-302-1.xml | 官方 RSS | https://www.cbc.gov.tw/tw/cp-307-36676-de020-1.html | 正文。政府資料開放授權第 1 版，須註明出處 |
| 金管會新聞稿 | `fsc-press` | https://www.fsc.gov.tw/RSS/Messages?serno=201202290009&language=chinese | 官方 RSS | https://www.fsc.gov.tw/ch/main.jsp?websitelink=artsublink.jsp&dataserno=201604250004 | 正文。政府資料開放授權第 1 版，須註明出處 |
| 行政院新聞 | `ey-press` | https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3 | 官方 RSS | https://www.ey.gov.tw/Page/2EADDBFEDDB6357E | 正文。政府資料開放授權第 1 版 |
| 總統府新聞 | `president-news` | https://www.president.gov.tw/RSSNEWS.aspx | 官方 RSS | https://www.president.gov.tw/Page/18 | 正文。政府資料開放授權第 1 版，須註明出處 |
| 外交部新聞稿 | `mofa-press` | https://www.mofa.gov.tw/OpenData.aspx?SN=E0AB271EE713F7E8 | 官方 RSS | https://www.mofa.gov.tw/cp.aspx?n=292 | 正文。政府資料開放授權第 1 版 |
| 疾管署新聞稿 | `cdc-press` | https://www.cdc.gov.tw/RSS/RssXml/Hh094B49-DRwe2RR4eFfrQ?type=1 | 官方 RSS | https://www.cdc.gov.tw/Category/Fpage/TxkBIR9agw_IBRRmvn9TcQ | 正文。開放宣告無償非專屬，須註明出處 |
| 聯準會新聞稿 | `fed-press` | https://www.federalreserve.gov/feeds/press_all.xml | 官方 RSS | https://www.federalreserve.gov/disclaimer.htm | 正文。公共領域，請註明出處 |
| 白宮新聞 | `whitehouse-news` | https://www.whitehouse.gov/news/feed/ | 官方 RSS | https://www.whitehouse.gov/copyright/ | 正文。政府製作內容不受著作權保護 |
| 美國國務院新聞稿 | `state-press` | https://www.state.gov/rss-feed/press-releases/feed/ | 官方 RSS | https://www.state.gov/copyright-information/ | 前言。公共領域；robots 的 crawl-delay 5 秒，不併發抓文章頁 |
| GDACS 全球災害警報 | `gdacs` | https://www.gdacs.org/xml/rss.xml | 國際機構 RSS | https://www.gdacs.org/About/termofuse.aspx | 前言。feed 標示 public domain；robots 限 1 分鐘 1 次，不抓文章頁 |
| 中央社財經 | `cna` | https://feeds.feedburner.com/rsscna/finance | 發行商 RSS | https://www.cna.com.tw/about/rss.aspx | 前言。限非商業，僅標題、前言、連結，須標示中央通訊社；內部分析用，網站只引用標題與連結 |
| 鉅亨網台股 | `google-news-cnyes` | https://news.cnyes.com/rss/v1/news/category/tw_stock | 發行商 RSS | https://www.cnyes.com/cnyes_about/cnyes_sos01.html | 標題連結。條款禁未經授權轉載 |
| 鉅亨網國際股市 | `cnyes-world` | https://news.cnyes.com/rss/v1/news/category/wd_stock | 發行商 RSS | https://www.cnyes.com/cnyes_about/cnyes_sos01.html | 標題連結。條款禁未經授權轉載 |

## 語料來源（`external_sources`）

| 名稱 | slug | Feed URL | 類型 | 條款連結 | 允許用法 |
|---|---|---|---|---|---|
| Fed FOMC statements | `fomc-statements` | https://www.federalreserve.gov/feeds/press_monetary.xml | 官方 RSS | https://www.federalreserve.gov/disclaimer.htm | 正文。公共領域 |
| 金管會新聞稿列表 | `fsc-news` | https://www.fsc.gov.tw/ch/home.jsp?id=96&parentpath=0,2 | 官方網頁 | https://www.fsc.gov.tw/ch/main.jsp?websitelink=artsublink.jsp&dataserno=201604250004 | 正文。政府資料開放授權第 1 版 |
| 公開資訊觀測站重大訊息 | `twse-mops-news` | https://mops.twse.com.tw/mops/web/t146sb05 | 官方網頁 | https://www.twse.com.tw/zh/terms/use.html | 零產出，未抓取 |
| 台灣證交所公告 | `twse-announcements` | https://openapi.twse.com.tw/v1/news/newsList | 官方 OpenAPI | https://www.twse.com.tw/zh/terms/use.html | 標題、連結。走 OpenAPI 介接，不爬 www.twse.com.tw 網頁 |
| 中央社政治 | `cna-politics` | https://feeds.feedburner.com/rsscna/politics | 發行商 RSS | https://www.cna.com.tw/about/rss.aspx | 前言。同中央社財經 |

`cbc-press`、`ey-press`、`whitehouse-statements` 與新聞來源共用同一個 feed，條款相同。

## 結構化資料

| 名稱 | 端點 | 類型 | 條款連結 | 允許用法 |
|---|---|---|---|---|
| TWSE OpenAPI | https://openapi.twse.com.tw/v1 底下的 MI_INDEX、MI_QFIIS_cat、MI_MARGN、STOCK_DAY_ALL、t187ap04_L | 官方 OpenAPI | https://www.twse.com.tw/zh/terms/use.html | 數字與事件。OpenAPI 平台歡迎介接 |
| TWSE 傳統 JSON | https://www.twse.com.tw/rwd/zh/ 底下的 BFI82U、MI_MARGN、TWT93U | 官方 JSON | https://www.twse.com.tw/zh/terms/use.html | 數字。使用條款限制自動化下載，既有序列沿用，維護者 2026-11-08 複核接受 |
| TPEx OpenAPI | https://www.tpex.org.tw/openapi/v1 底下的 tpex_mainboard_daily_close_quotes、mopsfin_t187ap04_O | 官方 OpenAPI | https://www.tpex.org.tw/zh-tw/gtsm_disclaimer.html?l=zh-tw | 數字與事件。OpenAPI 平台歡迎介接 |
| Fed 行事曆 | https://www.federalreserve.gov/json/calendar.json | 官方 JSON | https://www.federalreserve.gov/disclaimer.htm | 事件日期。公共領域 |
| FRED | https://api.stlouisfed.org/fred/series/observations | 官方 API | https://fred.stlouisfed.org/docs/api/terms_of_use.html | 數字。部分序列版權屬第三方，個人使用以外須取得所有者同意，維護者 2026-11-08 複核接受 |
| TAIFEX | https://www.taifex.com.tw | 官方網站 | https://www.taifex.com.tw/cht/5/copyright | 數字。維護者 2026-11-08 複核接受 |
| Nasdaq | https://api.nasdaq.com | 商業 API | https://www.nasdaq.com/legal | 數字。維護者 2026-11-08 複核接受 |
| NYSE 休市表 | https://www.nyse.com/markets/hours-calendars | 官方網頁 | https://www.ice.com/privacy-security-center/terms-of-use | 休市日期。人工年度核對後寫進 `packages/shared/src/market-holidays.ts`，pipeline 不抓取 |

## 不接的來源

| 名稱 | 條款連結 | 原因 |
|---|---|---|
| BBC News | https://www.bbc.co.uk/usingthebbc/terms-of-use/ | 條款禁止擷取 RSS metadata，AI 用途須先取得許可 |
| Al Jazeera | https://www.aljazeera.com/terms-and-conditions/ | 條款禁 text or data mining 與 web scraping，robots 註解禁 AI／LLM 開發 |
| NHK World | https://www3.nhk.or.jp/nhkworld/en/terms/ | 沒有官方英文 RSS；條款禁著作權法許可外的重製，robots 擋 AI |
| TechNews 科技新報 | https://technews.tw/copyright/ | 僅限個人參考，robots 點名擋 Anthropic |
| Yahoo 股市、Yahoo 財經 | https://legal.yahoo.com/tw/zh-hant/yahoo/terms/otos/index.html | 條款禁自動化存取，robots 點名擋 AI |
| EIA Today in Energy | https://www.eia.gov/about/copyrights_reuse.php | 授權為公共領域，但 robots 的 `Disallow: /rss` 擋 feed 路徑 |
| 自由時報 | https://service.ltn.com.tw/copyright | 限非商業，robots 點名擋 AI |
| OilPrice.com | https://oilprice.com/terms-and-conditions | 僅限個人使用，robots 擋 AI |
| CNBC | https://versantmedia.com/terms/ | 僅限個人非商業，robots 點名擋 AI |
| 壹蘋新聞網 | https://news.nextapple.com/terms | 條款禁自動化大量抓取與轉載 |
| WHO News | https://www.who.int/about/policies/terms-of-use | 僅限非商業，feed 近一個月沒有新稿 |
| 中央氣象署 RSS | https://www.cwa.gov.tw/V8/C/S/eservice/rss.html | 條款禁解析 RSS 製作衍生產品 |

聯合報系、工商時報、RSSHub 與 Google News 代理也不接，理由見 [ADR 0007](adr/0007-news-sources.md)。
