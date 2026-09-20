import type { BuildAgentPromptParams } from './decomposer-prompt.js'
import { collectFramesFromDraft } from './collect.js'

export function buildAnalystPrompt(p: BuildAgentPromptParams): string {
  const frames = collectFramesFromDraft(p.draft)
  const lines: string[] = []
  lines.push(p.sharedPreamble)
  lines.push('')
  lines.push('## 你的角色：Analyst')
  lines.push('')
  lines.push('收到 1 篇主新聞 + Retriever 給的相關文章、職責：')
  lines.push('1. 寫 primaryImpact（200 字內）')
  lines.push('2. 對每條 cascadeHypothesis 寫一條 cascadeChain：')
  lines.push('   - affectedTickers (純列名、不寫方向)')
  lines.push('   - direction: positive / neutral / negative (sector 層級)')
  lines.push('   - citations: 1–5 條 (從 retrieve 給你的 url 挑、quote ≤ 200 字)')
  lines.push('')
  if (frames.length > 0) {
    lines.push('## 分析框架')
    for (const f of frames) {
      lines.push('')
      lines.push(`### [from: ${f.sourceSlug}] ${f.name}`)
      lines.push(`description: ${f.description}`)
      if (f.questions.length > 0) {
        lines.push('questions:')
        for (const q of f.questions) lines.push(`  - ${q}`)
      }
    }
    lines.push('')
  }
  lines.push('輸出 JSON、shape 對齊 AnalystOutputSchema。')
  return lines.join('\n')
}
