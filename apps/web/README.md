# apps/web — Vue 3 前端

Pre-production SPA。Pinia + Vue Router + Tailwind 4。負責每日 cascade brief 渲染、單則新聞分析、ad-hoc 分析（含長任務輪詢）、YouTube 字幕工具 UI。

全圖見 [模組地圖](../../docs/architecture/module-map.md)。

## 目錄

```
src/
├── main.ts          # Pinia + Router 掛載 → mount('#app')
├── App.vue          # 殼：AppHeader + <RouterView/> + AppFooter
├── router/
│   └── index.ts     # 5 個 route：/、/brief、/brief/news/:id、/brief/analyze、/transcript
├── views/           # 對應 5 個 route
├── components/
│   ├── brief/       # cascade UI：CitationCard、PodcastPlayer、CascadeChart…
│   ├── citation/    # 引用渲染
│   ├── layout/      # AppHeader / AppFooter
│   └── ui/          # shadcn-vue 包裝（collapsible 等）
├── composables/
│   └── useAnalyzeJob.ts  # 長任務輪詢（2s interval、120s timeout）
├── stores/
│   └── brief.ts     # Pinia：daily / analysis + status
├── lib/             # detect-youtube 等純 util
└── assets/          # main.css（@theme tokens、Tailwind 4 CSS-first）
```

## Entry

`src/main.ts`：`createPinia()` → `createRouter()` → `app.mount('#app')`。

## 常用命令

```bash
pnpm --filter web dev          # vite dev server（預設 5173）
pnpm --filter web build        # vite build → dist/
pnpm --filter web preview      # 預覽 build 產物
pnpm --filter web test         # vitest（component / composable）
pnpm --filter web type-check   # vue-tsc
pnpm --filter web layout:assert  # 版面斷言（需先起 dev server）
pnpm --filter web nav:assert     # 導覽斷言（需先起 dev server 與 api server）
```

### 導覽斷言

`scripts/navigation-assertions.mjs`：十一條斷言，每條都是「做完這串動作之後網址是什麼」。判定與 SKIP 分類在 `navigation-assertions.judge.mjs`（有單元測試），主檔只剩執行與回報。需要 dev server **與** api server（要有真實報告資料）。

為什麼存在：換日掉層別、返回掉日期與層別，這兩種回歸都是獨立複查讀出來的，不是測試抓到的。純函式那層覆蓋是滿的——`reader-route`／`carriedQuery`／`back-link` 每條規則都用突變驗過——缺的是**元件有沒有正確接線**。實測過：把 `AppBackLink` 裡的 `hasInternalHistory` 判斷反相（＝把「返回掉日期與層別」的 bug 原封裝回去），`pnpm --filter web test` 仍然全綠。

| 斷言 | 守什麼 |
|---|---|
| 從佐證層點進單則新聞再返回 | 回到原本那天那一層，不是最新一天的報告層 |
| 直接開單則新聞頁時返回 | `history.state.back` 是 `null`，落在 `/`（fallback） |
| 從 `/sources` 返回 | 同上，兩個返回連結共用 `AppBackLink` |
| 在佐證層換日 | 留在佐證層（換日掉層別的回歸守門） |
| 在報告層換日 | 落在前一天的**報告層**。標籤刻意不寫「不長出 `?view=report`」——guard 的正規化會把它洗掉，這條擋不到那個因 |
| `?date=` | 導到 canonical 的 `/d/:date` |
| 非法的 `?view=` | 被拿掉 |
| 未知的 query 進站 | 原樣留著（我們沒有立場宣稱懂它） |
| 切層 | 不把未知的 query 帶著走 |
| redirect 觸發時 | 未知的 query 不會被順手丟掉（上一條走的是「不觸發 redirect」那條路） |
| 換日回到最新一天 | 落在 `/` 而不是 `/d/:date`，層別照樣帶著（那是 `BriefDateSwitcher` 的另一條分支） |

