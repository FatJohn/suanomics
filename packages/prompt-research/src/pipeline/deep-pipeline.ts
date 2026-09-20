import type { SourceSpec } from '@suanomics/jobs'
import type { Digest } from '../types.js'
import type { DeepPipelinePromptVars } from './prompt-vars.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { distillTranscriptToDigest } from '../distillers/transcript-to-digest.js'
import { filterTranscript, pMap } from '../sources/dispatch-helpers.js'
import {
  createLogger,
  runAllLenses,
  runConsolidator,
  runSegmenter,
} from '../sources/yt-transcript/index.js'
import { EpisodeL3Schema } from '../sources/yt-transcript/schemas.js'

export interface TranscriptInput {
  episodeId: string
  title: string
  url: string
  publishedAt: string
  durationSec: number
  transcriptText: string
}

/** 同時處理幾集 transcript（segmenter → lenses → episode assembly）；避免對 Gemini 打太密。 */
export const EPISODE_CONCURRENCY = 3

/**
 * Source-agnostic deep pipeline runner.
 *
 * 從「已有 transcript」開始：segmenter → filterTranscript → lenses (6) →
 * consolidator → distillTranscriptToDigest。yt-transcript 與 podcast-rss 共用。
 *
 * @param inputs            每集 transcript + metadata
 * @param spec              SourceSpec (slug + kind 等、傳給 distiller)
 * @param runDir            落地 consolidated markdown 的目錄
 * @param promptVars        source-specific 字眼（yt 注入 YT_PROMPT_VARS、podcast 注入 PODCAST_PROMPT_VARS）
 */
export async function runDeepPipeline(
  inputs: readonly TranscriptInput[],
  spec: SourceSpec,
  runDir: string,
  promptVars: DeepPipelinePromptVars,
): Promise<Digest> {
  const logger = createLogger({ runId: spec.slug, runDir })

  const episodes = await pMap(inputs, EPISODE_CONCURRENCY, async (input) => {
    const segmenterOut = await runSegmenter(input.transcriptText, input.episodeId, logger, promptVars)
    const filtered = filterTranscript(input.transcriptText, segmenterOut)
    const lenses = await runAllLenses(filtered, input.episodeId, logger, promptVars)
    return EpisodeL3Schema.parse({
      episodeId: input.episodeId,
      title: input.title,
      url: input.url,
      publishedAt: input.publishedAt,
      durationSec: input.durationSec,
      segmenter: segmenterOut,
      events: lenses.events.events,
      citedSources: lenses.cited_sources.sources,
      entities: lenses.entities.entities,
      reasoningChains: lenses.reasoning_chains.chains,
      impacts: lenses.impacts.impacts,
      analystFrames: lenses.analyst_frames.frames,
    })
  })

  const consolidated = await runConsolidator(episodes, spec.slug, logger, promptVars)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, `${spec.slug}-consolidated.md`), consolidated, 'utf8')
  logger.close()

  return distillTranscriptToDigest({
    sourceSlug: spec.slug,
    sourceKind: spec.kind,
    consolidatedMarkdown: consolidated,
    episodes,
    promptVars,
  })
}
