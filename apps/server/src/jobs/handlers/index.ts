import type { JobHandler, JobKind } from '@suanomics/jobs'
import { runAnalyze } from './analyze-worker.js'
import { processBriefJob } from './brief-worker.js'
import { runCorpusRefresh } from './corpus-worker.js'
import { processMarketDataRefreshJob } from './market-data-refresh-worker.js'
import { processNewsRefreshJob } from './news-refresh-worker.js'
import { processPodcastGenerateJob } from './podcast-generate-worker.js'
import { processPodcastTtsJob } from './podcast-tts-worker.js'
import { processPromptRefreshJob } from './prompt-refresh-worker.js'

/**
 * kind → handler。
 *
 * 型別寫成 `{ [K in JobKind]: JobHandler<K> }`：漏掉一個 kind 是編譯錯誤，不是
 * 「那個 kind 的 job 靜靜堆在佇列裡沒有人消費」。併發這些純設定在 `../specs.ts`。
 *
 * 每個 handler 回傳 `JobOutcome`（resultRef + 可選 metadata），audit 的 markActive／
 * markCompleted／markFailed 全由 runner 負責——這裡不再有生命週期樣板。
 */
export function createHandlers(): { [K in JobKind]: JobHandler<K> } {
  return {
    'corpus-refresh': async (payload, ctx) => {
      const input: { sourceSlugs?: string[], force?: boolean } = { force: payload.force }
      if (payload.sourceSlugs !== undefined)
        input.sourceSlugs = payload.sourceSlugs
      const { ...rest } = await runCorpusRefresh({
        payload: input,
        progress: pct => ctx.updateProgress(pct),
      })
      return { resultRef: `external_articles/batch-${ctx.auditId}`, metadata: rest }
    },

    'analyze': async (payload, ctx) => {
      const r = await runAnalyze(payload, {
        updateProgress: ctx.updateProgress,
        markMetadata: ctx.markMetadata,
      })
      return { resultRef: `analyses/${r.analysisId}` }
    },

    'daily-brief': async (payload, ctx) => {
      const r = await processBriefJob({
        payload,
        updateProgress: n => ctx.updateProgress(n),
        enqueue: ctx.enqueue,
      })
      return {
        resultRef: r.skipped ? 'skipped/weekend-gate' : `daily_briefs/${r.briefId}`,
        metadata: r.metadata as unknown as Record<string, unknown>,
      }
    },

    'podcast-generate': async (payload, ctx) => {
      const r = await processPodcastGenerateJob({
        payload,
        updateProgress: n => ctx.updateProgress(n),
        enqueue: ctx.enqueue,
      })
      return {
        resultRef: `daily_briefs/${r.briefDate}/podcast_json`,
        metadata: { totalChars: r.totalChars, acts: r.acts, elapsedMs: r.elapsedMs, forbiddenSanitized: r.forbiddenSanitized },
      }
    },

    'podcast-tts': async (payload, ctx) => {
      const r = await processPodcastTtsJob({
        payload,
        updateProgress: n => ctx.updateProgress(n),
      })
      return {
        resultRef: `daily_briefs/${r.briefDate}/podcast_audio`,
        metadata: { bytes: r.bytes, scriptChars: r.scriptChars, ttsLatencyMs: r.ttsLatencyMs, skipped: r.skipped },
      }
    },

    'news-refresh': async (_payload, ctx) => {
      const r = await processNewsRefreshJob({ updateProgress: n => ctx.updateProgress(n) })
      return {
        resultRef: `news_items/refresh-${ctx.auditId}`,
        metadata: { sourcesProcessed: r.sourcesProcessed, sourcesFailed: r.sourcesFailed, totalInserted: r.totalInserted, perSource: r.perSource },
      }
    },

    'prompt-refresh': async (payload, ctx) => {
      const r = await processPromptRefreshJob({
        payload,
        updateProgress: n => ctx.updateProgress(n),
      })
      return {
        resultRef: `prompts/_candidates/${r.runId}`,
        metadata: {
          runId: r.runId,
          sourcesProcessed: r.sourcesProcessed,
          candidatesDir: r.candidatesDir,
          candidatesWritten: r.candidatesWritten,
        },
      }
    },

    'market-data-refresh': async (_payload, ctx) => {
      const r = await processMarketDataRefreshJob({ updateProgress: n => ctx.updateProgress(n) })
      return {
        resultRef: `market_data/refresh-${ctx.auditId}`,
        metadata: { seriesProcessed: r.seriesProcessed, pointsUpserted: r.pointsUpserted, failures: r.failures },
      }
    },
  }
}
