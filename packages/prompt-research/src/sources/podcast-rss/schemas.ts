import { z } from 'zod'

export const PodcastEpisodeSchema = z.object({
  /** GUID 或 fallback hash(enclosureUrl) */
  episodeId: z.string().min(1),
  title: z.string().min(1),
  /** ISO datetime（從 <pubDate> 解的 RFC 822 轉換） */
  publishedAt: z.string().datetime(),
  enclosureUrl: z.string().url(),
  enclosureType: z.string().min(1),
  /** 從 <itunes:duration> 解、失敗 fallback 0 */
  durationSec: z.number().int().nonnegative(),
  description: z.string().optional(),
  pageUrl: z.string().url().optional(),
})
export type PodcastEpisode = z.infer<typeof PodcastEpisodeSchema>

export const PodcastChannelSchema = z.object({
  title: z.string().min(1),
  author: z.string().optional(),
  description: z.string().optional(),
})
export type PodcastChannel = z.infer<typeof PodcastChannelSchema>

export const ParsedRssSchema = z.object({
  channel: PodcastChannelSchema,
  episodes: z.array(PodcastEpisodeSchema),
})
export type ParsedRss = z.infer<typeof ParsedRssSchema>