七個突變實測過，每個都讓對應斷言變紅：`AppBackLink` 判斷反相（3 條紅）、換日不帶 query（1 條）、切層帶回未知 query（1 條）、拿掉 `view` 正規化（1 條）、拿掉 `date` 導向（1 條）、redirect 時丟掉未知 query（1 條）、回到最新一天時不帶 query（1 條）。驗收對當時的九條另外自設五個突變、確認九條逐條都有殺手；後加的兩條（redirect 保留 query、回到最新一天）各自實測過。

**它不守**：

- 頁面內容對不對——**只比網址**。`/d/2026-09-04` 顯示的若是別天的報告，這支全綠。
- 瀏覽器的上一頁／下一頁。
- 兩個刻意不改的連結：`AppHeader.vue` 的 brand、`BriefNewsView.vue` 那句「請從**今日簡報**挑一則」。
- 中鍵與修飾鍵點擊（手動驗過，自動化要開新分頁、成本不成比例）。
- 任何**新增**的導覽點——這裡列的是已知路徑，新增一個沒有走 `carriedQuery`／`AppBackLink` 的連結，這支腳本不會知道。
- **素材缺席與元件壞掉分不開**：`.source-more` 若因元件回歸而整批消失，探測拿到的就是「當天沒有站內分析頁」，兩條記 SKIP、離開碼仍是 0。加啟發式去猜是哪一種會製造假紅，所以這裡選擇讓 SKIP 看得見、由讀的人判斷。

素材缺席（本機只有一天報告、當天的來源都沒有站內分析頁）時記成 `SKIP` 並印出原因，不發假 PASS——斷言總數會看得見地掉下來。報告寫進 `scripts/navigation-assertions.latest.json`。

離開碼：全過 0、有 FAIL 1、**什麼都沒驗到 2**（起不了瀏覽器、連不到 `/api/brief/dates`、或一條斷言都沒跑到）。最後那一種是驗收抓到的：第一版把 fetch 失敗 catch 成「空的 dates」，於是對著沒起來的 server 跑會印「0 條斷言、9 條跳過」然後 **exit 0**——什麼都沒驗到，離開碼卻與全過一樣，正是這支腳本要防的形狀。**單條跳過仍是 0**（總數掉下來看得見），一條都沒跑到才升級成 2。

### 版面斷言

`scripts/layout-assertions.mjs`：在 2560／1280／900／390 四個寬度 ×（報告層／報告層且正反兩面展開／佐證層）三輪，報告層七條、展開輪六條、佐證層六條，共 76 條。判定邏輯在 `layout-assertions.judge.mjs`、頁面內的量測在 `layout-assertions.collect.mjs`，主檔只剩執行與回報。

中間那一輪是**後來加的**：正反兩面自那時起預設收合，只跑預設狀態的話，展開後的 DOM 就完全不進量測。**它加到的只有這樣**——展開的文字進入字級掃描與溢出掃描、四個器械在更長的頁面上重量一次；**它不量欄數、不量行長**，那兩件事仍然是手做（見下面「它不守」）。

多出來的兩條是狀態斷言。`正反兩面預設是收合的`（預設那一輪）守的是那個核心決定本身——少了它，元件若回歸成預設展開，第一輪不會 FAIL，而第二輪的點擊反而把它**關上**、以「展開沒生效」FAIL，訊息會把方向指反。`展開真的生效`（展開那一輪）的理由是：另外五條全都在正反觀點區塊的上方或與它無關（圖上四個器械＋全域字級／溢出），所以**點擊即使完全失效，五條也會照樣全綠**——那會是一個無法被證偽的綠燈。這一條點完之後量 `.vp-columns` 的高度，沒展開就 FAIL。兩條都只認 `.vp-columns` 一個元素——`.vp-netread`／`.vp-disclaimer` 消失不會被抓到。找不到 `.vp-trigger` 時（`viewpoints` 為 null，或觸發器改了名）**整輪跳過並印出 `SKIP` 與原因**，斷言總數從 76 掉回 52——刻意讓它看得見。

