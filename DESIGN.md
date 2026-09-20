---
name: 掐指連總經 Suanomics
description: 一張正在變化的力場圖，圖上沒有任何需要查圖例的東西——每天一份可查證的總經連動簡報
colors:
  chart-paper: "#eef4f6"
  paper: "#fbfcfc"
  ground: "#f4f8f9"
  ground-2: "#e9f0f2"
  ground-3: "#dde8ec"
  ink: "#16232b"
  ink-2: "#3c4d57"
  ink-3: "#6d818b"
  ink-muted: "#93a4ac"
  hairline: "#cfdde3"
  hairline-faint: "#dde7ea"
  cold-front: "#1f6fb2"
  cold-front-soft: "#e4eef6"
  warm-front: "#c2402f"
  warm-front-soft: "#f7e9e6"
  alert-amber: "#e08a1e"
  rise-red: "#c0392b"
  fall-green: "#15803d"
  verdict-red: "#dc2626"
  verdict-amber: "#d97706"
  verdict-green: "#15803d"
typography:
  alarm:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "42px"
    fontWeight: 900
    lineHeight: 1.24
    letterSpacing: "-0.01em"
  alarm-mobile:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "26px"
    fontWeight: 900
    lineHeight: 1.32
    letterSpacing: "-0.01em"
  page-title:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "32px"
    fontWeight: 900
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  section-heading:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.01em"
  takeaway:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.75
    letterSpacing: "0.02em"
  intro:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.9
    letterSpacing: "0.03em"
  body:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.85
    letterSpacing: "0.012em"
  body-compact:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.75
  small:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  kicker:
    fontFamily: "'Barlow Semi Condensed', 'Noto Sans TC', 'PingFang TC', sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.14em"
    textTransform: "uppercase"
  station-label:
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.03em"
  station-value:
    fontFamily: "'Barlow Semi Condensed', 'Noto Sans TC', 'PingFang TC', sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.1
    fontFeature: "tabular-nums"
  station-note:
    fontFamily: "'Barlow Semi Condensed', 'Noto Sans TC', 'PingFang TC', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    fontFeature: "tabular-nums"
rounded:
  none: "0"
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
components:
  chart-stage:
    backgroundColor: "{colors.chart-paper}"
    rounded: "{rounded.none}"
    height: "min 580px desktop（內容更長就跟著長）/ content-driven mobile"
  chart-overlay:
    backgroundColor: "color-mix(in srgb, {colors.paper} 90%, transparent)"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "11px 15px 13px"
  force-label:
    backgroundColor: "color-mix(in srgb, {colors.paper} 88%, transparent)"
    textColor: "{colors.cold-front}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  station-band:
    backgroundColor: "color-mix(in srgb, {colors.paper} 94%, transparent)"
    borderColor: "{colors.hairline} — 只有上下緣，左右不畫"
    rounded: "{rounded.none}"
    padding: "13px 18px per cell；第一格左內距走 --chart-panel-pad、與主軸卡對齊"
  calendar-band:
    backgroundColor: "{colors.paper}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.none}"
    padding: "9px 16px per item"
  docked-player:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "11px 24px"
  transcript-sheet:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "14px 24px 8px"
  reading-progress:
    backgroundColor: "{colors.hairline-faint}"
    fillColor: "{colors.warm-front}"
    height: "3px"
  section-takeaway:
    typography: "{typography.takeaway}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline-faint}"
    rounded: "{rounded.none}"
  depth-disclosure:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    borderColor: "{colors.hairline-faint}"
    rounded: "{rounded.none}"
    padding: "11px 0 0"
  button-primary:
    backgroundColor: "{colors.warm-front}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "11px 22px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.sm}"
    width: "32px"
    height: "32px"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.none}"
    padding: "11px 14px"
  chip-source:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  card-citation:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline-faint}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  card-relation:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
---

# Design System: 掐指連總經 Suanomics

## Overview

這個世界叫 **The Synoptic Chart（天氣圖）**，seed `d4641004`。

