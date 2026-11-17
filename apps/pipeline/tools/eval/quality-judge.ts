import type { MarketBrief } from '@suanomics/shared'
import type { JudgeCall } from './judge-call.js'
import type { QualityJudgeInput } from './quality-judge.prompt.js'
import { z } from 'zod'
import { containsQuote, normalizeQuote, readerBlocks, renderBlocks } from './brief-text.js'
import { buildQualityUserContent, QUALITY_JUDGE_SYSTEM_PROMPT } from './quality-judge.prompt.js'

// evidence 放在 verdict 前面：先抄證據再下判定。長度與數量不設限，理由同 response-schemas.ts。
const CheckSchema = z.object({ evidence: z.string(), verdict: z.enum(['pass', 'fail']) })
type Check = z.infer<typeof CheckSchema>

export const QualityJudgeResponse = z.object({
  sections: z.array(z.object({ heading: z.string(), chain: CheckSchema, mechanism: CheckSchema })),
  unsupported: z.array(z.object({ quote: z.string(), kind: z.enum(['number', 'event']), note: z.string() })),
  boilerplate: z.array(z.object({ phrase: z.string() })),
  falsifier: CheckSchema,
})
export type QualityJudgeOutput = z.infer<typeof QualityJudgeResponse>

export interface QualityScore {
  sections: number
  chainPass: number
  mechanismPass: number
  /** judge 判 pass 但證據不是報告原文的次數；這些不算通過。 */
  unverifiedPasses: number
  missingSections: string[]
  unsupportedNumbers: number
  unsupportedEvents: number
  /** judge 列為無依據、但引文在報告裡找不到的筆數（不計入上面兩項）。 */
  unmatchedQuotes: number
  boilerplate: { phrase: string, blocks: number }[]
  falsifier: 'pass' | 'fail' | 'pass-unverified'
}

const BOILERPLATE_MIN_BLOCKS = 3

function verified(check: Check, text: string): boolean {
  return check.verdict === 'pass' && containsQuote(text, check.evidence)
}

function scoreSections(output: QualityJudgeOutput, brief: MarketBrief, text: string) {
  const headings = brief.narrative?.sections.map(s => s.heading) ?? []
  const byHeading = new Map(output.sections.map(s => [s.heading.trim(), s]))
  let chainPass = 0
  let mechanismPass = 0
  let unverifiedPasses = 0
  const missingSections: string[] = []
  for (const heading of headings) {
    const judged = byHeading.get(heading.trim())
    if (!judged) {
      missingSections.push(heading)
      continue
    }
    for (const check of [judged.chain, judged.mechanism]) {
      if (check.verdict === 'pass' && !verified(check, text))
        unverifiedPasses++
    }
    chainPass += verified(judged.chain, text) ? 1 : 0
    mechanismPass += verified(judged.mechanism, text) ? 1 : 0
  }
  return { sections: headings.length, chainPass, mechanismPass, unverifiedPasses, missingSections }
}

function scoreUnsupported(output: QualityJudgeOutput, text: string) {
  const seen = new Set<string>()
  let unsupportedNumbers = 0
  let unsupportedEvents = 0
  let unmatchedQuotes = 0
  for (const item of output.unsupported) {
    if (!containsQuote(text, item.quote)) {
      unmatchedQuotes++
      continue
    }
    const key = normalizeQuote(item.quote)
    if (seen.has(key))
      continue
    seen.add(key)
    if (item.kind === 'number')
      unsupportedNumbers++
    else
      unsupportedEvents++
  }
  return { unsupportedNumbers, unsupportedEvents, unmatchedQuotes }
}

// 套話是否成立用機械計數判：judge 只負責挑候選片語，出現在幾個區塊由程式數。
function scoreBoilerplate(output: QualityJudgeOutput, brief: MarketBrief) {
  const blocks = readerBlocks(brief)
  return output.boilerplate
    .map(b => ({ phrase: b.phrase, blocks: blocks.filter(block => containsQuote(block.text, b.phrase)).length }))
    .filter(b => b.blocks >= BOILERPLATE_MIN_BLOCKS)
}

export function scoreQuality(output: QualityJudgeOutput, brief: MarketBrief): QualityScore {
  const text = renderBlocks(readerBlocks(brief))
  const falsifier = output.falsifier.verdict === 'fail'
    ? 'fail'
    : verified(output.falsifier, text) ? 'pass' : 'pass-unverified'
  return {
    ...scoreSections(output, brief, text),
    ...scoreUnsupported(output, text),
    boilerplate: scoreBoilerplate(output, brief),
    falsifier,
  }
}

export interface QualityJudgeResult { output: QualityJudgeOutput, score: QualityScore }

export async function runQualityJudge(input: QualityJudgeInput, call: JudgeCall): Promise<QualityJudgeResult> {
  const output = await call('brief-quality-judge', {
    systemPrompt: QUALITY_JUDGE_SYSTEM_PROMPT,
    userContent: buildQualityUserContent(input),
  }, QualityJudgeResponse)
  return { output, score: scoreQuality(output, input.brief) }
}
