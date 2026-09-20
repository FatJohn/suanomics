import type { EnqueueFn, JobPayloadByKind } from '@suanomics/jobs'
import type { RunPodcastGenerateResult } from '../../podcast/generate.js'
import { runPodcastGenerate } from '../../podcast/generate.js'

export interface ProcessPodcastGenerateJobParams {
  payload: JobPayloadByKind['podcast-generate']
  updateProgress?: (n: number) => Promise<void> | void
  enqueue: EnqueueFn
}

export async function processPodcastGenerateJob(p: ProcessPodcastGenerateJobParams): Promise<RunPodcastGenerateResult> {
  await p.updateProgress?.(10)
  const result = await runPodcastGenerate({ date: p.payload.date, force: p.payload.force })
  await p.updateProgress?.(90)

  // Chain podcast-tts only when podcast was freshly generated (not skipped).
  // skipped=true 表示 podcast 已存在、audit 標 completed、不重跑 tts。
  if (!result.skipped) {
    const enq = p.enqueue
    try {
      await enq('podcast-tts', { date: p.payload.date })
    }
    catch (err) {
      console.warn(`[podcast-generate] enqueue podcast-tts for ${p.payload.date} failed:`, (err as Error).message)
    }
  }

  await p.updateProgress?.(100)
  return result
}