總經不是一串新聞卡片，是**一張正在變化的力場圖**：誰在推誰、推多用力。首屏就是今天那張圖——一道帶三角記號的主鋒面是當日論點，兩側是白話標籤的推升／壓抑力場，觀測站讀數釘在圖的底緣。捲過去之後完全回到單欄長文，圖不再出現，只在每節標題旁留一個小記號告訴你這節屬於哪一股力。

預報是機率語言而不是建議，所以合規是**形式內建**而非外貼的免責聲明。podcast 因此不是「讀 vs 聽」的二選一，而是「對這張圖的播報」——播放器常駐頁面底部，捲到哪都在。

**這個世界的鐵律：圖上不得出現任何需要查圖例的東西。** 每個記號只有兩種身分——自帶白話標籤，或純紋理。`H`／`L`／等壓線數值一律不得出現。

## Colors

### Primary — 鋒面

兩極是語意色，不是品牌裝飾：

- `cold-front` `#1f6fb2` — 冷鋒＝**壓抑**的力。主鋒面線、三角記號、壓抑側力場暈區、挑戰論點的欄位。
- `warm-front` `#c2402f` — 暖鋒＝**推升**的力。推升側力場、閱讀進度、播放進度、主要動作、kicker。
- `alert-amber` `#e08a1e` — 警報。行事曆上需要特別留意的事件（FOMC、CPI）。用量極少，多了就不是警報。

### Neutral — 圖紙與觀測墨

- `chart-paper` `#eef4f6` — 圖底（桌面）。首屏力場圖與次要頁面的 `.page-ground` 都站在這張紙上。
- `paper` `#fbfcfc` — 壓在圖上的面板與閱讀欄。**必須比圖底亮一格**，「紙壓在圖上」的隱喻才成立。
- `ground` / `ground-2` / `ground-3` — 頁面底、次級容器、hover。
- `ink` `#16232b` → `ink-2` `#3c4d57` → `ink-3` `#6d818b` → `ink-muted` `#93a4ac` — 四階墨。
- `hairline` `#cfdde3` / `hairline-faint` `#dde7ea` — 這個世界的分隔一律是 1px hairline，不是陰影也不是色塊。

### 只有一疊紙

**這個世界沒有暗色主題。** 產品每天 05:10 發布、給人早上讀一次、手機為主，暗色的價值在夜讀而那不是它的時段；而「紙」的隱喻要在暗色成立，得長期維持一條「暗色不是亮色反相、夜紙必須比夜桌面亮一格」的約束，那種規則會安靜腐爛。2026-08-02 移除（`[data-theme='dark']` token 區塊、`useTheme`、切換鈕、no-flash 腳本）。

已知代價：作業系統設深色的讀者，清晨在手機上會吃到一整片亮。這是刻意接受的。

### Tertiary（語意色，不參與品牌表達）

`rise-red` `#c0392b` / `fall-green` `#15803d` 只用於漲跌方向；`verdict-*` 只用於錯誤、警告與判定。它們不得被拿來當裝飾色。

### Named Rules

- **漲跌色依台灣市場慣例：上漲紅、下跌綠。** 與美股相反，不要「順手」改回去。觀測站讀數的漲跌用 `rise-red` / `fall-green`；底色必須與文字同色系一起指定（up 配 `warm-front-soft`、down 配 `verdict-green` 的淡底），只換一邊會出現紅字配綠底。
- **紅綠只表示方向，不表示好壞。** 任何「這是好消息」的暗示都踩合規線。方向色也不得借給非漲跌語意的元素——正反觀點的「支持／風險」用 `verdict-*`，不用 `rise-red` / `fall-green`。
- **落後的讀數要降階。** 不是最近一個交易日的值，數值降成 `ink-3` 並附日期——舊值被讀成今天的行情是事實錯誤，不是樣式問題。
- **`accent` 對齊 `warm-front`。** 讀者面的高亮與連結沿用同一支紅，不另立品牌色。

## Typography

兩個聲部，沒有第三個：

- **Noto Sans TC 講話**，靠字重分階。900 是警報標題（首屏大標）、700 是結論與小標、400 是內文。
- **Barlow Semi Condensed 報數字**（源自公共標示牌的窄體）。讀數、時戳、kicker 走這支；欄位對齊靠 `tabular-nums`，不靠等寬字。

