import type { TranscriptInput } from '../pipeline/deep-pipeline.js'
import type { Digest, SourceSpec } from '../types.js'
import { downloadMp3, transcribeWithGemini } from '../audio/index.js'
import { distillCustomToDigest } from '../distillers/custom-to-digest.js'
import { distillSkillToDigest } from '../distillers/skill-to-digest.js'
import { runDeepPipeline } from '../pipeline/deep-pipeline.js'
import { PODCAST_PROMPT_VARS, YT_PROMPT_VARS } from '../pipeline/prompt-vars.js'
import {
  CustomSourceConfigSchema,
  PodcastRssConfigSchema,
  SkillSourceConfigSchema,
  YtSourceConfigSchema,

} from '../types.js'
import { readCustomText } from './custom-text.js'
import { pMap } from './dispatch-helpers.js'
import { fetchRssFeed, parseRssXml } from './podcast-rss/index.js'
import { fetchSkillMarkdown } from './skill-markdown.js'
import {
  applySelectionFlags,
  fetchStreamsPage,
  fetchTranscript,
  parseStreamsHtml,
} from './yt-transcript/index.js'

async function dispatchSkill(spec: SourceSpec): Promise<Digest> {
  const cfg = SkillSourceConfigSchema.parse(spec.config)
  const fetched = await fetchSkillMarkdown(cfg)
  return distillSkillToDigest({
    sourceSlug: spec.slug,
    sourceKind: 'skill-markdown',
    rawContent: fetched.content,
    rawSourceRef: { url: fetched.url },
  })
}

async function dispatchCustom(spec: SourceSpec): Promise<Digest> {
  const cfg = CustomSourceConfigSchema.parse(spec.config)
  const r = readCustomText(cfg)
  return distillCustomToDigest({
    sourceSlug: spec.slug,
    rawContent: r.content,
    localPath: r.localPath,
  })
}

async function dispatchYt(spec: SourceSpec, runDir: string): Promise<Digest> {
  const cfg = YtSourceConfigSchema.parse(spec.config)
  const html = await fetchStreamsPage(cfg.playlistUrl)
  const videos = applySelectionFlags(parseStreamsHtml(html), { count: cfg.count })
  // fetchTranscript 仍要 concurrency 限 3 避免 rate limit、用 pMap 而非 Promise.all。
  // 後續的 LLM stage concurrency 由 runDeepPipeline 內部處理。
  const inputs: TranscriptInput[] = await pMap(videos, 3, async (v) => {
    const t = await fetchTranscript(v.videoId)
    return {
      episodeId: v.videoId,
      title: v.title,
      url: v.url,
      publishedAt: v.publishedAt,
      durationSec: v.durationSec,
      transcriptText: t.text,
    }
  })
  return runDeepPipeline(inputs, spec, runDir, YT_PROMPT_VARS)
}

async function dispatchPodcastRss(spec: SourceSpec, runDir: string): Promise<Digest> {
  const cfg = PodcastRssConfigSchema.parse(spec.config)
  const { xml } = await fetchRssFeed({ url: cfg.rssUrl })
  const parsed = parseRssXml(xml)
  const selected = parsed.episodes.slice(0, cfg.count)

  if (selected.length === 0)
    throw new Error(`podcast-rss: feed has no episodes with enclosure: ${cfg.rssUrl}`)

  // concurrency=3 對齊 yt fetchTranscript pattern、避免 rate limit。
  // 下載 mp3 + STT 是 IO + LLM 混合、限 3 條足夠平行又不衝爆 Gemini quota。
  const inputs: TranscriptInput[] = await pMap(selected, 3, async (ep) => {
    const audio = await downloadMp3({ url: ep.enclosureUrl })
    const transcriptText = await transcribeWithGemini({
      audio: audio.buffer,
      mimeType: audio.mimeType,
      episodeId: ep.episodeId,
      hintLanguage: 'zh-TW',
    })
    return {
      episodeId: ep.episodeId,
      title: ep.title,
      url: ep.pageUrl ?? ep.enclosureUrl,
      publishedAt: ep.publishedAt,
      durationSec: ep.durationSec,
      transcriptText,
    }
  })

  return runDeepPipeline(inputs, spec, runDir, PODCAST_PROMPT_VARS)
}

export async function dispatchSource(spec: SourceSpec, runDir = '.'): Promise<Digest> {
  if (spec.kind === 'yt-transcript' && spec.pipeline !== 'deep') {
    throw new Error('deep pipeline required for yt-transcript')
  }
  if (spec.kind === 'podcast-rss' && spec.pipeline !== 'deep') {
    throw new Error('deep pipeline required for podcast-rss')
  }
  if (spec.kind === 'skill-markdown')
    return dispatchSkill(spec)
  if (spec.kind === 'custom-text')
    return dispatchCustom(spec)
  if (spec.kind === 'yt-transcript')
    return dispatchYt(spec, runDir)
  if (spec.kind === 'podcast-rss')
    return dispatchPodcastRss(spec, runDir)
  throw new Error(`unknown source kind: ${String(spec.kind)}`)
}