`頁尾的 .footer-meta 沒有被播放器蓋住`是**後來加的**（報告層與佐證層各一，四寬度共 8 條；展開輪不掛，那是同一個 footer）。它守的是一個**只在文件末端才成立**的碰撞：常駐播放器是 `position: fixed`，捲到底時它蓋住的內容再也捲不出來。2026-08-02 之前留給播放器的 padding 掛在 `.brief-landing` 上、而 footer 是它在 `App.vue` 的兄弟節點，於是那份 reserve 把 footer 往下推出一個 260px 的空隙、卻沒有保護 footer 自己的尾巴——`.footer-meta`（© 那一行）整條落在播放器底下，桌機被蓋 31px、手機 62px。**上面那七條全都在頁面上半部，對此一無所知。** 量不到 `.dock`（當天沒有 podcast，或播放器改了名）時記進 `SKIP`、不發假 PASS，總數掉回 68。

| 斷言 | 守什麼 |
|---|---|
| 字級落在 DESIGN.md 級數表上 | 八級 ＋ `alarm` 手機變體 26 |
| 無水平溢出 | `scrollWidth === clientWidth` 且無元素越界（被祖先 `overflow-x` 裁切的排除）|
| 四個器械都在場 | 沒有這條，頁面沒載到 brief 時其餘四條會全綠而其實什麼都沒驗到 |
| 器械沒有被圖紙裁掉 | 四個邊都量。`.synoptic` 是 `overflow: hidden`（桌機是 `min-height: 580px`，不是固定高），器械跑出圖外會**靜默消失**——上面那條溢出斷言看不到 |
| 圖上四個器械兩兩不相撞 | |
| 正反兩面預設是收合的（只有預設那一輪）| 沒點任何東西時 `.vp-columns` 不得存在。守的是那個核心決定本身 |
| 展開真的生效（只有展開那一輪）| 點完 `.vp-trigger` 之後 `.vp-columns` 要有高度。沒有這條，那一輪就是無法被證偽的綠燈 |
| 頁尾的 `.footer-meta` 沒有被播放器蓋住（報告層與佐證層）| 捲到文件底，`.footer-meta` 的底緣不得低於 `.dock` 的頂緣。**只量這一條縱向關係**——footer 的內容、寬度與區段結構都不在範圍內 |

報告寫進 `scripts/layout-assertions.latest.json`，全過 exit 0、有 FAIL exit 1。

**它不守**：每行字數（58ch 的推導仍是手做）、視覺品質、那四個器械以外被 `overflow:hidden` 祖先裁掉的任何元素，以及**「東西有沒有在首屏內」**（斷言只量碰撞、裁切與溢出，一個區塊被推到 y=1200 照樣全綠）。**它也只載 `/`，也就是最新那一天**——圖上的器械高度由當天的 headline 與 dailyThesis 決定，所以這是一個內容驅動的元件的**單日單樣本**：今天全綠只證明今天那一組內容不撞。固定高度版面就曾這樣被放過去（2026-09-07：49 個報告日裡有 9 天在舊版是碰撞，而報告記著 `failed: 0`）。要驗一段時間的內容，自己用 `/d/YYYY-MM-DD` 逐日量，可用日期問 `/api/brief/dates`。**footer 那條也只是一條縱向關係**——footer 有幾個區段、寬度對不對齊、內容有沒有寫錯，一概不在裡面（後來砍掉兩個 footer 區段時，那些是手做量測驗的）。綠燈的意思是「表上那幾件事沒問題」，不是「版面沒問題」。

**兩個邊界都決定不收（2026-08-02）**，理由寫在這裡，別再重推：

