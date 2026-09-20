import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { extractVideoId, fetchTranscript, YoutubeError } from '../../src/transcript/youtube.js'

export type ParseResult = { url: string } | { error: string }

export function parseTranscriptArgs(args: string[]): ParseResult {
  const url = args[0]?.trim()
  if (!url)
    return { error: '用法：pnpm --filter server transcript <youtube-url>' }
  return { url }
}

export async function main(): Promise<void> {
  const parsed = parseTranscriptArgs(process.argv.slice(2))
  if ('error' in parsed) {
    console.error(parsed.error)
    process.exitCode = 1
    return
  }

  const videoId = extractVideoId(parsed.url)
  if (!videoId) {
    console.error('無法解析 YouTube video id（目前只支援 YouTube 連結）')
    process.exitCode = 1
    return
  }

  try {
    const result = await fetchTranscript(videoId)
    // meta 走 stderr、逐字稿走 stdout（方便 pipe / 重導乾淨內容）
    console.error(`# videoId=${videoId} language=${result.language} length=${result.originalLength}`)
    // eslint-disable-next-line no-console
    console.log(result.transcript)
  }
  catch (err) {
    if (err instanceof YoutubeError)
      console.error(`擷取失敗（${err.reason}）：${err.message}`)
    else
      console.error(`未知錯誤：${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

// 只有直接執行時跑 main；被 vitest import 時不觸發（argv[1] 為 vitest binary、不相符）
if (process.argv[1] === fileURLToPath(import.meta.url))
  void main()
