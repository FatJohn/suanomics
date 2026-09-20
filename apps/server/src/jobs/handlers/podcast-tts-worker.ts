import type { JobPayloadByKind } from '@suanomics/jobs'
import type { RunPodcastTtsResult } from '../../podcast/tts.js'
import { runPodcastTts } from '../../podcast/tts.js'

export interface ProcessPodcastTtsJobParams {
  payload: JobPayloadByKind['podcast-tts']
  updateProgress?: (n: number) => Promise<void> | void
}

export async function processPodcastTtsJob(p: ProcessPodcastTtsJobParams): Promise<RunPodcastTtsResult> {
  await p.updateProgress?.(10)
  const result = await runPodcastTts({ date: p.payload.date })
  await p.updateProgress?.(100)
  return result
}
