/**
 * 官方公告 block：把金融主管機關的一手公告當作**背景素材**餵給 editor 與 narrative，
 * 而不是丟進選稿池跟新聞競爭。
 *
 * ★ 為什麼不進選稿池（2026-08-28 實測，不是推測）：把官方公告做成候選、與當天真實
 * 候選池一起丟進真正的 `rankAndSelect`，三個日期的結果是 **0/99、0/86、0/77**——
 * 一則都進不了 top-36，連一則既有的都沒擠掉。完整排序中最佳名次 206、中位 4,197
 * （共 5,829 則）。`SOURCE_WEIGHTS` 的上限是 1.1 的溫和 tiebreaker，推不動這個名次。
 *
 * 而這個最佳名次本身說明了問題：**ranker 沒壞，是量尺用錯對象**。它評的是 recency ×
 * storyline 相關性 × 跨新聞連結 × 來源權重，那是為記者寫的新聞敘事設計的。央行的
 * 理監事會決議沒有敘事、沒有記者角度、實體只有「央行／利率」，跨新聞連結天生低。
 * 用新聞的尺量一手公告，低分是正確答案。
 */

import { taipeiDateOf } from '@suanomics/shared'

/**
 * 這個 block 收哪些來源。**排除 `fomc-statements`**：它的 description 逐字等於 title，
 * 塞了沒有資訊——那不是雜訊比的問題，是零資訊。
 *
 * ★ 一度排除過 `ey-press`（理由是政治公關太多），驗收指出那是**不對稱的證據**：
 * 只量了它、沒量留下來的兩個。重量之後（實際資料、2026-08-20 起）ey-press 17 則、
 * 其中至少 3 則是財政題；fsc-news 11 則裡 8 則是「每日新聞」索引；twse 16 則多為
 * 上市審議與宣導活動——雜訊比彼此相當。四個一起收，改用 per-source 上限防洗版。
 */
export const OFFICIAL_BLOCK_SLUGS: readonly string[] = Object.freeze([
  'cbc-press',
  'ey-press',
  'fsc-news',
  'twse-announcements',
])

/** slug → 讀得懂的機關名。prompt 裡印 slug 對 LLM 沒有意義。 */
const AGENCY_LABEL: Record<string, string> = {
  'cbc-press': '央行',
  'fsc-news': '金管會',
  'twse-announcements': '證交所',
  'ey-press': '行政院',
}

export interface OfficialAnnouncement {
  slug: string
  title: string
  summary: string | null
  publishedAt: Date
}

export interface BuildOptions {
  now: Date
  /** 最多列幾則。官方公告合計約 5 則/日，窗一拉長就會吃掉 prompt 預算。 */
  limit?: number
  /**
   * 單一機關最多列幾則。四個機關的發布量差很多（twse 2.2/日、ey 1.9、cbc 0.6、
   * fsc 0.4），只有總數上限的話，發最多的那個會把整個 block 佔滿——而它剛好也是
   * 例行公告最多的那個。
   */
  perSourceLimit?: number
}

const DEFAULT_LIMIT = 10
const DEFAULT_PER_SOURCE_LIMIT = 3
const SUMMARY_MAX = 120

/**
 * 例行索引貼文：有標題、有日期，但內容是「今天有哪些新聞」的清單本身。
 *
 * 目前只認金管會證期局的「每日新聞（日期）」——2026-08-28 抽樣 16 則 fsc-news，
 * 其中 7 則是這個 pattern。**刻意只認這一個 pattern**：用「像不像公關稿」這種
 * 模糊判準去濾，會連真正的政策公告一起濾掉，而那種漏掉是靜默的。
 */
export function isRoutineIndexPost(title: string): boolean {
  return /每日新聞\s*[（(]/.test(title)
}

/**
 * 佔位摘要：整串就是一個全大寫的中括號 token（`[STUB-NO-LLM]`／`[VERIFIER-STUB]`）。
 *
 * 這些是舊跑在本機 dev DB 留下的殘留（2026-08-28 實查：本機 664+40+18 筆、prod 0 筆、
 * 現行 code 也不再產生）。判準刻意窄到只認這個形狀——用「看起來像不像佔位」去猜，
 * 會誤傷 `[央行] 7 月 M2…` 這種真的以中括號開頭的摘要。
 */
function isPlaceholderSummary(s: string): boolean {
  return /^\[[A-Z][A-Z-]*\]$/.test(s)
}

function formatOne(a: OfficialAnnouncement): string {
  // ★ 台北曆日、不是 UTC 曆日。證交所的 published_at 550/550 筆都是 16:00Z
  // （＝台北隔日 00:00），用 toISOString() 會整批差一天。
  const date = taipeiDateOf(a.publishedAt)
  const agency = AGENCY_LABEL[a.slug] ?? a.slug
  const raw = a.summary?.trim()
  const summary = raw && !isPlaceholderSummary(raw) ? raw : undefined
  const tail = summary ? `｜${summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX)}…` : summary}` : ''
  return `- ${date}（${agency}）${a.title}${tail}`
}

/**
 * 回 `null` 而不是空字串：呼叫端據此決定整段（含標頭）要不要放進 prompt。
 * 給一個只有標頭沒有內容的區塊，等於告訴 LLM「今天沒有官方消息」，那是它編不出來、
 * 卻會拿去用的一句話。
 */
export function buildOfficialAnnouncementsBlock(
  items: readonly OfficialAnnouncement[],
  opts: BuildOptions,
): string | null {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const perSource = opts.perSourceLimit ?? DEFAULT_PER_SOURCE_LIMIT
  const seen = new Map<string, number>()
  const usable = items
    .filter(a => OFFICIAL_BLOCK_SLUGS.includes(a.slug) && !isRoutineIndexPost(a.title))
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    // per-source 上限先於總數上限：反過來的話，發布量大的來源會先把 limit 吃光，
    // per-source 就永遠不會生效。
    .filter((a) => {
      const n = seen.get(a.slug) ?? 0
      if (n >= perSource)
        return false
      seen.set(a.slug, n + 1)
      return true
    })
    .slice(0, limit)
  if (usable.length === 0)
    return null
  return usable.map(formatOne).join('\n')
}
