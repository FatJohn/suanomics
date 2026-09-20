import type { ZodType } from 'zod'
import type { DeepPipelinePromptVars } from '../../pipeline/prompt-vars.js'
import type { Logger } from './logger.js'
import type { LensName } from './prompts.js'
import type { AnalystFramesLens, CitedSourcesLens, EntitiesLens, EventsLens, ImpactsLens, ReasoningChainsLens } from './schemas.js'
import process from 'node:process'
import { GoogleGenAI } from '@google/genai'
import { ZodError } from 'zod'
import { pMap } from '../dispatch-helpers.js'
import { extractJson } from './gemini-json.js'
import { buildLensExtractorSystemPrompt } from './prompts.js'
import { LENS_RESPONSE_SCHEMAS } from './response-schemas.js'
import {

  AnalystFramesLensSchema,

  CitedSourcesLensSchema,

  EntitiesLensSchema,

  EventsLensSchema,

  ImpactsLensSchema,

  ReasoningChainsLensSchema,
} from './schemas.js'

// ★ Gemini 專屬、換 provider 換不掉——理由見 `../../gemini-client.ts` 檔頭 JSDoc（依賴
// 方向約束：packages/prompt-research 不能 import apps/server 的 providers/）。

// Transcript Tool 專屬 env（見 segmenter.ts 的說明）
const MODEL = process.env.TRANSCRIPT_TOOL_MODEL ?? 'gemini-3-flash-preview'
const TIMEOUT_MS = 90_000
const MAX_ATTEMPTS = 2

export interface LensOutputMap {
  events: EventsLens
  cited_sources: CitedSourcesLens
  entities: EntitiesLens
  reasoning_chains: ReasoningChainsLens
  impacts: ImpactsLens
  analyst_frames: AnalystFramesLens
}

export type AllLensesOutput = { [K in LensName]: LensOutputMap[K] }

type LensSchemaMap = { [K in LensName]: ZodType<LensOutputMap[K]> }

const LENS_ORDER = [
  'events',
  'cited_sources',
  'entities',
  'reasoning_chains',
  'impacts',
  'analyst_frames',
] as const satisfies readonly LensName[]

const LENS_SCHEMAS: LensSchemaMap = {
  events: EventsLensSchema,
  cited_sources: CitedSourcesLensSchema,
  entities: EntitiesLensSchema,
  reasoning_chains: ReasoningChainsLensSchema,
  impacts: ImpactsLensSchema,
  analyst_frames: AnalystFramesLensSchema,
}

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

async function callGeminiOnce(
  lens: LensName,
  contents: string,
  vars: DeepPipelinePromptVars,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey)
    throw new Error('GEMINI_API_KEY not set')

  const ai = createClient(apiKey)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)

  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: buildLensExtractorSystemPrompt(lens, vars),
        responseMimeType: 'application/json',
        responseSchema: LENS_RESPONSE_SCHEMAS[lens],
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

// 合規檢查只在 consolidator 輸出層做（Layer 4）。
// Lens 層只要結構正確（Zod schema pass）即可、允許包含 KOL 原話中的字眼、
// consolidator 再負責改寫成合規中性敘述。
function retryReason(err: Error | SyntaxError | ZodError): string {
  if (err instanceof ZodError)
    return 'schema'
  if (err instanceof SyntaxError)
    return 'json_parse'
  if (err.message === 'empty response')
    return 'empty_response'
  return 'retryable_error'
}

export async function runLens<T extends LensName>(
  lens: T,
  transcript: string,
  episodeId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<LensOutputMap[T]> {
  let lastErr: unknown = new Error(`lens ${lens} failed after retries`)
  let lastRawText = ''

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const rawApiText = await callGeminiOnce(lens, `episodeId: ${episodeId}\n\n---\n\n${transcript}`, vars)
      lastRawText = rawApiText
      const raw = extractJson(rawApiText)
      const parsed = LENS_SCHEMAS[lens].parse(raw) as LensOutputMap[T]

      logger.emit('lens.done', { episode: episodeId, lens })
      return parsed
    }
    catch (err) {
      lastErr = err
      if (
        err instanceof ZodError
        || err instanceof SyntaxError
        || (err instanceof Error && err.message === 'empty response')
      ) {
        logger.emit('retry', {
          episode: episodeId,
          stage: `lens:${lens}`,
          attempt: attempt + 1,
          reason: retryReason(err),
          raw_preview: lastRawText.slice(0, 300),
          raw_length: lastRawText.length,
        }, 'warn')
        continue
      }
      throw err
    }
  }

  throw lastErr
}

/**
 * 6 個 lens 同時最多打幾個 Gemini 請求。與 deep-pipeline.ts 的 EPISODE_CONCURRENCY（=3）
 * 相乘就是這支腳本的尖峰並行（見 apps/server/tools/cli/lib/prompt-research-distill-estimate.ts）。
 */
export const LENS_CONCURRENCY = 3

export async function runAllLenses(
  transcript: string,
  episodeId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<AllLensesOutput> {
  const results = await pMap(
    LENS_ORDER,
    LENS_CONCURRENCY,
    async lens => [lens, await runLens(lens, transcript, episodeId, logger, vars)] as const,
  )
  return Object.fromEntries(results) as AllLensesOutput
}