**刻意不留明體與等寬字**——天氣圖沒有明體。舊世界的 `--font-serif` / `--font-mono` 已更名為 `--font-display` / `--font-num`，不要加回來。

### Hierarchy

**八級，相鄰級距一律 ≥1.13。**

| 級 | 比上一級 | 角色 | 用在哪 |
|---|---|---|---|
| 42 | — | alarm（手機 26） | 首屏疊在圖上的當日大標 |
| 32 | 1.31 | page-title | 次要頁面標題 |
| 24 | 1.33 | section-heading | 長文每節標題 |
| 20 | 1.20 | intro、takeaway | 長文導言、每節的一句話結論 |
| 17 | 1.18 | body | 長文內文 |
| 15 | 1.13 | body-compact、station-value | 次級內文、觀測站讀數（Barlow tabular）|
| 13 | 1.15 | small | 標籤、chip、導覽項、按鈕 |
| 11 | 1.18 | kicker、caption、station-label、station-note | 身分標、時戳、讀數的標籤與註（Barlow 走 kicker 與讀數）|

### Named Rules

- **級數表是約束，不是現況清單。** 相鄰級距低於 1.13（小字級低於約 2px）時，讀者不會讀成「階層」，只會讀成「不一致」。要加新級數之前先問：是這個角色真的缺一階，還是只是懶得對到既有的一階。2026-08-02 之前這裡有 **21 種字級**在用，光 8–14.5 之間就塞了 13 種；收成 8 級。
- **一句話結論比內文大一階、且更重。** 兩者同尺寸時只剩字重差，掃讀時抓不住。takeaway 曾經是 18 對內文 17（比 1.06），規則在文件上成立、在畫面上沒兌現——現在是 20 對 17。
- **兩個聲部各自吃自己的級數。** 同一個尺寸落點上，Barlow 走 kicker 與讀數、Noto 走標籤與說明；卡在兩級中間的值按**聲部**分配，不按就近取整。
- **Barlow 只給數字與標籤，不給句子。** 用窄體排中文句子會變成「用儀器字讀文章」。
- **內文欄寬 58ch，而且整頁的寬度是從它推導出來的**，不是先定一個框再讓內文去填。58ch 在 17px 下 ＝ 548，加 gutter 48 與側欄 288 再加左右 44 padding ＝ 框寬 972；圖上的器械、正反兩面、tab 帶、佐證格線都走這個框。
- **markdown 產出的 `<p>` 要明確繼承包裹層的字級。** `main.css` 的全域 `p { font-size: var(--size-body) }` 是元素選擇器，會蓋掉包裹層——長文曾因此以 15px 而不是 17px 渲染了一整個版本。

**58ch 是量過的，不是抄來的。** 2026-08-02 拿同一段 618 字的真實內文實測：

| 欄寬 | 字級 | 每行字數 | 段落高 |
|---|---|---|---|
| 780 | 15px（當時實際運行的實況） | 51.5 | 333 |
| 756 | 17px | 44.1 | 440 |
| 660 | 17px | 38.6 | 503 |
| **548（58ch）** | **17px** | **32.5** | **597** |

放寬到 756 可以讓頁面短 26%、也仍比當時的行長短，但實際閱讀後的判斷是「一行的份量變重、閱讀的心理難度變高」。所以取捨結論是：**頁高用資訊架構去解（把佐證收進第二層），不要用行長去換。**

## Layout

**一個寬度，每個斷點都是。** 圖紙、圖上的器械、正反兩面、tab 帶、散文欄與側欄，**以及 masthead 與 footer**，全部收在同一個矩形裡——框寬由內文量度推導，見 Typography。主文欄左緣＝觀測站讀數帶左緣，側欄右緣＝讀數帶右緣。

masthead 與 footer 是 2026-08-02 才收進來的：`--measure-frame`／`--frame-pad` 原本宣告在 `.brief-landing`，而它們站在那個元素之外綁不到，於是各自寫死 1080（首頁 masthead 再覆寫成 1200）。1280 上差 40／54px 不太看得出來，**3440 上就是三條分得開的邊界**（masthead 1120／footer 1180／圖紙 1234）。兩支 token 因此移到 `main.css` 的 `:root`。**橫條本身仍然滿版**（masthead 的 sticky bar、footer 的底色、播放器）——收的是裡面的內容，不是那條帶。

