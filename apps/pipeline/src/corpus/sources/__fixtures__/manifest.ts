import type { FixtureManifest } from '../../../fixtures/manifest.js'

// ★ 這一批原本的三個**全部是手寫的**（2026-08-22 逐檔讀過內容確認），不是抓下來的：
//   - rss-sample.xml：`<title>Sample Feed</title>`、`example.com`、`Fixture for tests`
//   - html-listing-sample.html：`Sample Listing`、`新聞1/新聞2/新聞3`、`/n1 /n2 /n3`
//   - cnyes-sample.json：`鉅亨新聞一/二/三`、`摘要一/二/三`、newsId 5001-5003
//
// 第四份 `fsc-newslist-sample.html` 是 2026-08-22 修 fsc-news selector 時補的，那份是真的
// 抓下來的（origin: captured）。
//
// 它們與 market-data 那批看起來像真實擷取的樣本躺在同名的 `__fixtures__` 目錄、檔名同樣
// 帶 `-sample`，在這份 manifest 出現之前沒有任何地方分得出來。**手寫本身不是罪**——解析器
// 測試常常只需要一個結構範例。問題是它們證明不了任何關於真實 API 的事，而 firecrawl 事故
// 正是有人拿這種東西當成「真實 API 長這樣」的依據。
export const corpusSourceFixtures: FixtureManifest = {
  baseUrl: import.meta.url,
  label: 'corpus/sources',
  entries: [
    {
      file: 'cnyes-sample.json',
      kind: 'json',
      origin: 'synthetic',
      // 有真實對應 URL 的 synthetic 樣本最值得跑 check：那一比就是在問
      // 「這個人推測出來的形狀，真實 API 到底回不回」——正是能擋下 firecrawl 的那個檢查。
      url: 'https://api.cnyes.com/media/api/v1/newslist/category/headline?limit=30',
      shapeVerifiedAt: '2026-08-22',
      transform: 'hand-written',
      note: 'anue / cnyes-global 走 cnyes-json format。★ 2026-08-22 首次跑 fixtures:check 就抓到這份樣本有一個真實 API 不回的 `url` 欄位（實測回應 28 個欄位裡沒有它），於是 rss.ts 的 `strOrNull(i.url) ?? 衍生網址` 在 production 永遠走衍生那條、測試永遠走另一條。樣本已改成與現實相符。**手寫不是問題，形狀沒有依據才是**——這一格就是這支工具存在的理由。',
    },
    {
      file: 'rss-sample.xml',
      kind: 'opaque',
      origin: 'synthetic',
      url: null,
      transform: 'hand-written',
      note: 'RSS 的通用結構範例，不對應任何單一來源，所以沒有可比對的 URL。XML 目前不做自動形狀比對。',
    },
    {
      file: 'html-listing-sample.html',
      kind: 'opaque',
      origin: 'synthetic',
      url: null,
      transform: 'hand-written',
      note: 'html-selector 的通用列表範例。測試用的 listingUrl 是假的 https://x.com/list、selector 也是通用的，所以它連「某個真實站台長這樣」都沒有宣稱。',
    },
    {
      file: 'twse-newslist-sample.json',
      kind: 'json',
      origin: 'captured',
      url: 'https://openapi.twse.com.tw/v1/news/newsList',
      capturedAt: '2026-08-22',
      shapeVerifiedAt: '2026-08-22',
      transform: '只保留前 3 筆（原始回應 538 筆、126,682 bytes）。★ 裁切過，所以不能拿它推論筆數；欄位結構則是完整的——實測 538 筆的 key 組合只有一種（`jq "[.[] | keys] | unique | length"` 回 1）。',
      note: 'twse-announcements 走 twse-news-json format。這個來源原本是 html-selector 刮 twse.com.tw/announcement/notice，而那個 URL 早就改回 JSON、內容也不對（是「當日公布注意有價證券」不是證交所公告），所以從上線起零產出。★ kind 是 json，所以 fixtures:check 會真的重打端點比形狀——三個欄位少一個或改名都會報 drift，這正是這份樣本要守的東西。',
    },
    {
      file: 'fsc-newsview-sample.html',
      kind: 'opaque',
      origin: 'captured',
      url: 'https://www.fsc.gov.tw/ch/home.jsp?id=96&parentpath=0,2&mcustomize=news_view.jsp&dataserno=202608200003&dtable=News',
      capturedAt: '2026-08-23',
      transform: '裁切（原始 124,543 bytes → 47,641 bytes）。移除 <script>／<style>／<noscript>／<link>／<img>／<input>／<iframe>／<svg> 等不產生文字內容的節點與所有 HTML 註解，並清空除 `div.maincontent` 的 `class` 標記外的全部標籤屬性（id／style／onclick／data-* 等）；`<head>` 只保留 `<meta charset="UTF-8">`。**新聞稿本體（div.maincontent 底下的文字）與頁首/選單/側欄/頁尾的文字節點一字未動、順序未變**——後者無法裁掉：`fsc-selector.test.ts` 有一條測試刻意把 `bodySelector` 覆寫成 `body` 來證明「整頁與正文容器抽出來的東西不同」，斷言整頁文字含「網站導覽」且長度 > 2000 字元，這些字串只存在於頁首選單與側欄，裁掉就會讓那條測試失去鑑別力甚至變紅。裁切前後對 `fetchHtmlSelector` + `extractBody`（分別用預設 `div.maincontent` 與覆寫的 `body` 兩種 bodySelector）的完整輸出做過逐位元組比對，結果相同。',
      note: 'fsc-news 的 bodySelector 釘子，用在 ../fsc-selector.test.ts。html-selector 的 excerpt 原本寫死 null，這個來源抓回來的 15 篇因此全部沒有 enrich、在 retriever 裡不可達。★ 與列表那份一樣，這份擋得住「有人把 seed 的 selector 改壞」，擋不住「fsc.gov.tw 改版」——後者只能重抓，而 fixtures:check 目前只比對 JSON，HTML 一律標 skipped。',
    },
    {
      file: 'fsc-newslist-sample.html',
      kind: 'opaque',
      origin: 'captured',
      url: 'https://www.fsc.gov.tw/ch/home.jsp?id=96&parentpath=0,2',
      capturedAt: '2026-08-22',
      transform: '只保留 div.newslist 整塊（原始頁面 233,211 字元、裁切後 6,786 字元（含尾端換行）；檔案本身 8,320 bytes，中文 UTF-8 編碼後大於字元數是正常的）。該塊內的 li 一個都沒刪，所以 16 個 li（1 個表頭 + 15 筆資料）在 fixture 內是完整的。',
      note: 'fsc-news 的 selector 釘子，用在 ../fsc-selector.test.ts。這個來源從上線起 totalArticles=0，根因是 seed 寫成 `ul.newslist > li` 而 class 其實掛在 div 上（DOM 是 div.newslist 底下才有 ul、ul 底下才是 li；seed 現在用的是後代選擇器 `div.newslist ul > li`），cheerio 命中 0、而且沒有任何測試會因此變紅。★ 這份 fixture 擋得住的是「有人把 seed 的 selector 改壞」；擋不住「fsc.gov.tw 改版」——後者只能重抓，而 `fixtures:check` 目前只比對 JSON，HTML 一律標 skipped。',
    },
  ],
}
