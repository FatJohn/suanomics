import type { PodcastResult } from './run.js'
import { appendFile } from 'node:fs/promises'

export interface PodcastSummaryInput {
  /** 本 process 花費閘的累計；run id 與同一 job 的其他步驟共用，查帳本會混進 corpus 與報告的花費。 */
  llm: { usd: number, calls: number }
  /** undefined 表示失敗；參數解析前就失敗時沒有日期。 */
  result: PodcastResult | undefined
  date?: string
  /** 失敗前已算出、送 TTS 的計費字元；失敗點之前的片段已向 Azure 計費。 */
  ttsChars?: number
}

const SKIP_REASON: Record<Extract<PodcastResult, { status: 'skipped' }>['reason'], string> = {
  'already-exists': '當日已有音檔',
  'no-brief': '當日沒有 complete 的 brief',
}

/** Actions job summary 用的 Markdown。 */
export function renderPodcastSummary({ llm, result, date, ttsChars }: PodcastSummaryInput): string {
  const cost = `LLM 花費 $${llm.usd.toFixed(4)}（呼叫 ${llm.calls} 次）`
  let line: string
  if (!result) {
    const tts = ttsChars === undefined ? '' : `，已開始 TTS（本集 Azure 計費字元 ${ttsChars}，失敗前送出的片段已計費）`
    line = `${date ? `${date} ` : ''}失敗，${cost}${tts}，原因見 log。`
  }
  else if (result.status === 'skipped') {
    line = `${result.date} 已略過（${SKIP_REASON[result.reason]}）。`
  }
  else {
    line = `${result.date} 完成，${cost}${result.reusedScript ? '（沿用舊稿）' : ''}，Azure 計費字元 ${result.billableChars}（${result.segments} 段）。`
  }
  return `## Podcast\n\n${line}\n`
}

/** 摘要失敗只 warn：這時 run 的結果已定，不能讓報表問題改掉 exit code。 */
export async function appendPodcastSummary(path: string | undefined, text: string): Promise<void> {
  if (!path)
    return
  try {
    await appendFile(path, text)
  }
  catch (err) {
    console.warn(JSON.stringify({ event: 'podcast_summary_failed', message: err instanceof Error ? err.message : String(err) }))
  }
}
