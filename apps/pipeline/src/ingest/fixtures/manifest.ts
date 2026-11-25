// 樣本的出處紀錄。
//
// 沒有出處的樣本，跟自造形狀在檔案上分不出來——這是本 repo 的 firecrawl 事故最貴的那一課：
// 那個 mock 的形狀真實 API 從來不會回（讀 `markdown`，而 v1 /search 回的是 `description`），
// 測試從第一天就是綠的，驗的是「實作與 mock 之間的一致性」，不是「實作與真實 API 之間」。
//
// 2026-08-22 建立這份紀錄時盤點 `apps/server` 底下既有的 9 份樣本（repo 其他地方另有
// `packages/prompt-research` 的幾個 __fixtures__ 目錄），發現**其中三份
// 根本不是抓下來的**
// （內容是「Sample Feed」「新聞1／新聞2」「鉅亨新聞一／二／三」這種手寫佔位資料）。
// 它們與另外五個看起來像真實擷取的樣本躺在同一個 `__fixtures__` 目錄裡，檔名同樣叫
// `-sample`，讀的人無從分辨。**那正是這份 manifest 要解決的問題**——不是補文件，是補
// 一個「這份東西的形狀有沒有現實依據」的答案。

export type FixtureKind
  /** JSON：`fixtures:check` 可以自動比形狀 */
  = | 'json'
  /** 非 JSON（HTML／XML）或非 GET：只能人工重抓，check 會標明跳過而不是靜靜略過 */
    | 'opaque'

export type FixtureOrigin
  /** 真的從 `url` 抓下來的回應。形狀有現實依據。 */
  = | 'captured'
  /**
   * 手寫的佔位資料。形狀是**人推測**外部 API 長什麼樣——firecrawl 事故就是這一類。
   * 標成 synthetic 不代表它壞了（很多解析器測試只需要一個結構範例），而是說
   * **它證明不了任何關於真實 API 的事**。若同時填了 `url`，`fixtures:check` 會拿它
   * 跟現實對照——那正是當初能擋下 firecrawl 的那個檢查。
   */
    | 'synthetic'
  /**
   * 出處無紀錄。內容看起來像真的也算這一類——「看起來像」不是證據。
   *
   * ★ **跑過 `fixtures:check` 對得上，不足以升格成 `captured`。** 那證明的是**形狀**有現實
   *   依據，不是「這份檔案當初真的抓自那裡」——一份手寫但形狀猜對的樣本會通過同樣的檢查。
   *   形狀驗證的結果記在獨立的 `shapeVerifiedAt`，那是這兩件事刻意分成兩個欄位的理由。
   *   要改標 `captured` 只有一條路：**重新抓一次、並填上那次的 `capturedAt`**。
   */
    | 'unverified'

export interface FixtureProvenance {
  /** 檔名，相對於 manifest 所在目錄 */
  file: string
  kind: FixtureKind
  origin: FixtureOrigin
  /**
   * 這份樣本對應哪個真實 URL。`null` 代表它是通用結構範例、沒有對應的單一來源。
   * 有值時 `fixtures:check` 會重打它比形狀——**synthetic 的樣本填了 URL 特別有價值**，
   * 那一比就是在問「這個人推測出來的形狀，真實 API 到底回不回」。
   */
  url: string | null
  /** origin='captured' 才有意義。 */
  capturedAt?: string
  /** 最後一次 `fixtures:check` 形狀對得上的日期。人工填，不由工具寫回。 */
  shapeVerifiedAt?: string
  /** 抓取後做過什麼。原樣存就寫 'as-is'。截斷過的樣本不能拿來推論筆數。 */
  transform: string
  note?: string
}

export interface FixtureManifest {
  /** manifest 檔自己的 import.meta.url，用來解析同目錄的樣本檔 */
  baseUrl: string
  /** 這批樣本屬於哪個 client，報告用 */
  label: string
  entries: readonly FixtureProvenance[]
}
