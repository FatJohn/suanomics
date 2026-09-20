import type { DeepPipelinePromptVars } from '../../pipeline/prompt-vars.js'
import type { Logger } from './logger.js'
import type { EpisodeL3 } from './schemas.js'
import process from 'node:process'
import { GoogleGenAI } from '@google/genai'
import { containsForbiddenPhrase, containsTickerDirection } from '@suanomics/shared'
import { buildConsolidatorSystemPrompt } from './prompts.js'

// ★ Gemini 專屬、換 provider 換不掉——理由見 `../../gemini-client.ts` 檔頭 JSDoc（依賴
// 方向約束：packages/prompt-research 不能 import apps/server 的 providers/）。

// GEMINI_CONSOLIDATOR_MODEL 是這一段的細粒度覆寫、TRANSCRIPT_TOOL_MODEL 是整個工具的預設；
// 兩者都不吃 Cascade 的全域變數（見 segmenter.ts 的說明）
const MODEL = process.env.GEMINI_CONSOLIDATOR_MODEL ?? process.env.TRANSCRIPT_TOOL_MODEL ?? 'gemini-3-flash-preview'
const TIMEOUT_MS = 120_000
// 3 = initial + 2 retries
const MAX_ATTEMPTS = 3

function createClient(apiKey: string) {
  const GenAI = GoogleGenAI as unknown as {
    new (opts: { apiKey: string }): InstanceType<typeof GoogleGenAI>
    (opts: { apiKey: string }): InstanceType<typeof GoogleGenAI>
  }

  try {
    return new GenAI({ apiKey })
  }
  catch (err) {
    if (err instanceof TypeError && err.message.includes('is not a constructor'))
      return GenAI({ apiKey })
    throw err
  }
}

async function callGeminiOnce(input: string, vars: DeepPipelinePromptVars): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey)
    throw new Error('GEMINI_API_KEY not set')

  const ai = createClient(apiKey)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)

  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: input,
      config: {
        systemInstruction: buildConsolidatorSystemPrompt(vars),
        abortSignal: ctl.signal,
      },
    })
    const text = res.text
    if (!text)
      throw new Error('empty response')
    return text
  }
  finally {
    clearTimeout(timer)
  }
}

function scan(text: string): string | null {
  const forbidden = containsForbiddenPhrase(text)
  if (forbidden.hit)
    return `forbidden:${forbidden.phrase ?? 'unknown'}`

  const tickerDirection = containsTickerDirection(text)
  if (tickerDirection.hit)
    return `ticker_direction:${tickerDirection.ticker ?? tickerDirection.company ?? 'unknown'}+${tickerDirection.verb ?? 'unknown'}`

  return null
}

export async function runConsolidator(
  episodes: readonly EpisodeL3[],
  runId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<string> {
  const input = JSON.stringify({ runId, episodes }, null, 2)
  let lastErr: unknown = new Error('consolidator failed after retries')

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const supplement = await callGeminiOnce(input, vars)
      const violation = scan(supplement)
      if (violation)
        throw new Error(`compliance:${violation}`)

      logger.emit('consolidator.done', { runId, chars: supplement.length })
      return supplement
    }
    catch (err) {
      lastErr = err
      if (err instanceof Error && (err.message.startsWith('compliance:') || err.message === 'empty response')) {
        logger.emit('retry', {
          stage: 'consolidator',
          runId,
          attempt: attempt + 1,
          reason: err.message,
        }, 'warn')
        continue
      }
      throw err
    }
  }

  throw lastErr
}
