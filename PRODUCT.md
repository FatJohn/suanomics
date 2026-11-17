# Product

讀者：設計或修改 `apps/web` 讀者面的 AI coding agent（含 Impeccable skill）與維護者
型別：參考

<!-- impeccable:product-schema 1 -->

本檔是 Impeccable 讀取的產品事實：讀者、用途、限制與品牌承諾。視覺決定（色彩、字體、元件、版面）在 `DESIGN.md`。標「推定」的條目由 repo 文件推得、尚未經維護者逐條確認；標「未決」的條目不要替它做決定。系統架構與取捨以 [設計依據](docs/architecture/design-basis.md) 與 [決策紀錄](docs/adr/) 為準，v0 的產品敘述在 [docs/history/PRODUCT.md](docs/history/PRODUCT.md)，只當背景。

## Platform

web

## Users

- **第一讀者是維護者本人**（[設計依據〈目標與讀者〉](docs/architecture/design-basis.md#目標與讀者)）：每個台股交易日開盤前讀一次，用來知道前一晚世界發生了什麼、會牽動哪些台股標的。
- **公開網站供任何人閱讀**：不一定看盤、想搞懂「這則新聞為什麼重要、牽動什麼」的泛財經讀者（推定，沿用 v0 的讀者描述）。
- 閱讀情境：一天一次、開盤前，手機與桌機都要成立（推定）。
- 不是目標讀者：要進出場點位、明牌或個股推薦的人。

## Product Purpose

每個台股交易日開盤前自動產出一份總經報告：前一晚發生了什麼、透過什麼機制牽動哪些台股標的、方向為何，每條連動鏈附引用來源。網站是這份報告的閱讀介面，也是可被搜尋引擎索引的歷史存檔（[ADR 0005](docs/adr/0005-astro-static-site.md)）。

成功的樣子：讀者在開盤前幾分鐘內讀懂當日主軸與各段論證，並能順著來源連結查證任何一句話。

## Positioning

鄰近產品照抄不了的是「新聞 → 機制 → 台股標的」的因果鏈，每一段都帶可點的原始來源，而且報告會主動寫出自己的限制（「資料未涵蓋」「不宜直接認定為單一因果」）。一般 AI 財經摘要給「發生了什麼」；本產品給「牽動什麼、憑什麼這樣推、哪裡還不確定」。

## Operating Context

- **每日節奏**：Cloudflare Worker 05:00（台北）觸發 pipeline，產出後 Astro build、部署到 `https://suanomics.everbegin.net/`。非交易日（週末、TWSE 休市日）不產報告，網站停在前一份。
- **一份報告的組成**（`apps/web/src/lib/present-brief.ts` 的 `BriefView`）：日期、標題（≤80 字）、本日主軸 `dailyThesis`、摘要 `summary`、長文 `narrative`（導言、1～4 節〔小標、一句話結論 takeaway、本文 250～800 字、該節來源〕、結語）、正反觀點 `viewpoints`（支持 2～4 點、風險 2～4 點、淨讀）、本日選稿（連到站內新聞頁）、引用來源清單、免責聲明。
- **頁面**：首頁（日期最晚的一份）、單日頁 `/d/<date>`、歷史日期 `/dates`、新聞頁 `/brief/news/<id>`（標題、來源、發佈日、原文連結）。
- **內容形狀**：單日頁是 2,500～4,000 字的繁中長文，數字密度高（百分比、點數、億元、口數、日期）。

## Capabilities and Constraints

- **靜態產生**：Astro 在 build 時讀 Postgres 產出純 HTML，沒有執行期 server；v1 不含任何 island（ADR 0005）。
- **網站只讀 pipeline 寫好的結果**：`apps/web` 不 import 任何 LLM SDK；資料讀取與合規處理在 `apps/web/src/lib/**`，版面工作不改其行為。
- **區塊可能是空的**：`narrative`、`viewpoints`、`dailyThesis`、takeaway 在降級或合規攔截時為 null 或空字串；被合規規則攔下的新聞標題顯示為「（此標題依合規規則不顯示）」。版面在任何區塊缺席時都要成立。
- **來源的條款限制**：部分來源只允許網站引用標題與連結，網站不顯示來源內文或 quote（[docs/sources.md](docs/sources.md)）。
- **語言**：繁體中文（台灣用語）唯一 locale，`<html lang="zh-Hant-TW">`。
- **不做**：註冊登入、付費、個人化、線上即時分析、留言（[設計依據〈不做的事〉](docs/architecture/design-basis.md#不做的事)）。
- **podcast 會進網站**：音檔（#32，Azure TTS），屆時以 Astro island 加播放器；版面要留得下，但本輪不設計播放器。
- **技術限制**：Tailwind v4；`apps/`、`packages/` 不放 emoji；單檔 300 行上限（ESLint）。
- 未決：亮色以外是否提供暗色主題。

## Brand Commitments

- **名稱**：掐指連總經 Suanomics（中文主名在前；`SITE_NAME` 常數是「掐指連總經」）。Suan＝「算」。
- **語氣**：報告本文是中性、自我設限的分析語氣，標出推理與資料缺口；網站文案跟著這個語氣。
- **合規**：依《證券投資信託及顧問法》，不提供投資建議、不推薦個股；免責聲明是產品的一部分，不是可被版面優化掉的裝飾。
- 未決：v0 的「賽博半仙／算命不如算力」人設是否帶進 v1 網站。rewrite 的程式與文件沒有沿用，本輪不使用。
- 沒有 logo、favicon 或其他品牌資產。

## Evidence on Hand

- 正式站從 2026-11-09 起每個交易日一份真實報告，是設計素材，不用假文。
- 沒有使用者見證、流量或回訪數字、媒體報導、績效或準確率統計，不得捏造。

## Product Principles

1. **可查證優先於流暢**：每一句論證都能回到來源；來源連結是主要功能，不是註腳。
2. **解釋因果，不下指令**：交付「誰牽動誰」的理解，不是買賣建議。
3. **開盤前讀得完**：先給結論（標題、主軸、每節一句話結論），再給可展開的論證。
4. **每天都得成立**：資料缺漏、區塊降級、長短不一的日子都不破版。

## Accessibility & Inclusion

- 驗收門檻：Lighthouse accessibility ≥ 90（#31）。
- 繁中長文的可讀性是核心體驗：字級、行高、行長以長時間閱讀為準；手機最窄寬度也要完整可讀。
