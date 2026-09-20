// Gemini structured-output RESPONSE_SCHEMA for PodcastWriter agent.
// 抽到獨立 file 控管 podcast-writer.ts size < 300 行（P5 max-lines 紀律）。
// 保持與 packages/shared 的 PodcastSchema 形狀對齊；items / acts.maxItems 等
// 進階 constraint 留給 Zod parse 階段執行、避免 Gemini schema 太緊。
export const PODCAST_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    briefDate: { type: 'string' },
    hook: { type: 'object', properties: { headline: { type: 'string' }, body: { type: 'string' } }, required: ['headline', 'body'] },
    acts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          actTitle: { type: 'string' },
          storyline: { type: 'string' },
          body: { type: 'string' },
          citationUrls: { type: 'array', items: { type: 'string' } },
          relatedNewsIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['actTitle', 'storyline', 'body', 'citationUrls', 'relatedNewsIds'],
      },
    },
    takeaway: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
    meta: {
      type: 'object',
      properties: { totalChars: { type: 'number' }, persona: { type: 'string' }, generatedAt: { type: 'string' } },
      required: ['totalChars', 'persona', 'generatedAt'],
    },
  },
  required: ['briefDate', 'hook', 'acts', 'takeaway', 'meta'],
}
