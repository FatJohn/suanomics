---
name: 掐指連總經
description: 賽博半仙的開盤前重點講義：冷白影印紙、墨黑字、藍筆框線、紅筆結論、黃色螢光筆劃主軸。
colors:
  paper: "#f4f6f8"
  sheet: "#fbfcfd"
  ink: "#16202b"
  ink-2: "#4a5562"
  rule: "#cfd6de"
  blue: "#1e4fd8"
  red: "#d7262e"
  hl: "#ffe14d"
  up: "#d7262e"
  down: "#1f7a4d"
  flat: "#4a5562"
typography:
  display:
    fontFamily: "PingFang TC, Noto Sans TC, Microsoft JhengHei, Heiti TC, sans-serif"
    fontSize: "clamp(21px, 1.2rem + 1vw, 30px)"
    fontWeight: 900
    lineHeight: 1.45
    letterSpacing: "0.01em"
  headline:
    fontFamily: "PingFang TC, Noto Sans TC, Microsoft JhengHei, Heiti TC, sans-serif"
    fontSize: "19px"
    fontWeight: 900
    lineHeight: 1.5
  title:
    fontFamily: "PingFang TC, Noto Sans TC, Microsoft JhengHei, Heiti TC, sans-serif"
    fontSize: "15px"
    fontWeight: 900
    lineHeight: 1.6
  lead:
    fontFamily: "PingFang TC, Noto Sans TC, Microsoft JhengHei, Heiti TC, sans-serif"
    fontSize: "15.5px"
    fontWeight: 500
    lineHeight: 1.8
  body:
    fontFamily: "PingFang TC, Noto Sans TC, Microsoft JhengHei, Heiti TC, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.85
    fontFeature: "tnum"
  label:
    fontFamily: "PingFang TC, Noto Sans TC, Microsoft JhengHei, Heiti TC, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: "0.2em"
  caption:
    fontFamily: "PingFang TC, Noto Sans TC, Microsoft JhengHei, Heiti TC, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: "0px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  gutter: "16px"
  lg: "22px"
  section: "40px"
  column: "48px"
  foot: "56px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#1a44b8"
  key-points-frame:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    padding: "18px 14px 6px"
  key-points-tag:
    backgroundColor: "{colors.blue}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    padding: "1px 8px 1px 10px"
  nav-link:
    textColor: "{colors.ink-2}"
    padding: "4px 0"
  nav-link-active:
    textColor: "{colors.ink}"
  field-chip:
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    padding: "0 4px"
  direction-up:
    textColor: "{colors.up}"
  direction-down:
    textColor: "{colors.down}"
  direction-flat:
    textColor: "{colors.flat}"
---

# Design System: 掐指連總經

讀者：設計或修改 `apps/web` 讀者面的 AI coding agent（含 Impeccable skill）與維護者
型別：參考

本檔記錄 `apps/web` 已出貨的視覺系統，token 與規則取自 `apps/web/src/styles/global.css`、`Base.astro` 與各元件的實際樣式。frontmatter 的 token 是規範值，內文說明怎麼用；擴充資料（色階、動態、元件片段）在 `apps/web/.impeccable/design.json`。讀者、用途與品牌承諾在 [PRODUCT.md](PRODUCT.md)。

## Overview

**Creative North Star: "名師的開盤前重點講義"**

整個網站是一張補教名師每天發的影印講義：冷白紙上印墨黑字，老師用藍筆畫框、標序號、牽連結，用紅筆在每節底下劃一句結論，黃色螢光筆只劃本日主軸那一句。讀者一打開先看到講義抬頭與「本日必考重點」框，想深讀才往下看分節詳解與出處。

密度偏高但有節奏：單欄正文寬 68ch，行高 1.85，節與節之間用 40px 空白與粗細不同的墨線分隔，不靠卡片或陰影。桌機在右側多一欄固定的「本講義目錄」，手機只有一欄。拒絕財經新聞站的文章頁排法（麵包屑、標籤雲、一大片無結構內文）。

**Key Characteristics:**

- 冷白紙底（`paper`）上只有一張略亮的紙（`sheet`），用在「本日必考重點」框內。
- 線條是唯一的層次工具：3px 墨線收抬頭與頁尾，2px 藍框圈重點，1px 實線與虛線分隔列表。
- 直角、無陰影、無圓角，像影印紙上的筆跡。
- 方向照台股紅漲綠跌，每個方向同時配三角形記號與文字。
- 全站唯一的進場動畫是螢光筆從主軸句開頭劃到句尾。

## Colors

色盤是影印講義加三支筆：紙、墨、藍筆、紅筆、螢光筆，加上台股的漲跌兩色。

### Primary

**藍筆**（`blue`）：重點框的 2px 邊框與框上標籤底色、所有連結、序號（重點框的 1–5、「詳解 N／M」）、導覽列所在頁的底線、focus outline、主要按鈕底色、跳到本文連結。