**襯底區塊裡的字再內縮一層。** 疊在圖上的主軸卡與觀測站讀數帶用 `--chart-panel-pad`（桌機 15、窄版 12），所以它們的**文字**比大標右移 15px。那不是沒對齊——大標沒有襯底、它們有；兩個相疊的襯底區塊之間才必須一致。

- **≥1024**：框 972 ＝ 548 散文 + 48 gutter + 288 側欄 + 88 padding。
- **≤1023**：側欄回到主欄上方，那條算式不再綁住框寬，框直接收成 612 ＝ 548 + 64 padding。

圖紙一度比框寬（1600），讓等壓線與鋒面跨出器械之外、像一張裁切過的天氣圖；框收窄到 972 之後左右各多出 314px 的灰，2026-08-02 決定讓圖紙跟著收。**這個世界現在沒有第二個寬度。**

### Named Rules

- **窄版的分界在 1024，不在 719。** 框在 1023 以下收成 612，圖若還走桌機那套疊放（標題組綁 `--measure-frame` 的固定寬），標題組會被擠成 323px 寬。所以整個 1023 以下都走窄版處理：圖退成背景層、內容照正常流、讀數帶水平捲。平板拿到的是**放大版的手機**，不是縮小版的桌機。
- **不要用「框留在視窗寬」來解窄螢幕的留白。** 散文鎖 58ch、框卻跟著視窗長，右邊就是無主的死空白——那正是這一版在 4K 上花了整輪拆掉的東西。
- **fixed 元素的 reserve 掛在文件的最後一個元素上，不是掛在它旁邊那個。** 播放器的 108／132px 曾經是 `.brief-landing` 的 `padding-bottom`，而 footer 是那個元素在 `App.vue` 的兄弟節點——於是 reserve 把 footer 往下推出一個 260px 的空隙，卻完全沒有保護 footer 自己的尾巴：捲到底時 `.footer-meta` 整條在播放器底下（桌機被蓋 31px、手機 62px），而頁面底部就是 footer 底部、再也捲不出來，那一行等於不存在（2026-08-02 量到）。**判準是「文件末端那一段被誰蓋住」，不是「哪一塊看起來需要留白」。** 也不要無條件留：播放器只在首頁，工具頁多留一段就是死空白，用 `.app-shell:has(.dock)` 綁條件。

- 首屏＝力場圖（桌機 **下限** 580px，內容更長就跟著長高）。標題組疊在左上、力場標籤在右、觀測站讀數釘在底緣，三者**必須量過互不相撞**。標題組與讀數帶走正常流（讀數帶靠 `margin-top: auto` 貼底），只有力場標籤仍是絕對定位。**固定高度是 2026-09-07 才改掉的**：固定 580 只留得出 407.25px 給標題組，而標題組的高度由當天的 headline 與 dailyThesis 決定。量過全部 49 個報告日（2026-05-10 ~ 09-04，桌機 1280）：標題 3／4／5 行、主軸 2／3／4 行或缺席，標題組共 8 種高度、185.48 ~ 433.81，**其中 9 天超過 407.25**，在固定高度下都是碰撞——主軸最後一行落在讀數帶底下。改成 `min-height` 之後那 9 天把圖撐到 606.56，其餘 40 天逐 px 不變；語料未出現過的最壞組合（5 行標題 ＋ 4 行主軸）合成實測圖高 658.64、仍無交疊。**教訓：兩個高度都由內容決定的區塊，靠固定容器高度加絕對定位「量過不相撞」，量到的只是當天那一種組合；而「當天」的樣本數是 1。**
- 圖之後貼著一條站在同一張圖紙上的帶：「接下來會來的」時間軸帶。圖紙的最後一條是分層 tab（2026-08-02）；**本日主軸的正反兩面已不在圖紙上**，它站在 tab 之下、跟長文同一張紙，且預設收合（見下方 Viewpoints Band）。
- 再往下是閱讀區，開頭是兩層的 tab 帶（sticky）。第一層是報告，第二層是佐證與來源。
- 底部 fixed 播放器，**由文件的最後一個元素（footer）預留它的高度**（`--dock-reserve`，桌機 92px／窄版 116px；播放器實測 67／90）。
- 頂端 3px 閱讀進度條，fixed。

