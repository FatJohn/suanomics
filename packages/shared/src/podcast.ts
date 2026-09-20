import { z } from 'zod'

export const PodcastStorylineSchema = z.enum([
  'ai-tech',
  'geopolitics',
  'rates',
  'consumer',
  'other',
])
export type PodcastStoryline = z.infer<typeof PodcastStorylineSchema>

export const PodcastHookSchema = z.object({
  headline: z.string().min(20).max(80),
  body: z.string().min(150).max(400),
})
export type PodcastHook = z.infer<typeof PodcastHookSchema>

export const PodcastActSchema = z.object({
  actTitle: z.string().min(8).max(40),
  storyline: PodcastStorylineSchema,
  body: z.string().min(300).max(800),
  citationUrls: z.array(z.string().url()).min(1).max(6),
  relatedNewsIds: z.array(z.string()).min(1).max(4),
})
export type PodcastAct = z.infer<typeof PodcastActSchema>

export const PodcastTakeawaySchema = z.object({
  body: z.string().min(150).max(400),
})
export type PodcastTakeaway = z.infer<typeof PodcastTakeawaySchema>

export const PodcastMetaSchema = z.object({
  totalChars: z.number().int().min(1800).max(2800),
  persona: z.literal('panpan'),
  generatedAt: z.string().datetime(),
})
export type PodcastMeta = z.infer<typeof PodcastMetaSchema>

export const PodcastSchema = z.object({
  briefDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'briefDate must be YYYY-MM-DD'),
  hook: PodcastHookSchema,
  acts: z.array(PodcastActSchema).min(3).max(5),
  takeaway: PodcastTakeawaySchema,
  meta: PodcastMetaSchema,
})
export type Podcast = z.infer<typeof PodcastSchema>

// Caller-injected citation subset gate.
// Mirrors NarrativeWriter pattern — the allowed URL set comes from MarketBrief.citations[]
// and varies per brief, so it's not bakeable into the static schema.
/**
 * Wraps PodcastSchema with a runtime citation subset check.
 * @param allowedUrls - typically MarketBrief.citations.map(c => c.url) for the brief being narrated.
 *   Empty array is allowed but causes every parse to fail with "unknown citation url" — caller should guard.
 *   Duplicates are deduped via Set.
 */
export function makePodcastSchemaWithCitations(
  allowedUrls: readonly string[],
) {
  const allowed = new Set(allowedUrls)
  return PodcastSchema.superRefine((podcast, ctx) => {
    for (let i = 0; i < podcast.acts.length; i++) {
      const act = podcast.acts[i]
      if (!act)
        continue
      for (const url of act.citationUrls) {
        if (!allowed.has(url)) {
          ctx.addIssue({
            code: 'custom',
            path: ['acts', i, 'citationUrls'],
            message: `unknown citation url: ${url} (not in brief.citations subset)`,
          })
        }
      }
    }
  })
}
