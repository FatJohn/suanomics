import { classifyPublicationDay, taipeiDateOf } from '@suanomics/shared'

/**
 * 重大官方公告的「保留席」判定。
 *
 * **要解的問題**：官方公告的內文品質是全 corpus 最好的一批，但它們永遠當不了主題——
 * 2026-08-28 實測把它們做成候選丟進真正的 `rankAndSelect`，三個日期都是 0/99、0/86、
 * 0/77，完整排序中最佳名次 206、中位 4,197。`SOURCE_WEIGHTS` 上限 1.1 的溫和
 * tiebreaker 推不動這個名次。所以央行升息那天，那則決議也不會是頭條。
 *
 * **為什麼是保留席而不是置頂**：置頂等於把當天頭條的決定權整個交給這份 pattern 清單，
 * 一旦誤判就直接毀掉那天的報告；保留席最多浪費一格，其餘格的相對順序完全不受影響
 * （評分器一行都沒動）。
 *
 * **★ 為什麼吃的是選稿候選、而不是 `external_articles`**：第一版讓公告帶負數 id 直接插
 * 進選稿結果，獨立複查抓到兩個**實際回歸**——(1) `enqueue('analyze')` 的
 * payload 撞 `AnalyzePayloadSchema` 的 `.positive()`，被 catch 吞成 warn，頭條那則永遠
 * 沒有預跑分析；(2) `saveDailyBrief` 把負數寫進 `selected_news_ids`，而 API 用
 * `inArray` 查 `news_items`，那則靜默消失、讀者面「N 則新聞」少一則。所以 `cbc-press`
 * 改成也進 `news_sources`（見 `packages/db/src/seed.ts`），公告因此有真的 id，
 * 本檔只負責「從候選池裡挑出哪一則該佔保留席」。
 *
 * **為什麼只認央行**：`news_items` 裡 `cbc-press` 共 500 則（2024-11～2026-08，一次
 * refresh 抓回整個 feed），本檔的 pattern 命中 **35 則**，逐則讀過全部是真的宏觀事件
 * （其中非理監事類 7 則：主權評等 ×3、金融穩定報告 ×2、貨幣政策架構檢視、協處措施）。
 * ★ 同一批資料在 `external_articles` 是 504 則——**兩張表的母體不同**，引數字時要說清楚
 * 是哪一張；判準作用在候選池上，所以以 `news_items` 的 500／35 為準。證交所那組試過同等級的 pattern（停止買賣／終止上市／變更交易
 * 方法／處置／重大訊息），550 則命中 48 則，讀下來幾乎全是個股行政處分——「對某公司違反
 * 重大訊息規定處以新台幣 3 萬元違約金」這種，對總經日報不重大。金管會樣本只有 21 筆
 * （2026-08-12 才開始抓）不足以訂判準，行政院是政治公關為主。
 *
 * 設計哲學同 `official-announcements.ts` 的 `isRoutineIndexPost`：**判準刻意窄，寧可漏
 * 也不要誤傷**——漏掉一則重大公告只是回到今天的狀態，誤傷一則卻會佔掉頭條。
 */

/** 只有央行。其餘三個機關的實測見檔頭。 */
const MAJOR_ANNOUNCEMENT_SLUG = 'cbc-press'

/** 保留席格數。一天不會有兩個宏觀重大事件，多給只是排擠新聞。 */
export const DEFAULT_MAJOR_QUOTA = 1

/**
 * 命中 pattern 卻不是事件的形狀。兩類，都有真實樣本撐著（`news_items` 的 500 則逐則讀過）：
 *
 * 1. **明年的開會日程**（「115年中央銀行理監事聯席會議預定日期」，2 則）——會讓那天的
 *    頭條變成「明年的開會日期」。
 * 2. **澄清稿／闢謠稿**（「網路社群流傳誤導民眾有關本行信用管制方向之影片，特此公告
 *    澄清」「近日媒體報導本行信用管制政策轉向…查與事實不符」「有關某不動產業者反映…
 *    特此說明」）——央行回應外界說法，不是政策動作。這類在信用管制與匯率這兩個題材上
 *    特別多：擴 tier 2 收「協處措施／信用管制」時一口氣多帶進 17 則，其中約三分之一
 *    是這種。**收它們等於讓闢謠稿當頭條。**
 *
 * ★ 「之說明」這條會一併濾掉「本行對『美國財政部匯率政策報告』之說明」——那是對外部
 *   報告的正式回應，屬邊際案例。**刻意讓它落榜**：判準窄的代價是漏，而漏掉只是回到
 *   今天的狀態；誤傷卻會佔掉頭條。要收它得先想出一條能把它與闢謠稿分開的 pattern。
 */
const EXCLUDED = /理監事聯席會議預定日期|之說明|特此說明|特此公告澄清|與事實不符|相關性$/

/**
 * 優先序（數字小者優先）。同一天多則時只留最高的那一則——理監事會當天會同時發決議
 * 新聞稿、記者會簡報與參考資料（2026-06-18 就是一天 3 則），後兩者是附件。
 */