### Named Rules

- **手機不用絕對定位把文字疊在圖上。** 390px 放不下「互不相撞」，內容一變長就碰撞。正解是圖退成背景層（`position:absolute; inset:0`）、內容照正常流排。
- **切換 display 的 class 掛在專用 wrapper 上**，不要掛在同時是被定位者的元素上——同一個元素既是容器又是被定位者，改一邊就壞另一邊。
- **版面驗證不能只看截圖。** 用 `getBoundingClientRect` 量兩兩碰撞與水平溢出。這件事已經有可重跑的產物，不要再手做：`pnpm dev:web` 之後跑 `pnpm --filter web layout:assert`，它在 2560／1280／900／390 四個寬度 ×（報告層／報告層且正反兩面展開／佐證層）三輪各驗五條（字級落在級數表、無水平溢出、四個器械都在場、器械沒被圖紙裁掉、器械兩兩不相撞），前兩輪各再多一條狀態斷言（預設那輪「正反兩面預設是收合的」、展開那輪「展開真的生效」），報告層與佐證層再各一條「頁尾的 `.footer-meta` 沒有被播放器蓋住」（後來加的，那五條全在頁面上半部、對文件末端一無所知），共 76 條，結果寫進 `apps/web/scripts/layout-assertions.latest.json`。「展開」那一輪是後來加的——收合成預設之後不點開，展開後的 DOM 就完全不進量測；但那五條全在正反觀點的上方或與它無關，所以**點擊失效也會全綠**，那兩條狀態斷言就是為了讓這種情況 FAIL 而不是靜靜多印五條 PASS。它們同時是報告 JSON 裡唯一能區分收合／展開的指紋，並且守住「預設是收合的」這個決定本身。找不到觸發器時整輪 `SKIP` 並讓總數掉回 52，不假裝驗過（量不到播放器時同理，頁尾那 8 條記進 `SKIP`、總數掉回 68）。動過版面就重跑它，並把新報告一起 commit。**綠燈只代表表上那幾件事沒問題**——每行字數與視覺品質仍要自己看，`.synoptic` 是 `overflow: hidden`、那四個器械以外的元素跑出圖外不會有人報，「某塊有沒有被推出首屏」根本不在量測範圍內，而頁尾那條也只是一條縱向關係（footer 有幾個區段、寬度對不對齊都不在裡面）。**它也只載 `/`（最新那一天）**：圖上器械的高度由當天的 headline 與 dailyThesis 決定，所以對這個內容驅動的元件它是**單日單樣本**——固定高度版面就曾這樣被放過去（49 個報告日裡 9 天在舊版是碰撞，而報告記著 `failed: 0`）。這兩個邊界**2026-08-02 決定不收**：圖區裡承載文字的就是那四個器械，其餘只有 `.chart-canvas` 的純紋理 SVG（被裁不會讓任何一個字消失），擴大量測換到的覆蓋接近零；行長則要處理中英混排與標點才量得準。完整理由在 [`apps/web/README.md`](apps/web/README.md) 的「版面斷言」節。

## Elevation & Depth

這個世界**幾乎不用陰影**。分層靠三件事：圖紙 vs 紙的明度差、1px hairline、以及疊在圖上的半透明襯底。

`--shadow-xs` / `sm` 保留給少數浮起的小卡片；`md` 不使用。`lg` 只有一個去處：**離開正常流、疊在頁面之上的浮層**（目前唯一一個是日期選單 `BriefDateSwitcher` 的 `.ds-picker`）。浮層要跟底下的內容切開，hairline 與明度差在這裡不夠——這是 2026-08-02 為了把該處的字面陰影收進系統而確立的例外，不是把 `lg` 開放給讀者面卡片。

### Named Rules

