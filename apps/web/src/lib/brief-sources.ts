import type { MarketBriefCitation, RelatedNews } from '@suanomics/shared'
import type { NewsItem } from '@/stores/brief.js'

/**
 * 佐證層的一筆來源。
 *
 * 為什麼要有這個形狀：同一則新聞在 brief 裡有三種身分——被引用（帶 quote）、被標成與報告
 * 有因果關係（帶 relationType 與理由）、以及當天被監測到（帶發布時間）。2026-08-02 量過
 * 一份真實報告：citations 20 筆、relatedNews 5 筆、當日新聞 7 筆，**後兩者全部已在
 * citations 裡**——三個區塊 32 個條目去重之後只有 20 個東西。分成三塊列的結果是同一則
 * 新聞出現兩三次，讀者無從分辨差別。這裡把三種身分合成一筆的三個欄位。
 */
export interface BriefSource {
  url: string
  title: string
  /** 給讀者看的來源名（去掉 www.）；url 壞掉時退回原字串，不讓一筆壞資料炸掉整份清單 */
  domain: string
  /** 報告直接引用的段落。沒有＝這則只是當天監測到、沒進推論 */
  quote?: string
  /** 報告明述的因果關係 */
  relation?: { type: RelatedNews['relationType'], reasoning: string }
  /** ISO 字串。只有進了當日新聞清單的才有 */
  publishedAt?: string
  /**
   * 站內單則新聞頁（`/brief/news/:id`）的 id。只有進了當日新聞清單的才有——那一頁能看到
   * 這則新聞自己的連動分析，是原始連結給不了的東西，合併清單時不可以把它弄丟。
   */
  newsId?: number
}

function toDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  }
  catch {
    return url
  }
}

/**
 * 合成佐證層的來源清單。
 *
 * 排序：**有明述關係的排前面**（那是報告拿它來推論的證據），其餘保持 citations 的原順序
 * ——那個順序本身就是報告使用來源的順序。監測到但沒被引用的接在最後，靠沒有 quote 這件事
 * 自己說明它的身分。
 */
// 已知限制：合併鍵是 url 原字串，不做正規化。同一則新聞若在 citations 與當日新聞清單裡
// 帶著不同的 query 或結尾斜線，會被當成兩筆——這是保守的一邊（寧可多列一次，也不要把
// 兩個不同頁面誤併成一筆）。實測 2026-07-31 的報告 32→20 完全對上，暫不處理。
export function buildBriefSources(
  citations: MarketBriefCitation[],
  relatedNews: RelatedNews[],
  items: NewsItem[],
): BriefSource[] {
  const byUrl = new Map<string, BriefSource>()

  for (const c of citations) {
    // 同一個 url 重複出現時留第一筆：那是報告最先引用它的說法
    if (byUrl.has(c.url))
      continue
    byUrl.set(c.url, { url: c.url, title: c.title, domain: toDomain(c.url), quote: c.quote })
  }

  for (const r of relatedNews) {
    const existing = byUrl.get(r.url)
    const relation = { type: r.relationType, reasoning: r.reasoning }
    if (existing)
      existing.relation = relation
    else
      byUrl.set(r.url, { url: r.url, title: r.title, domain: toDomain(r.url), relation })
  }

  for (const i of items) {
    const existing = byUrl.get(i.url)
    if (existing) {
      if (i.publishedAt)
        existing.publishedAt = i.publishedAt
      existing.newsId = i.id
      continue
    }
    byUrl.set(i.url, {
      url: i.url,
      title: i.title,
      domain: toDomain(i.url),
      newsId: i.id,
      ...(i.publishedAt ? { publishedAt: i.publishedAt } : {}),
    })
  }

  const all = [...byUrl.values()]
  return [...all.filter(s => s.relation), ...all.filter(s => !s.relation)]
}