### Secondary

- **紅筆**（`red`）：每節結論句底下的 2px 劃線，與「正反觀點」裡「總結」小標的字色。
- **螢光黃**（`hl`）：本日主軸那一句的螢光筆底色（下緣 42% 的色塊），以及文字選取的底色。

### Tertiary

- **上漲紅**（`up`）：方向記號「正向」的三角形與字。與紅筆同色值，靠記號與文字區分。
- **下跌綠**（`down`）：方向記號「負向」。全站只在方向記號出現。
- **持平灰**（`flat`）：方向記號「好壞參半」與「不確定」，與 `ink-2` 同色值。

### Neutral

- **影印紙**（`paper`）：`html` 與 `body` 底色，也是 `theme-color`。
- **亮紙**（`sheet`）：只用在「本日必考重點」框內，讓框從紙面浮出一層。
- **墨黑**（`ink`）：內文與標題字色，抬頭與頁尾的 3px 粗墨線、「總結」區塊的 2px 上框線。
- **淡墨**（`ink-2`）：次要文字（slogan、閱讀時間列、出處、免責聲明、理由說明）、列表 marker、未選中的導覽連結。
- **格線**（`rule`）：1px 分隔線與虛線列分隔、目錄連結的底線、捲軸。

### Named Rules

**The Red Is Up Rule.** 紅色在本站代表上漲，所以紅色不印在數字或內文上：紅筆以劃線或短標籤出現，方向一律紅漲綠跌，並配三角形記號與「正向／負向」文字，不靠顏色單獨表意。

**The One Highlighter Rule.** 黃色螢光筆一頁只劃一處，就是本日主軸那一句；其他強調用粗體或紅筆劃線。

**The Blue Pen Rule.** 藍色是老師的筆：框、連結、序號、focus。藍色實心底只用在三個地方：重點框的框上標籤、主要按鈕、跳到本文連結。

## Typography

- **Display Font:** PingFang TC（依序退回 Noto Sans TC、Microsoft JhengHei、Heiti TC、sans-serif）
- **Body Font:** 同一組字體堆疊
- **Label/Mono Font:** 無獨立字體；數字一律 `font-variant-numeric: tabular-nums`

**Character:** 單一黑體家族靠字重分層：標題 900 像講義上加粗的手寫標題，內文 400 配寬行高，結論句與主軸用 500。

### Hierarchy

- **Display**（900，`clamp(21px, 1.2rem + 1vw, 30px)`，1.45）：每日講義的大標題。
- **Headline**（900，19px，1.5）：講義各節標題（導讀、詳解、正反觀點、本日選稿、引用來源）。
- **Title**（900，15px）：正反觀點的欄標題與「總結」小標；歷史頁月份標題用 17px。
- **Lead**（500，15.5px）：本日主軸句（行高 1.8）與每節結論句（行高 1.75）。
- **Body**（400，16px，1.85）：敘事段落，欄寬上限 68ch；列表項目用 15px，行高 1.7（正反觀點的列表 1.75）。
- **Label**（700，13px，字距 0.2em）：重點框的框上標籤；目錄標題與「總結」也用 0.12em 字距。
- **Caption**（400，12.5px）：回次／閱讀時間／來源數列、歷史頁的日期列，字色 `ink-2`。

### Named Rules

**The Keep-All Rule.** H1 與 H2 只在標點與空白處換行（`word-break: keep-all`，放不下才 `overflow-wrap: anywhere`），避免「納指」這類詞被拆成兩行；標題另加 `text-wrap: balance`，段落與列表加 `text-wrap: pretty`。

**The Tabular Figures Rule.** 全站數字用等寬數字，讓百分比與金額在列表裡對齊。

## Layout

頁面容器最寬 1000px，左右 16px gutter，底部 32px。講義正文是單欄，寬度上限 68ch；視窗 1024px 以上時，正文右邊多一欄 15rem 的「本講義目錄」，`position: sticky`（距頂 24px），兩欄間距 48px。「正反觀點」在 640px 以上排成兩欄。

垂直節奏：抬頭 14px／8px 內距收在 3px 墨線上；導覽列與內容之間 14px；講義各節之間 40px；頁尾距內容 56px。列表項之間 6px，重點框內產業列每列 8px 上下內距。

## Elevation & Depth

系統是平的，沒有陰影。層次只靠兩種紙色（`paper` 與重點框內的 `sheet`）和線條粗細：3px 墨線最重（抬頭、頁尾、目錄頂、新聞頁頂），2px 次之（藍色重點框、「總結」頂線、歷史頁月份底線），1px 實線與虛線最輕。導覽列所在頁用 `inset 0 -2px 0` 的 box-shadow 畫底線，這是筆劃不是陰影。

