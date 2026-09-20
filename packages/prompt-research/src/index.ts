// @suanomics/prompt-research：server 內 prompt research pipeline 抽出獨立
// workspace。對外 surface 只 export pipeline runtime 用的部分。

export { downloadMp3, transcribeWithGemini } from './audio/index.js'
export { runCompile } from './compiler/cli-compile.js'
export { pruneOldCandidates } from './compiler/prune-candidates.js'
export { GARNISH_DENYLIST } from './compiler/shared-preamble.js'
export { mergeDigests } from './merger.js'

// LLM 呼叫預算估算（apps/server/tools/cli/lib/prompt-research-distill-estimate.ts）需要這個
// 常數算尖峰並行，不在 apps/server 端另寫一份數字。
export { EPISODE_CONCURRENCY } from './pipeline/deep-pipeline.js'

export { DEFAULT_SOURCES } from './sources/default-sources.js'
export { dispatchSource } from './sources/index.js'
export {
  fetchRssFeed,
  parseRssXml,
  type PodcastEpisode,
} from './sources/podcast-rss/index.js'

// Eval reuse surface：內部評測 pipeline 直接重用 source fetch/parse helpers
// 與 audio STT，避免另起一套擷取邏輯。零新邏輯、只是把既有模組 helper re-export。
export {
  type FetchedTranscript,
  fetchStreamsPage,
  fetchTranscript,
  parseStreamsHtml,
  type VideoRef,
} from './sources/yt-transcript/index.js'

// LLM 呼叫預算估算（apps/server/tools/cli/lib/prompt-research-distill-estimate.ts）需要這個
// 常數算尖峰並行，同 EPISODE_CONCURRENCY 的理由；直接從定義它的模組 export，不經
// sources/yt-transcript/index.js 轉發。
export { LENS_CONCURRENCY } from './sources/yt-transcript/lens-extractors.js'

export type { Digest, SourceSpec } from './types.js'
