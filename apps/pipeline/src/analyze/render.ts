import type { AnalystOutput, CascadeChain } from '../agents/types.js'
import { checkCompliance, stripViolatingProse } from '@suanomics/shared'
import { load } from 'cheerio'
import { rewriteText } from '../agents/narrative-shared.js'
import { COMPLIANCE_STRIPPED_PLACEHOLDER } from '../brief/analyzer.js'

const MAX_TITLE_LENGTH = 80
const DIRECTION_LABEL: Record<CascadeChain['direction'], string> = { positive: '正向', neutral: '中性', negative: '負向' }

// 與日報的 finalizeBriefSafety 同一套做法：先把禁用語改寫成中性說法，改不掉的整句刪掉。
function clean(s: string): string {
  return stripViolatingProse(rewriteText(s, { count: 0 }))
}

function cleanRequired(s: string): string {
  return clean(s) || COMPLIANCE_STRIPPED_PLACEHOLDER
}

export function sanitizeAnalysis(a: AnalystOutput): AnalystOutput {
  return {
    ...a,
    primaryImpact: cleanRequired(a.primaryImpact),
    reasoning: cleanRequired(a.reasoning),
    cascadeChains: a.cascadeChains.map(c => ({
      ...c,
      industry: cleanRequired(c.industry),
      mechanism: cleanRequired(c.mechanism),
      affectedTickers: c.affectedTickers.map(clean).filter(t => t.length > 0),
      citations: c.citations.map(cit => ({ ...cit, title: cleanRequired(cit.title), quote: cleanRequired(cit.quote) })),
    })),
  }
}

/** 終端機顯示時每一行各自是一段，逐行檢查才不會把相鄰兩行的股號與方向詞湊成違規。 */
export function findComplianceViolations(markdown: string): string[] {
  return markdown.split('\n').filter(line => checkCompliance(line) !== null)
}

function clampTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title
}

export function titleFromText(text: string): string {
  return clampTitle(text.split('\n').map(line => line.trim()).find(line => line.length > 0) ?? '')
}

// 正文第一行常是日期或麵包屑（「首頁」「:::」），標題要從頁面 metadata 拿。
export function titleFromHtml(html: string): string | null {
  const $ = load(html)
  const candidates = [$('meta[property="og:title"]').attr('content'), $('title').first().text()]
  const title = candidates.map(c => (c ?? '').replace(/\s+/g, ' ').trim()).find(c => c.length > 0)
  return title === undefined ? null : clampTitle(title)
}

function chainHeading(c: CascadeChain): string {
  const notes = [DIRECTION_LABEL[c.direction]]
  if (c.parentChainId !== undefined)
    notes.push(`承接 ${c.parentChainId}`)
  if (c.speculative === true)
    notes.push('推測')
  return `### ${c.chainId ?? '-'} ${c.industry}（${notes.join('，')}）`
}

function renderChain(c: CascadeChain): string[] {
  const lines = [chainHeading(c), '', c.mechanism, '']
  if (c.affectedTickers.length > 0)
    lines.push(`- 相關標的：${c.affectedTickers.join('、')}`)
  if (c.citations.length === 0)
    lines.push('- 來源：無')
  for (const cit of c.citations)
    lines.push(`- 來源：[${cit.title}](${cit.url})：「${cit.quote}」`)
  lines.push('')
  return lines
}

export interface RenderAnalysisParams {
  title: string
  url?: string
  date: string
  analysis: AnalystOutput
  costUsd: number
  calls: number
}

export function renderAnalysisMarkdown(p: RenderAnalysisParams): string {
  const lines = [
    `# 單篇分析：${p.title}`,
    '',
    `- 來源：${p.url ?? '貼上的文字'}`,
    `- 報告日：${p.date}`,
    '',
    '## 主要影響',
    '',
    p.analysis.primaryImpact,
    '',
    '## 推理',
    '',
    p.analysis.reasoning,
    '',
    '## 連動鏈',
    '',
  ]
  if (p.analysis.cascadeChains.length === 0)
    lines.push('（沒有產出連動鏈）', '')
  for (const c of p.analysis.cascadeChains)
    lines.push(...renderChain(c))
  lines.push('---', '', `單次花費：US$${p.costUsd.toFixed(4)}（${p.calls} 次 LLM 呼叫）`)
  return `${lines.join('\n')}\n`
}