### Named Rules

**The Flat Paper Rule.** 介面元素不加投影、不加漸層浮起；要分層就換線的粗細或改成藍框。

## Shapes

全部直角（`rounded.none`）：重點框、框上標籤、主要按鈕、跳到本文連結都沒有圓角。唯一的圓角是 focus outline 的 2px，讓焦點框不切到字。重點框的標籤以絕對定位壓在框線上（`top: -0.85em`），是講義上「框上寫標題」的筆法。

圖示全部是 12×12 的內嵌 SVG：方向三角形（實心）、不確定的空心圓、展開用的 V 形箭頭、外連的斜箭頭，筆劃寬 1.6。

## Components

### 講義抬頭與導覽

- **抬頭：** 左邊品牌名（20px、900、字距 0.06em）與 slogan（12px、`ink-2`、字距 0.12em），右邊「開盤前重點講義」與藍色日期加星期；底部 3px 墨線。
- **導覽：** 14px 的「今日講義／歷史講義」，預設 `ink-2`、hover 轉藍；所在頁轉 `ink`、700，下方 2px 藍色底線。

### 講義欄位列

回次、閱讀分鐘、來源則數三格，每格底下 1px `ink-2` 短線，像講義上待填的欄位；整列再以 1px `rule` 收底。

### 本日必考重點（Signature Component）

- **框：** 2px 藍框、`sheet` 底、內距 18px 14px 6px，框上壓一塊藍底白字標籤（13px、700、字距 0.2em）。
- **主軸：** Lead 字級，整句套螢光筆。
- **產業列：** 每列是可展開的 `details`，一列四格：藍色粗體序號、700 產業名、方向記號、V 形箭頭。列間用 1px 虛線。hover 時產業名出現藍色底線；展開後理由以 14px `ink-2` 縮排顯示，附信心程度。

### 方向記號

三角形加文字，13px、700、不換行：正向是向上實心三角（`up`），負向是向下實心三角（`down`），好壞參半是上下兩個三角、不確定是空心圓（皆 `flat`）。

### 分節詳解

節標題前有藍色的「詳解 N／M」（0.8em、字距 0.12em），標題下是一句紅筆劃線的結論（500、15.5px、2px 紅色底線、offset 0.32em），接著是敘事段落與 13.5px 的「出處」連結列（粗體標籤、頓號分隔）。

### 正反觀點

「支持這個看法」與「要小心的地方」兩欄圓點列表，marker 用藍色。「總結」區塊上方 2px 墨線、下方 1px 格線，小標用紅色。

### 本講義目錄

桌機限定。頂部 3px 墨線、標題 900 字距 0.12em，項目間用 1px 虛線；連結預設墨黑配格線色底線，hover 轉藍。

### Buttons

- **Shape:** 直角（0）。
- **Primary:** 藍底白字、700、內距 8px 16px，文字後接 12px 外連箭頭；只用在新聞頁的「閱讀原文」。
- **Hover / Focus:** hover 底色加深為 `--blue-deep`（`#1a44b8`）；focus 用全站的 2px 藍色 outline、offset 2px。

### 連結

藍色、1px 底線、offset 0.22em；hover 時底線加粗為 2px。

### 動態

- **螢光筆劃過：** 主軸句的底色從 30% 寬劃到 100%，900ms、`cubic-bezier(0.16, 1, 0.3, 1)`、延遲 200ms，只在 `prefers-reduced-motion: no-preference` 下執行；關閉動態時直接顯示完整螢光。
- **展開箭頭：** 產業列展開時 V 形箭頭轉 180°，200ms、同一條 easing；reduced motion 下不轉場。

## Do's and Don'ts

### Do:

- **Do** 把每日最重要的一句放進「本日必考重點」藍框，並只在那一句上套螢光筆。
- **Do** 方向一律紅漲綠跌，並同時給三角形記號與「正向／負向／好壞參半／不確定」文字。
- **Do** 用線條粗細分層：3px 墨線收抬頭與頁尾，2px 藍框圈重點，1px 實線或虛線分隔列。
- **Do** 正文欄寬維持 68ch、內文 16px／1.85，數字用等寬數字。
- **Do** 每節結論用紅筆劃線（2px 紅色 underline），不是紅字。
- **Do** 圖示用 12×12 的內嵌 SVG，跟著 `currentColor`。

### Don't:

- **Don't** 把紅色印在數字或段落文字上；紅色在本站等於上漲。
- **Don't** 在主軸以外的地方用螢光黃。
- **Don't** 加陰影、圓角或卡片式浮起；講義是一張平的紙。
- **Don't** 用綠色表示上漲、成功或任何方向以外的意義。
- **Don't** 只用顏色區分方向。
- **Don't** 在標題上方加小字標籤或分類 kicker；節的編號寫在標題同一行（「詳解 N／M」）。
