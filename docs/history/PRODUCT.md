# Product

<!-- impeccable:product-schema 1 -->

> 本檔是 Impeccable 的產品事實基準（durable product truth），只寫確認過的事實與明確標記的未決事項。
> 視覺世界（色彩、字體、元件、版面概念）不在這裡，屬於 DESIGN.md 與各 surface brief。
> 建檔日：2026-08-01。唯一 UI surface 是 `apps/web`（Vue 3 SPA），本檔為 repo 根層、由該 app 繼承。

## Platform

web

## Users

**主要讀者：泛財經好奇者**——不一定看盤、不盯報價，但想搞懂「這則新聞為什麼重要、它會牽動什麼」。

- 情境：一天一次的閱讀行為（早上或通勤時段皆可能），桌機與手機都要成立；`apps/web` 既有 RWD 最窄斷點為 419px。
- 讀者不是專業交易員：術語必須付出解釋成本才配出現在讀者面（既有 de-jargon denylist 就是這條的機械化落地）。
- 次要使用情境：貼一則新聞做即時連動分析（`/brief/analyze`）、回看過去日期的報告（`/d/:date`）。
- 明確**不是**目標受眾：需要進出場點位、明牌或個股推薦的人（見 Capabilities and Constraints 的法遵鐵線）。

## Product Purpose

Suanomics（掐指連總經）是**每日總經新聞連動簡報**：把當日財經新聞整理成有因果脈絡的敘事，並把「誰牽動誰」畫成可追溯的連動鏈（Cascade），每條推論附原始來源連結。

成功的定義（2026-08-01 使用者確認，三者並列）：

1. **每天真的有人回來看**——日更習慣與回訪是產品本體，不是加分項。
2. **深度與可信度追上人類日更節目**——對標游庭皓那類日更財經節目：具名數據、有觀點主軸、事實站得住。
3. **每條推論都可查證、零黑箱**——citations 完整、來源可點、合規零違規。

## Positioning

鄰近產品無法照抄的機制：**新聞 → 連動鏈 → 逐條 citation 的完整鏈路**。

- 一般 AI 財經摘要給「發生了什麼」；本產品給「這件事牽動什麼、憑什麼這樣推」，且推論可回到原始新聞或官方資料。
- 連動（Cascade）是產品的資料骨幹，不是附加視覺化：每日敘事、正反觀點、podcast 文稿都建立在同一組已引用的連動關係上。
- 品牌把「連動」包裝成戲謔的算命外皮（賽博半仙 / 算命不如算力），但骨子是中性數據分析——反諷本身即合規護欄。

## Operating Context

- **每日節奏**：pipeline 每日 05:10（台北）排程產出；有 publication SLO 端點與 watchdog 告警。讀者面在「今天還沒產出」「休市」「資料源斷線」時仍必須是可讀的頁面。
- **週末模式**：週六不產（gate），週日走回顧／前瞻特輯——版面必須容納與平日不同的內容形狀。
- **一次閱讀的組成**（現況 `HomeView` 順序、2026-08-02 更新）：力場圖（大標＋本日主軸＋力場標籤＋觀測站讀數帶）→ 行事曆帶（brief 攜帶的 7 天窗事件；當天沒事件就整條不渲染）→ 分層 tab（sticky、圖紙的最後一條）→〔今日報告：正反兩面（**預設收合**、只留標題行與合規聲明）→ 一瞥列 → 今日推論重點 → 長文＋側欄目錄〕／〔佐證與來源：報告用到的來源清單 → 連動結構〕。底部常駐 podcast 播放器。
- **雙形態**：同一份報告有「讀」與「聽」兩種消費方式（podcast 文稿＋TTS 音檔），讀者可切換。
- **輔助工具**：Transcript Tool（YouTube／Podcast 逐字稿擷取）屬 pre-production 內部工具，不是讀者面產品。

## Capabilities and Constraints

**已確認的功能**

- 每日簡報：主敘事（narrative）、每日單一 thesis 脊椎、正反觀點區塊（support／risk／net-read，可為 null）、連動鏈與 citations、關鍵市場數字卡、來源架。
- Podcast：文稿＋TTS 音檔（音檔存 Cloudflare R2），與當日報告同源。
- 即時分析：讀者貼標題／URL／內文（≥20 字）跑 on-demand 連動分析。
- 歷史回看：`/d/:date` 日期路由與日期切換器。
- 只有亮色一種主題。暗色於 2026-08-02 移除：產品是清晨讀一次的東西，夜讀不是它的時段（理由與代價見 DESIGN.md「只有一疊紙」）。

**硬性法遵鐵線（不可協商）**

- 不提供投資建議、不推薦個股、不做績效預測；依《證券投資信託及顧問法》第 4 條，本服務非從事證券投資顧問業務。
- `packages/shared/src/compliance.ts` 的 `FORBIDDEN_PHRASES` 是硬 gate，違規內容 degrade 成 null 而非硬塞。頁面設計必須能承受「某區塊今天是空的」。
- 免責聲明與「不做清單」是產品的一部分，不是可被版面優化掉的裝飾。

**技術與範圍限制**