- **疊在圖上的內容一律自帶襯底。** 這是「圖不需要圖例」能成立的前提——沒有襯底，等壓線會從字底下穿過去。
- **不用陰影表示重要。** 重要靠字重與位置。

## Shapes

**直角是預設。** 這個世界的器械是畫出來的框，不是圓角軟卡片：觀測站讀數帶、行事曆帶、播放器、輸入框、主要按鈕、深度展開層一律 `rounded.none`。

圓角只留給兩處既有物件：來源 chip（pill）與引用卡（`rounded.md`）。

### Named Rules

- **新元件預設直角。** 要用圓角必須說得出理由。
- **不用 3px 色條側邊標示區塊身分。** 那是上一個世界的裝置，已全數移除。

## Components

### 力場圖 Synoptic Chart（signature）

資料驅動的 SVG：主鋒面由 `dailyThesis` 的日期 seed 生成、力場暈區大小由 `affectedIndustries` 的方向與信心決定。SVG 一律 `aria-hidden`——所有讀者需要理解的東西都是它上面的 HTML 文字。

**鋒面振幅要小（0.028–0.058）。** 大振幅讀起來像裝飾 swoosh，不像天氣圖，那就是「假氣象網站」。

### 力場標籤 Force Label（signature）

白話的兩個字（推升／壓抑）+ 一行主體，自帶半透明襯底。這是「不需要圖例」的落點。

### 觀測站讀數帶 Station Band（signature）

市場數字釘在圖底緣，桌機靠 `margin-top: auto` 貼在圖的底緣、手機接在力場標籤下面可水平捲。格數由 `KEY_NUMBER_SERIES` 決定（目前定義 7 條、當天有資料的才出現，所以常見是 6 格）——**不要把某天的格數寫成規格**。**數字獨立於報告**：報告未發布的日子仍要顯示。

**不畫四邊外框**（2026-08-02）：帶的上下緣各一條 hairline、左右不畫，與主軸卡同一種形式——襯底加一條線，不是卡片（見 Elevation）。原本外框與內層的上下 hairline 疊了兩條 1px。**第一格的左內距走 `--chart-panel-pad`**，與正上方主軸卡的內距同一支：兩個襯底區塊直接相疊，字的左緣差幾個 px 就看得出來。其餘各格的 18px 是**分隔線之後的溝寬**，跟外緣內距是兩種角色，不要拉成同一個值。原本第一格是 `padding-left: 0`（想讓讀數對齊大標），實際效果是讀數貼著框線像掉出框外——大標沒有襯底、主軸卡有，對齊的對象選錯了。

### 一句話結論 Takeaway（signature）

每節長文最上方的一行粗體結論，下方一條 hairline 與內文分開。**不做成卡片**——卡片會切斷散文的連接組織，而連接組織正是這個產品的賣點。`null` 時整條不出現（舊報告與 degrade）。

### 深度展開層 Section Depth（signature）

每節收合的引用與連動。連結靠 section 與 chain 共用的 citation url。展開層只放第一層、超過三條指向下方的完整連動區。

### 本日主軸的正反兩面 Viewpoints Band（signature）

「今日報告」層的第一塊，站在跟長文同一張紙上。**主詞由位置決定**：主軸在圖上、只隔著一條分層 tab，所以「支撐／挑戰這個主軸」不需要回引，也不得把主軸再印一次（`dailyThesis` 全站只出現一次）。放在整篇長文之後時主詞會斷掉——讀者看不出它在爭哪一句。不做成卡片：卡片會把它讀成長文結束後的附錄。兩欄之間用一條 hairline 分，綜合淨讀用暖鋒半圓記號與主軸的冷鋒三角成對。

它原本貼在力場圖下緣、與圖共用一張圖紙；2026-08-02 讓位給分層 tab（tab 必須在首屏內才有人知道有兩層，見下）。**代價是明的**：主軸與正反兩面之間多了一條 tab，同一張圖紙的連續感沒有了。換到的是「切層時正反兩面跟著消失」——那是讀者唯一看得出切換有作用的訊號。

