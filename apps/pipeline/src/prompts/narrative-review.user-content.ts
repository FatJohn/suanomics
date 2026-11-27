import type { Narrative } from '@suanomics/shared'
import type { NarrativeReviewMaterial, ReviewNote } from '../agents/narrative-review.js'
import { formatClaimLedgerBlock } from '@suanomics/shared'
import { clampString } from '../agents/_truncate.js'
import { relativeDayLabel } from '../agents/relative-time.js'

// 審稿與修訂共用同一份事實底本：撰稿者當時拿到的素材（analyst 的推理不算事實，不放）。
export function formatReviewMaterial(m: NarrativeReviewMaterial): string {
  const { brief } = m
  const lines = ['# 事實底本', `報告日：${m.briefDate}`, '', '## 標題與摘要', `標題：${brief.headline}`, `摘要：${brief.summary}`]
  if (brief.dailyThesis)
    lines.push(`本日論點：${brief.dailyThesis}`)
  if (m.mainThemes && m.mainThemes.length > 0)
    lines.push('當日主軸：', ...m.mainThemes.map(t => `- ${t}`))
  const blocks: [string, string | null | undefined][] = [
    ['收盤時間框架', m.marketCloseFraming],
    ['市場數據', m.marketSnapshot],
  ]
  for (const [heading, block] of blocks) {
    if (block)
      lines.push('', `## ${heading}`, block)
  }
  lines.push('', '## 新聞素材')
  for (const n of m.news) {
    const label = relativeDayLabel(n.publishedAt, m.briefDate)
    lines.push(`- [${n.id}] ${n.title}${label ? `（${label}）` : ''}`, `  摘錄：${clampString(n.text, 500)}`)
  }
  const chains = brief.cascadeChains ?? []
  if (chains.length > 0) {
    lines.push('', '## 連動鏈')
    for (const c of chains)
      lines.push(`- ${c.industry} → ${c.affectedTickers.join(', ')}：${clampString(c.mechanism, 200)}`)
  }
  lines.push('', '## 引用來源')
  for (const c of brief.citations)
    lines.push(`- ${c.url}｜${c.title}｜${clampString(c.quote, 150)}`)
  if (m.claimLedger.length > 0)
    lines.push('', '## 已核對的證據（claim ledger）', formatClaimLedgerBlock(m.claimLedger))
  const tail: [string, string | null | undefined][] = [
    ['行事曆（只可引用列出的事件與日期）', m.calendarBlock],
    ['主管機關公告（只可引用列出的內容）', m.officialBlock],
  ]
  for (const [heading, block] of tail) {
    if (block)
      lines.push('', `## ${heading}`, block)
  }
  return lines.join('\n')
}

function draftBlocks(draft: Narrative): string {
  const lines = [`[開場] ${draft.intro}`]
  draft.sections.forEach((s, i) => {
    lines.push(`[段落${i + 1}「${s.heading}」] ${s.body}${s.takeaway ? `\n重點：${s.takeaway}` : ''}`)
  })
  lines.push(`[收尾] ${draft.outro}`)
  return lines.join('\n')
}

export function formatReviewerUserContent(m: NarrativeReviewMaterial, draft: Narrative): string {
  return [formatReviewMaterial(m), '', '# 待審草稿', draftBlocks(draft), '', '請輸出審稿 JSON。'].join('\n')
}

export function formatReviserUserContent(m: NarrativeReviewMaterial, draft: Narrative, notes: readonly ReviewNote[]): string {
  return [
    formatReviewMaterial(m),
    '',
    '# 審稿意見',
    ...notes.map((n, i) => `${i + 1}. [${n.kind}] 「${n.quote}」：${n.note}`),
    '',
    '# 草稿（JSON）',
    JSON.stringify(draft, null, 2),
    '',
    '請輸出修訂後的完整 narrative JSON。',
  ].join('\n')
}
