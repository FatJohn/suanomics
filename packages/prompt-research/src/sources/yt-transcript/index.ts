// Re-export the YT deep pipeline public API for the sources registry.
// Task 11 transcript-to-digest adapter + Task 17 CLI will consume this entry point.
//
// Policy: runtime modules use explicit named re-exports so new internal helpers
// don't leak automatically. `./schemas.js` uses wildcard because every Zod schema
// + inferred type defined there IS part of the public contract — callers iterate
// lens schemas, build typed outputs, etc. `gemini-json.ts`, `response-schemas.ts`,
// and `prompts.ts` internals stay private; only the `LensName` key type from
// `prompts.ts` is re-exported because consumers iterate lens keys.
//
// knip-ignore -- public API surface for yt-transcript lens system, kept for
// future plugin consumers (CLI, transcript-to-digest adapter, external callers).
export { runConsolidator } from './consolidator.js'
export { type AllLensesOutput, type LensOutputMap, runAllLenses, runLens } from './lens-extractors.js'
export { createLogger, type Logger, type RunStats } from './logger.js'
export {
  applySelectionFlags,
  fetchStreamsPage,
  parseStreamsHtml,
  type SelectionFlags,
  type VideoRef,
} from './playlist-resolver.js'
export type { LensName } from './prompts.js'
export { buildRunSummaryMarkdown, type RunSummaryInput } from './run-summary.js'
export * from './schemas.js'
export { runSegmenter } from './segmenter.js'
export { type FetchedTranscript, fetchTranscript } from './transcript-fetcher.js'
