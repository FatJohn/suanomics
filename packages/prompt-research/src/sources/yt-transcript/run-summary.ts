import type { RunStats } from './logger.js'
import type { EpisodeL3 } from './schemas.js'

export interface RunSummaryInput {
  runId: string
  episodes: readonly EpisodeL3[]
  stats: RunStats
  supplementChars: number
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

export function buildRunSummaryMarkdown(input: RunSummaryInput): string {
  const { runId, episodes, stats, supplementChars } = input

  const statsBlock = `## Stats

- **Tokens in**: ${fmt(stats.totalTokensIn)}
- **Tokens out**: ${fmt(stats.totalTokensOut)}
- **Cost**: $${stats.totalCostUsd.toFixed(2)}
- **Retries**: ${stats.retryCount}
- **Events**: ${stats.eventCount}
- **Supplement length**: ${fmt(supplementChars)} chars`

  const episodesBlock = `## Episodes

${episodes.map(ep => `
### ${ep.episodeId} · ${ep.title}
- URL: ${ep.url}
- Published: ${ep.publishedAt}
- Duration: ${Math.floor(ep.durationSec / 60)} min
- Segmenter dropped: joke ${ep.segmenter.droppedMinutes.joke}m, ad ${ep.segmenter.droppedMinutes.ad}m, chitchat ${ep.segmenter.droppedMinutes.chitchat}m
- Events: ${ep.events.length} · Sources: ${ep.citedSources.length} · Entities: ${ep.entities.length}
- Reasoning chains: ${ep.reasoningChains.length} · Impacts: ${ep.impacts.length} · Analyst frames: ${ep.analystFrames.length}
`).join('\n')}`

  const supplementBlock = `## Supplement

**${fmt(supplementChars)} chars** written to \`apps/server/data/yt-prompt-supplement.txt\`.

See \`supplement.txt\` in this run folder for the full text.`

  return `# YT Ingest Run · ${runId}

${statsBlock}

${episodesBlock}

${supplementBlock}
`
}