- **每行字數**：58ch 只有在字級或框寬被改動時才會偏離，而那兩件事已經分別有斷言（字級落在級數表）與 `DESIGN.md` 的明文推導擋著。行長要量得準得處理中英混排、標點與 `letter-spacing`，投入大於它能抓到的東西。
- **裁切覆蓋**：查過 `BriefSynopticChart.vue` 的結構——`.synoptic` 底下**承載文字的元素就是那四個器械**（`.chart-overlay` 含 kicker／標題／主軸卡、兩個 `.force-*`、`.chart-stations`），其餘只有 `.chart-canvas` 的等壓線／力場／鋒面——純紋理 SVG，被圖紙裁掉不會讓任何一個字消失，量它抓不到讀者看得出來的問題。真正沒守到的是**圖區以外**、有 `overflow:hidden` 祖先的元素，而那一類（行事曆帶、窄版讀數帶的水平捲）是刻意裁切——擴大斷言換到的實際覆蓋接近零，卻要維護一份例外清單，而例外清單本身就是下一個「宣稱比實際大」的風險點。

**打遠端要留意載入時序**：`networkidle` 只保證網路安靜了，不保證 Vue 已經把資料畫出來。腳本會先等頁面進入終局狀態（`.synoptic` / `.brief-empty` / `.brief-status-error`）再量——這是 2026-08-02 對 prod 第一次執行回 2 FAIL ＋ 1 輪 SKIP（三次重跑都 68/0，當時的總數）之後補的。三者都等不到才讓「器械都在場」那條去報，那條守備沒有被拿掉。

動過版面就重跑它，並把新報告一起 commit（`DESIGN.md` 的 Layout 節有同樣要求）。報告是**最後一次執行的紀錄、不是 golden file**——量測值取自跑的當下那份報告內容，換一天重跑即使版面沒動也會有 diff。

```bash
pnpm dev:web                      # 另一個 terminal
pnpm --filter web layout:assert   # 預設打 http://localhost:5173
pnpm --filter web layout:assert --url http://localhost:5174
```

用 `playwright-core` 驅動**本機安裝的 Google Chrome**：`playwright-core` 沒有下載瀏覽器的 postinstall，所以不會被 `pnpm-workspace.yaml` 的 `allowBuilds` 擋、也不會拖慢 CI。沒裝 Chrome 會 exit 2 並說明原因。**刻意不進 CI**——要 build ＋ 起 server ＋ 裝瀏覽器，對這個階段的專案代價不值（2026-08-02 決定）。

## 依賴

| 來源 | 用途 |
|------|------|
| `@suanomics/shared` | type-only import：`MarketBrief` / `Podcast` / `CascadeChain` 等 schema 推回的 type |
| `vue` 3 / `vue-router` 5 / `pinia` 3 | 前端核心 |
| `reka-ui` + `shadcn-vue` | UI primitives |
| `tailwindcss` 4 + `@tailwindcss/vite` | CSS-first 主題（`@theme` directive） |
| `markdown-it` | 訊息渲染 |
| `@iconify-json/lucide` | icon set |

## Backend 耦合

- 透過原生 `fetch`、base URL 走 `VITE_API_URL`（dev 預設 `http://localhost:3000`）。
- 打的 endpoint：
  - `GET /api/brief/daily`、`GET /api/brief/news/:id`、`GET /api/brief/analyses/:id`
  - `POST /api/brief/analyze`（拿 `jobId`、之後輪詢）
  - `GET /api/jobs/:id`（`useAnalyzeJob.ts` 內部用）
  - `POST /api/transcript`
- 不直接打 LLM、不直接連 DB。

## 約束

- 禁 import `apps/server`（lint zone 強制）。
- 不放任何 API key、所有外部 service 透過 `apps/server` proxy。
- Tailwind theme tokens 集中在 `src/assets/main.css` 的 `@theme`，不再用 JS config。

## 部署

`Dockerfile.web`（repo root）——build 出 dist 後由 caddy 靜態服務，SPA fallback 在 repo 根的 `Caddyfile`。
主機無關的部署事實見 [deploy](../../docs/operations/deploy.md)。
