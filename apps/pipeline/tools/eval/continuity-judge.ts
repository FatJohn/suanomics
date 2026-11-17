import type { ContinuityJudgeInput } from './continuity-judge.prompt.js'
import type { JudgeCall } from './judge-call.js'
import { z } from 'zod'
import { containsQuote, readerBlocks, renderBlocks } from './brief-text.js'
import { buildContinuityUserContent, CONTINUITY_JUDGE_SYSTEM_PROMPT, touchedStorylineIds } from './continuity-judge.prompt.js'

// 長度與數量不設限，理由同 response-schemas.ts。
export const ContinuityJudgeResponse = z.object({
  storylines: z.array(z.object({ id: z.number().int(), quote: z.string(), verdict: z.enum(['delta', 'restated', 'absent']), note: z.string() })),
  carryOver: z.array(z.object({ item: z.string(), quote: z.string(), verdict: z.enum(['addressed', 'not_addressed', 'not_due']) })),
  falseContinuity: z.array(z.object({ quote: z.string(), note: z.string() })),
  restatements: z.array(z.object({ todayQuote: z.string(), priorQuote: z.string() })),
})
export type ContinuityJudgeOutput = z.infer<typeof ContinuityJudgeResponse>

export interface ContinuityScore {
  /** 今日有進展的敘事線數。 */
  touched: number
  delta: number
  restated: number
  absent: number
  missingStorylines: number[]
  /** 引文逐字出自昨日報告的待觀察項數。 */
  carryOverItems: number
  addressed: number
  notAddressed: number
  notDue: number
  falseContinuity: number
  restatements: number
  /** 引文對不上原文而不計分的筆數，四個檢查合計。 */
  unverified: number
}

function scoreStorylines(output: ContinuityJudgeOutput, input: ContinuityJudgeInput, todayText: string) {
  const touched = touchedStorylineIds(input)
  const byId = new Map(output.storylines.map(s => [s.id, s]))
  const counts = { delta: 0, restated: 0, absent: 0, unverified: 0 }
  const missingStorylines: number[] = []
  for (const id of touched) {
    const judged = byId.get(id)
    if (!judged)
      missingStorylines.push(id)
    else if (judged.verdict === 'absent')
      counts.absent++
    else if (containsQuote(todayText, judged.quote))
      counts[judged.verdict]++
    else
      counts.unverified++
  }
  return { touched: touched.length, missingStorylines, ...counts }
}

function scoreCarryOver(output: ContinuityJudgeOutput, yesterdayText: string, todayText: string) {
  const counts = { carryOverItems: 0, addressed: 0, notAddressed: 0, notDue: 0, unverified: 0 }
  for (const c of output.carryOver) {
    const itemOk = containsQuote(yesterdayText, c.item)
    if (!itemOk || (c.verdict === 'addressed' && !containsQuote(todayText, c.quote))) {
      counts.unverified++
      if (itemOk)
        counts.carryOverItems++
      continue
    }
    counts.carryOverItems++
    if (c.verdict === 'addressed')
      counts.addressed++
    else if (c.verdict === 'not_due')
      counts.notDue++
    else
      counts.notAddressed++
  }
  return counts
}

export function scoreContinuity(output: ContinuityJudgeOutput, input: ContinuityJudgeInput): ContinuityScore {
  const todayText = renderBlocks(readerBlocks(input.brief))
  const priorTexts = input.priors.map(p => renderBlocks(readerBlocks(p.brief, { withAnalysis: false })))
  const yesterdayText = priorTexts.at(-1) ?? ''
  const storylines = scoreStorylines(output, input, todayText)
  const carryOver = scoreCarryOver(output, yesterdayText, todayText)
  const falseOk = output.falseContinuity.filter(f => containsQuote(todayText, f.quote)).length
  const restateOk = output.restatements.filter(r => containsQuote(todayText, r.todayQuote) && priorTexts.some(t => containsQuote(t, r.priorQuote))).length
  return {
    touched: storylines.touched,
    delta: storylines.delta,
    restated: storylines.restated,
    absent: storylines.absent,
    missingStorylines: storylines.missingStorylines,
    carryOverItems: carryOver.carryOverItems,
    addressed: carryOver.addressed,
    notAddressed: carryOver.notAddressed,
    notDue: carryOver.notDue,
    falseContinuity: falseOk,
    restatements: restateOk,
    unverified: storylines.unverified + carryOver.unverified
      + (output.falseContinuity.length - falseOk) + (output.restatements.length - restateOk),
  }
}

export interface ContinuityJudgeResult { output: ContinuityJudgeOutput, score: ContinuityScore }

export async function runContinuityJudge(input: ContinuityJudgeInput, call: JudgeCall): Promise<ContinuityJudgeResult> {
  const output = await call('brief-continuity-judge', {
    systemPrompt: CONTINUITY_JUDGE_SYSTEM_PROMPT,
    userContent: buildContinuityUserContent(input),
  }, ContinuityJudgeResponse)
  return { output, score: scoreContinuity(output, input) }
}