- 前端選型鎖定：Vue 3 + Vite + TypeScript、Tailwind CSS v4 + shadcn-vue、Pinia、Vue Router、markdown-it。不自行更換（見 `CLAUDE.md` Tech Stack）。
- 檔案 < 300 行是 eslint error；`apps/web` 大量元件採 scoped CSS + CSS 變數，不是 utility-only。
- 明確 out of scope：註冊／登入／付費、券商 API、LINE Bot、圖片 OCR、RAG 向量檢索。因此無個人化、無帳號狀態、無付費牆版面需求。
- 語言：繁體中文（台灣用語）為唯一 locale，`<html lang="zh-TW">`；目前無 i18n 需求。
- 程式碼內禁用 emoji（除非明確要求）。

**未決事項（不要替它做決定）**

- 賽博半仙人設在讀者面的**具體視覺表現**尚未決定（見 Brand Commitments）。
- 無正式無障礙標準承諾（見 Accessibility & Inclusion）。

## Brand Commitments

- **名稱**：掐指連總經（中文主名）／ Suanomics（英文，Suan＝「算」的拼音 ＋ Economics）；作者署名 Everbegin Lab；正式站原為 `suanomics.zeabur.app`，**2026-08-29 起離線**（平台安全事件、環境已刪除；恢復時程與平台未定，見 backlog N0-6）。
- **Slogan**：算命不如算力。
- **人設**：賽博半仙——AI 財經算命師。定義文件 `docs/features/podcast-persona.md`（節目名／賽博半仙／slogan 三個固定元素不可變）。
- **★ 2026-08-01 新增的約束**：使用者確認**讀者面網站也該帶人設**，不再只限 podcast 文稿。此為 binding 的品牌方向；但既有合規護欄同時生效——「算命只是比喻外皮、主體仍是中性總經分析、不通篇命盤卦象」。具體怎麼在視覺與文案上表現，屬 DESIGN.md／new-work 的決定，本檔不預先框定。
- **語氣**：繁體中文台灣用語；報告本文目前為中性專業語氣（人設落地後的語氣分寸未定）。
- **既有資產**：`apps/web/src/assets/brand/logo.svg`、`logo-mark.svg`、`apps/web/public/logo.png`、`logo-mark.png`、`og-image.png`。

## Evidence on Hand

**真實可用的素材**

- 正式環境每日真實產出的報告與 podcast（含歷史日期），可直接作為設計素材，不需要 lorem ipsum。
- 監測來源 **28** 個啟用中的頻道，分七類、含官方機構與「經聚合器取得」兩種標記，清單硬寫在 `apps/web/src/lib/monitored-sources.ts`，渲染在 `/sources`。（**2026-08-22 修正**：原本寫 30，那是 seed 的總數；`udn-money`／`udn-main` 因 prod 出口 IP 被擋而停用（[#269](https://github.com/FatJohn/macroeconomics-report/issues/269)），讀者頁只列啟用中的。頁面上的數字是由清單長度算出來的，不是寫死的。）
- 市場數據序列 26 條（FRED 17、TWSE 5、Nasdaq 2、TAIFEX 1、derived 1），含 flow／level 語意與新鮮度 metadata。（**2026-08-02 修正**：這裡原本寫「FinMind 校正」，但 FinMind 早在 2026-05-10 隨 Lv3-B ETF 教練一起砍掉、repo 裡零程式碼；同一句錯誤文案也印在 footer 上，一併修掉。）
- 品質量尺與評測基建：`brief:quality`（pairwise）、`brief:continuity`、canary fixtures、trend 紀錄（`docs/operations/quality-trend.md`、`judge-discipline.md`）。
- 發布 SLO：`/api/ops/publication-status` 端點與 watchdog 告警。

**明確不存在、不得捏造**

- 沒有使用者見證、客戶名單、媒體報導、獎項。
- 沒有流量、回訪率或留存數字可引用。
- 沒有定價、方案、免費試用——產品無帳號與付費。
- 沒有績效或準確率統計（且法遵上也不該有）。

## Product Principles

1. **可查證優先於流暢**——推論必須能回到原始來源；寧可少說，也不無據地說。
2. **解釋因果，不下指令**——交付的是「誰牽動誰」的理解，不是買賣建議。這同時是法律鐵線與產品定位。
3. **為不看盤的人寫**——讀者是想懂新聞的人；術語要付出解釋成本才配出現。
4. **每天都得成立**——日更是產品本體。任何設計都必須在資料缺漏、休市、合規 degrade 成 null 的日子仍然可讀、不破版。
5. **外皮可以戲謔，骨子必須中性**——品牌是賽博半仙，判讀是中性數據分析；兩者不可互相污染。

## Accessibility & Inclusion

- 目前**無**正式無障礙標準承諾（未決事項，不要在文件或介面上宣稱任何 WCAG 等級）。
- 已成立的產品性需求：繁中長文閱讀的可讀性是核心體驗，不是次要考量；最窄斷點（419px）以下必須完整可讀。
- 讀者是非專業投資人，術語密度本身就是可及性問題（既有 de-jargon 機制即為此存在）。
