import type { DeepPipelinePromptVars } from '../../pipeline/prompt-vars.js'
import type { Logger } from './logger.js'
import type { SegmenterOutput } from './schemas.js'
import process from 'node:process'
import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { extractJson } from './gemini-json.js'
import { buildSegmenterSystemPrompt } from './prompts.js'
import { segmenterResponseSchema } from './response-schemas.js'
import { SegmenterOutputSchema } from './schemas.js'

// ★ Gemini 專屬、換 provider 換不掉——理由見 `../../gemini-client.ts` 檔頭 JSDoc（依賴
// 方向約束：packages/prompt-research 不能 import apps/server 的 providers/）。

// Transcript Tool 專屬 env：刻意不吃 Cascade pipeline 那條線的全域變數，
// 免得改 Cascade 設定時把這個獨立工具的 model 一起換掉（曾經真的發生過）。
const MODEL = process.env.TRANSCRIPT_TOOL_MODEL ?? 'gemini-3-flash-preview'
const TIMEOUT_MS = 120_000
const MAX_ATTEMPTS = 2

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
  transcript: string,
  episodeId: string,
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
      contents: `episodeId: ${episodeId}\n\n---\n\n${transcript}`,
      config: {
        systemInstruction: buildSegmenterSystemPrompt(vars),
        responseMimeType: 'application/json',
        responseSchema: segmenterResponseSchema,
        abortSignal: ctl.signal,
      },
    })
    const text = res.text
    if (!text)
      throw new Error('empty response from Gemini')
    return text
  }
  finally {
    clearTimeout(timer)
  }
}

export async function runSegmenter(
  transcript: string,
  episodeId: string,
  logger: Logger,
  vars: DeepPipelinePromptVars,
): Promise<SegmenterOutput> {
  let lastErr: unknown
  let lastRawText = ''
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const rawApiText = await callGeminiOnce(transcript, episodeId, vars)
      lastRawText = rawApiText
      const raw = extractJson(rawApiText)
      const parsed = SegmenterOutputSchema.parse(raw)
      logger.emit('segmenter.done', {
        episode: episodeId,
        segments: parsed.segments.length,
        dropped_min: Object.values(parsed.droppedMinutes).reduce((a, b) => a + b, 0),
      })
      return parsed
    }
    catch (err) {
      lastErr = err
      if (err instanceof z.ZodError || err instanceof SyntaxError) {
        logger.emit('retry', {
          episode: episodeId,
          stage: 'segmenter',
          attempt: attempt + 1,
          reason: err instanceof z.ZodError ? 'schema' : 'json_parse',
          raw_preview: lastRawText.slice(0, 300),
          raw_length: lastRawText.length,
        }, 'warn')
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('segmenter failed after retries')
}