**預設收合（2026-08-02）。** 展開態的兩欄加淨讀佔 484px（桌機）／868px（手機），而它站在長文之前，於是讀者要捲 2.8 屏才碰到真正的報告。收合殼沿用長文展開層那一套（`▸` 記號、同一種旋轉、整條標題行都是觸發區），收合時右側報「N 支撐 · M 挑戰」、展開時換成「收起」。**合規聲明留在收合殼外面**——收的是論證，不是那句聲明；它是報告層唯一的合規聲明（`brief.disclaimer` 只在佐證層渲染）。**淨讀不做截斷式預覽**：`netRead` 的 schema 是 120–360 字、結構上不是一句話，而截出來的第一句實測在複述主軸。收合後長文開始從 y=1641／2362 提前到 y=1257／1584。**代價**：暖鋒半圓與主軸冷鋒三角的成對關係要展開後才看得到。

### 兩層 Reader Layers

第一層是今天要讀的東西（正反兩面 → 一瞥列 → 推論重點 → 長文），第二層是「有興趣再追」的佐證（報告用到的來源清單 → 連動結構）。層別放在網址的 `?view=`，不是元件狀態——讀者要能把某天的佐證直接貼給別人。

**tab 是圖紙的最後一條**，不是紙面上的第一條：底色跟圖紙走、上緣不畫線、下緣那條就是圖區與閱讀區的交界，並綁 `.brief-stage` 同一條量度（否則圖紙色鋪滿視窗、破掉「整頁一個寬度」）。它必須在首屏內——2026-08-02 之前它在 `y=1130`，讀者要捲過整個圖與正反兩面才遇得到，而那時兩層共用整個上半部，切過去前 1130px 完全一樣、連切了什麼都看不出來。

**切層換掉的是 tab 以下的全部**，包含正反兩面。這是刻意的：兩層若共用上半部，切換就沒有可見的回饋。

**分層的理由是資訊層級，不是頁高。** 佐證那幾塊本來在 2560 只佔 593px，頁高的一半是長文本身。**第二層裡不收合**——收合殼是它們還住在第一層時省頁高用的，在這一層它們就是主角。

**The One Vocabulary Rule.** 整份報告只有一套產業語彙。連動結構依「今天有哪幾股力」分組，用的是力場圖上那幾個名字、順序也跟著它；長文每節標題旁的「屬於哪股力」也是同一套。連動鏈自己帶的產業標籤是 LLM 逐條自由命名的（一份報告 51 條可以有 49 個不同名字），只當 chip 的字面，不當分類軸。歸不進任何一股力的落在最後一組「其他連動」——那是誠實，不是待修的殘留。

### 常駐播放器 Docked Player（signature）

fixed 在底部的深墨列，像音樂播放器。`<audio>` 掛在這裡，播放不因捲動或展開逐字稿而中斷。**逐字稿是這條列上的唯一入口**，不再是一級面板。

### 閱讀進度 Reading Progress

頂端 3px，scroll 驅動。用 `transform: scaleX()` 而不是 `width`——每一幀都會改它，只跑 compositor。

### 其餘元件

按鈕、輸入框、chip、引用卡、連動矩陣、來源架、摺疊區塊、狀態與骨架的規格見 frontmatter 的 `components` 區塊。正反觀點（Viewpoints Band）不在那個區塊裡，它是 signature 元件、規格在上面同名那一節。

## Do's and Don'ts

### Do:

- 圖上每個記號自帶白話標籤，或就是純紋理。
- 疊在圖上的文字一律加襯底。
- 分隔用 1px hairline。
- 數字用 Barlow + `tabular-nums`。
- 落後的讀數降階並標日期。
- 新元件預設直角。
- 版面改動用 `getBoundingClientRect` 量碰撞，桌機與手機各驗一次。

### Don't:

- 不放 `H`／`L`／等壓線數值，或任何要查圖例才懂的符號。
- 不把長文切成卡片網格——那同時撞上「通用 SaaS dashboard」與「新聞入口」兩個反向參照。
- 不用 3px 色條側邊標示區塊。
- 不用明體或等寬字。
- 不用陰影表示重要。
- 不在手機用絕對定位把文字疊在圖上。
- 不讓 `dailyThesis` 在全站出現第二次（首屏獨佔）。
- 不用紅綠暗示好壞，只表示方向。