const TIERS: readonly { rank: number, pattern: RegExp }[] = Object.freeze([
  // 決議本身，以及未來真的升降息時的標題形狀（歷史命中為零，留著防未來——要解的
  // 正是「央行升息那天要能當頭條」）
  { rank: 0, pattern: /理監事聯席會議決議|調[升降](?:政策利率|重貼現率|存款準備率)/ },
  // 理監事會的其他產物：會後記者會資料、事後六週公布的議事錄摘要
  { rank: 1, pattern: /理監事/ },
  // 各自獨立的重大事件。`協處措施`（不動產信用管制的鬆緊調整）是獨立複查
  // 指出的漏抓——「本行調整實質換屋自住者之協處措施內容」是真的政策動作。
  // ★ 同一輪驗收也點名「新台幣匯率維持動態穩定」與「本行對『美國財政部匯率政策報告』
  //   之說明」，那兩則**刻意不收**：把 `匯率`／`信用管制` 開進 pattern 會一起帶進 17 則，
  //   其中多是澄清稿與闢謠稿（見 EXCLUDED 的說明）。寧可漏這兩則。
  { rank: 2, pattern: /金融穩定報告|主權(?:信用)?評等|貨幣政策|協處措施/ },
])

function tierOf(title: string): number | null {
  if (EXCLUDED.test(title))
    return null
  for (const t of TIERS) {
    if (t.pattern.test(title))
      return t.rank
  }
  return null
}

export function isMajorAnnouncement(title: string): boolean {
  return tierOf(title) !== null
}

/**
 * 窗的下界：**上一個會出報告的台北曆日**。
 *
 * ★ 不能用固定天數。這些公告的發布時間實測落在台北 11:56～18:12（多數 16:20 之後），
 * 而日報若排在台北 05:10 觸發——D 日下午發的公告，最早要 D+1 的報告才吃得到。若窗寫死
 * 「報告日與前一日」，**週五發布的就永遠漏掉**：週六 skip，而週日的窗只到週六。
 * 歷史裡就有這種——2026-05-29 的第 20 期金融穩定報告是週五發的。
 *
 * 改用「上一個報告日」之後，週日的窗是 [週五, 週日]，接得上。
 *
 * ★ **這個窗與候選池的窗不同軸，是刻意的**：`getRelevanceCandidates` 用 `fetched_at`
 *   算 14 天窗，本檔用 `published_at`。後果在 `cbc-press` 首次上線那天最明顯——一次
 *   抓進 500 則、`fetched_at` 全是當天，其中 35 則命中判準、`published_at` 橫跨兩年。
 *   保留席只看 `published_at` 落不落在窗內，所以那 35 則舊公告一則都不會被選（2026-08-28
 *   實測：命中 35、落在窗 [08-27, 08-28] 內 0）。它們仍會在候選池裡待滿 14 天，但
 *   `recencyDecay` 吃的是 `published_at`，分數趨近零、排不進 top-36。
 */
export function previousReportDate(reportDate: string): string {
  const start = new Date(`${reportDate}T00:00:00+08:00`).getTime()
  for (let i = 1; i <= 7; i++) {
    const day = taipeiDateOf(new Date(start - i * 864e5))
    if (classifyPublicationDay(day).kind !== 'skip')
      return day
  }
  // 一週內必有報告日（`classifyPublicationDay` 只 skip 週六與假日），這裡到不了；
  // 真到了就退回前一天，寧可窗窄也不要拋例外讓選稿整條倒。
  return taipeiDateOf(new Date(start - 864e5))
}

/** 本檔只需要這三個欄位；泛型讓呼叫端拿回完整的候選物件。 */
export interface MajorAnnouncementCandidate {
  title: string
  sourceSlug: string
  publishedAt: Date | null
}

/**
 * 從選稿候選池裡挑出該佔保留席的公告（最多 `limit` 則，**已排序**）。
 * 空陣列代表今天沒有重大公告，呼叫端據此完全不動用保留席（`TOP_K` 一格都不讓）。
 */
export function selectMajorAnnouncements<T extends MajorAnnouncementCandidate>(
  candidates: readonly T[],
  opts: { reportDate: string, limit?: number },
): T[] {
  const limit = opts.limit ?? DEFAULT_MAJOR_QUOTA
  if (limit <= 0)
    return []
  const lower = previousReportDate(opts.reportDate)

  // 每個台北曆日只留 tier 最高的一則；同 tier 取較新的
  const bestPerDay = new Map<string, { row: T, tier: number, at: number }>()
  for (const row of candidates) {
    if (row.sourceSlug !== MAJOR_ANNOUNCEMENT_SLUG)
      continue
    // 沒有發布時間就沒有時間錨點，無法判定它屬於哪一天的報告——不收。
    if (row.publishedAt === null)
      continue
    const day = taipeiDateOf(row.publishedAt)
    // ISO 日期可直接字串比較。窗是閉區間 [上一個報告日, 報告日]。
    if (day < lower || day > opts.reportDate)
      continue
    const tier = tierOf(row.title)
    if (tier === null)
      continue
    const at = row.publishedAt.getTime()
    const cur = bestPerDay.get(day)
    if (!cur || tier < cur.tier || (tier === cur.tier && at > cur.at))
      bestPerDay.set(day, { row, tier, at })
  }

  return [...bestPerDay.values()]
    .sort((a, b) => a.tier - b.tier || b.at - a.at)
    .slice(0, limit)
    .map(x => x.row)
}
