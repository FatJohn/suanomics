import type { MarketBrief } from '@suanomics/shared'

export interface QualitySourceArticle { title: string, text: string }

// 把外部餵入的原始新聞（news-item shape 或 { items: [...] } wrapper）正規化成事實底本。
// 讓 grounding 不必依賴本機 DB —— 可直接吃 prod API 回的 source items / regenerated dump。
// text 優先序：text > contentText > title（fallback）；無 title 的雜項略過。
export function normalizeSourceItems(raw: unknown): QualitySourceArticle[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items))
        ? (raw as { items: unknown[] }).items
        : []
  const out: QualitySourceArticle[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object')
      continue
    const o = it as Record<string, unknown>
    if (typeof o.title !== 'string' || o.title.length === 0)
      continue
    const text = typeof o.text === 'string' && o.text.length > 0
      ? o.text
      : typeof o.contentText === 'string' && o.contentText.length > 0
        ? o.contentText
        : o.title
    out.push({ title: o.title, text })
  }
  return out
}

function briefBlock(brief: MarketBrief): string[] {
  const L: string[] = []
  L.push(`headline：${brief.headline}`)
  L.push(`summary：${brief.summary}`)
  // 本日核心論點（optional：舊 brief / editor fallback 時無 → 略過）
  if (brief.dailyThesis)
    L.push(`本日論點：${brief.dailyThesis}`)
  if (brief.narrative) {
    L.push(`intro：${brief.narrative.intro}`)
    for (const s of brief.narrative.sections)
      L.push(`section（${s.heading}）：${s.body}`)
    L.push(`outro：${brief.narrative.outro}`)
  }
  const chains = brief.cascadeChains ?? []
  if (chains.length > 0) {
    L.push('連動鏈：')
    for (const c of chains) {
      const tier = c.tier !== undefined ? `tier${c.tier}` : 'tier?'
      L.push(`- ${c.industry}｜${c.mechanism}｜${tier}`)
    }
  }
  // 顯性正反觀點（null/undefined = graceful degrade / 舊 brief → 略過）
  const vp = brief.viewpoints
  if (vp) {
    L.push('正反觀點：')
    L.push(`- 支持：${vp.supportPoints.join('；')}`)
    L.push(`- 風險：${vp.riskPoints.join('；')}`)
    L.push(`- 淨讀：${vp.netRead}`)
  }
  L.push('引用：')
  for (const c of brief.citations)
    L.push(`- ${c.url}｜${c.quote}`)
  return L
}

// 組 pairwise judge 的 userContent：[甲]=briefFirst、[乙]=briefSecond + 共用事實底本（原始新聞與市場數據快照）。
export function buildCompareUserContent(briefFirst: MarketBrief, briefSecond: MarketBrief, sources: QualitySourceArticle[]): string {
  const L: string[] = []
  L.push('# [甲]')
  L.push(...briefBlock(briefFirst))
  L.push('')
  L.push('# [乙]')
  L.push(...briefBlock(briefSecond))
  L.push('')
  L.push('# 共用事實底本（原始新聞全文與市場數據快照）')
  for (const a of sources) {
    L.push(`## ${a.title}`)
    L.push(a.text)
  }
  L.push('')
  L.push('請就三維度各判 甲/乙/相當 + 理由、輸出 JSON。')
  return L.join('\n')
}
