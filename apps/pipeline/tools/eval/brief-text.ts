import type { MarketBrief } from '@suanomics/shared'

export interface ReaderBlock { label: string, text: string }

// judge 只看讀者看得到的文字；cascadeChains、claimLedger 是中間產物，評它們等於評 pipeline 內部。
// withAnalysis=false 拿掉 viewpoints 與推理鏈：前幾日報告只當連續性的參照，敘事欄位就夠。
export function readerBlocks(brief: MarketBrief, opts: { withAnalysis?: boolean } = {}): ReaderBlock[] {
  const withAnalysis = opts.withAnalysis ?? true
  const blocks: ReaderBlock[] = [{ label: '標題', text: brief.headline }]
  if (brief.dailyThesis)
    blocks.push({ label: '本日論點', text: brief.dailyThesis })
  blocks.push({ label: '摘要', text: brief.summary })
  if (brief.narrative) {
    blocks.push({ label: '開場', text: brief.narrative.intro })
    brief.narrative.sections.forEach((s, i) => {
      const takeaway = s.takeaway ? `\n重點：${s.takeaway}` : ''
      blocks.push({ label: `段落${i + 1}「${s.heading}」`, text: `${s.body}${takeaway}` })
    })
    blocks.push({ label: '收尾', text: brief.narrative.outro })
  }
  if (!withAnalysis)
    return blocks
  if (brief.viewpoints) {
    blocks.push({ label: '支持論點', text: brief.viewpoints.supportPoints.join('\n') })
    blocks.push({ label: '風險論點', text: brief.viewpoints.riskPoints.join('\n') })
    blocks.push({ label: '綜合淨讀', text: brief.viewpoints.netRead })
  }
  blocks.push({ label: '推理鏈', text: brief.reasoningChain.join('\n') })
  return blocks
}

export function renderBlocks(blocks: readonly ReaderBlock[]): string {
  return blocks.map(b => `[${b.label}] ${b.text}`).join('\n')
}

// judge 抄引文時常把全形改半形、多塞空白；比對前兩邊都正規化，數字本身仍要完全一致。
export function normalizeQuote(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '')
}

export function containsQuote(text: string, quote: string): boolean {
  const q = normalizeQuote(quote)
  return q.length > 0 && normalizeQuote(text).includes(q)
}
