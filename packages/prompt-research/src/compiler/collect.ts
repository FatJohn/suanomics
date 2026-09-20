import type { MergedDraft } from '../types.js'

export interface CollectedFrame {
  id: string
  sourceSlug: string
  name: string
  description: string
  whenToApply: string
  questions: string[]
}

// 路徑 B（2026-06-12）：curation YAML 閘下架、frames 全量直通、
// 人工取捨移到 promote（candidate → apps/server/src/prompts/*.prompt.ts）階段。
export function collectFramesFromDraft(draft: MergedDraft): CollectedFrame[] {
  const collected: CollectedFrame[] = []
  for (const group of draft.frames) {
    for (const item of group.items) {
      collected.push({
        id: item.id,
        sourceSlug: item.sourceSlug,
        name: item.frame.name,
        description: item.frame.description,
        whenToApply: item.frame.whenToApply,
        questions: item.frame.questions,
      })
    }
  }
  return collected
}
