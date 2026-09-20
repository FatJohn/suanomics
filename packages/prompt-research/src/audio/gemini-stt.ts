import type { TranscribeAudio, TranscribeInput } from './types.js'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { GoogleGenAI } from '@google/genai'

/**
 * ★ Gemini 專屬、換 provider 換不掉——理由與 `../gemini-client.ts` 的依賴方向約束相同
 * （`packages/prompt-research` 不能 import `apps/server/src/agents/providers/`），另外
 * 這支本身的形狀也不是「OpenAI 相容 chat completions」：語音轉文字 + 大檔案走
 * Gemini File API（`INLINE_LIMIT_BYTES` 那段切換邏輯），provider-neutral 的
 * `ProviderCallResult` 抽象是為文字 completion 設計，不涵蓋這個路徑。
 * 見 `apps/server/tools/ci/gemini-only-paths.ts`。
 */

// GEMINI_STT_MODEL 是 STT 這段的細粒度覆寫、TRANSCRIPT_TOOL_MODEL 是整個工具的預設；
// 兩者都不吃 Cascade 的全域變數（見 sources/yt-transcript/segmenter.ts 的說明）
const DEFAULT_MODEL = process.env.GEMINI_STT_MODEL ?? process.env.TRANSCRIPT_TOOL_MODEL ?? 'gemini-3-flash-preview'
const TIMEOUT_MS = 120_000
const MAX_ATTEMPTS = 2

// Gemini inline-data 上限官方 ~20MB（含整個 request payload）、
// 為 metadata + base64 膨脹 (~33%) 留 buffer、實際保守用 18MB 切換到 File API。
const INLINE_LIMIT_BYTES = 18 * 1024 * 1024

// File API ACTIVE 狀態 polling：5min 上限、3 秒一次（一般幾秒到一兩分鐘 ACTIVE）。
const FILE_ACTIVE_TIMEOUT_MS = 5 * 60 * 1000
const FILE_POLL_INTERVAL_MS = 3000

interface GenAiClient {
  models: {
    generateContent: (params: Record<string, unknown>) => Promise<{ text?: string }>
  }
  files: {
    upload: (params: { file: Blob, config?: { mimeType?: string } }) => Promise<{ name?: string, uri?: string, mimeType?: string, state?: string }>
    get: (params: { name: string }) => Promise<{ name?: string, uri?: string, mimeType?: string, state?: string }>
  }
}

function createClient(apiKey: string): GenAiClient {
  const GenAI = GoogleGenAI as unknown as {
    new (opts: { apiKey: string }): GenAiClient
    (opts: { apiKey: string }): GenAiClient
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

function buildSystemPrompt(hintLanguage?: string): string {
  const lang = hintLanguage ?? 'zh-TW'
  return `你是專業財經 podcast 逐字稿轉寫員。
任務：把整段音訊忠實轉成逐字稿、語言：${lang}（台灣國語、繁體中文）。
規則：
- 直接輸出純文字逐字稿、不要 JSON、不要 timestamp、不要 metadata。
- 保留口語結構、不要重新組織、不要摘要。
- 若有英文 / 數字、原樣保留。
- 若有兩位以上講者、用「主持人：」「來賓：」標、未明可省略。`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 透過 Gemini File API 上傳 audio、polling 等 ACTIVE、回傳可餵 generateContent 的
 * fileData reference（mimeType + fileUri）。
 *
 * 用於 audio > 18MB inline limit 的情況。典型財經 podcast 1hr @128kbps ~58MB、
 * 一定走這條。實作對齊 https://ai.google.dev/api/files：upload → poll get →
 * 用 fileData reference。
 */
async function uploadAndWaitActive(
  ai: GenAiClient,
  input: TranscribeInput,
): Promise<{ mimeType: string, fileUri: string }> {
  const blob = new Blob([new Uint8Array(input.audio)], { type: input.mimeType })
  const uploaded = await ai.files.upload({
    file: blob,
    config: { mimeType: input.mimeType },
  })

  // upload 直接回 ACTIVE 也可能、就跳過 polling。
  let current = uploaded
  if (current.state !== 'ACTIVE') {
    const fileName = current.name
    if (!fileName)
      throw new Error(`gemini files.upload returned no name for episode=${input.episodeId}`)
    const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS
    while (current.state !== 'ACTIVE') {
      if (current.state === 'FAILED')
        throw new Error(`gemini file processing FAILED for episode=${input.episodeId}`)
      if (Date.now() > deadline)
        throw new Error(`gemini file ACTIVE wait timeout (${FILE_ACTIVE_TIMEOUT_MS}ms) for episode=${input.episodeId}`)
      await sleep(FILE_POLL_INTERVAL_MS)
      current = await ai.files.get({ name: fileName })
    }
  }

  if (!current.uri)
    throw new Error(`gemini file has no uri after ACTIVE for episode=${input.episodeId}`)

  return {
    mimeType: current.mimeType ?? input.mimeType,
    fileUri: current.uri,
  }
}

export const transcribeWithGemini: TranscribeAudio = async (input) => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey)
    throw new Error('GEMINI_API_KEY not set')

  const ai = createClient(apiKey)

  // >18MB 走 File API、否則 inline。
  // 典型 60min @128kbps mp3 ~58MB、必走 File API；短片段（<5min）才會 inline。
  const audioBytes = input.audio.length
  const useFileApi = audioBytes > INLINE_LIMIT_BYTES

  let audioContent: Record<string, unknown>
  if (useFileApi) {
    const fileRef = await uploadAndWaitActive(ai, input)
    audioContent = { fileData: { mimeType: fileRef.mimeType, fileUri: fileRef.fileUri } }
  }
  else {
    const base64Data = Buffer.from(input.audio).toString('base64')
    audioContent = { inlineData: { mimeType: input.mimeType, data: base64Data } }
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: [
          audioContent,
          { text: `episodeId: ${input.episodeId}` },
        ],
        config: {
          systemInstruction: buildSystemPrompt(input.hintLanguage),
          abortSignal: ctl.signal,
        },
      })
      const text = res.text
      if (!text) {
        lastErr = new Error('empty response')
        continue
      }
      return text
    }
    catch (err) {
      lastErr = err
      if (err instanceof Error && err.name === 'AbortError')
        throw err
    }
    finally {
      clearTimeout(timer)
    }
  }
  throw lastErr ?? new Error('gemini stt failed after retries')
}
