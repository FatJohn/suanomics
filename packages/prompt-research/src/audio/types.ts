import type { Buffer } from 'node:buffer'

/**
 * STT provider abstraction. Switch from Gemini to Whisper / Deepgram / 等
 * by adding a new `<provider>-stt.ts` implementing `TranscribeAudio`.
 *
 * 現只 ship Gemini impl。第二個 provider 進來才考慮 env-based selector。
 */
export interface TranscribeInput {
  /** raw audio bytes */
  audio: Buffer
  /** e.g. 'audio/mpeg', 'audio/mp4', 'audio/x-m4a' */
  mimeType: string
  /** logging only, not sent to provider */
  episodeId: string
  /** ISO code hint, e.g. 'zh-TW' for Taiwan Mandarin */
  hintLanguage?: string
}

export type TranscribeAudio = (input: TranscribeInput) => Promise<string>
