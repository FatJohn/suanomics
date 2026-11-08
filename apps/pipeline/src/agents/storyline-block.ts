import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import { STORYLINE_BLOCK_USER_TEXT } from '../prompts/storyline-block.user-content.js'

export interface StorylineBlockEntry {
  title: string
  thesis: string
  valence: 'support' | 'challenge' | 'extend'
  note: string
  priorNote?: string | null
  priorDate?: string | null
  arcDays?: number
  resolveToday?: 'confirmed' | 'refuted' | null
}

export const CAP_CONTINUITY = 2

const VALENCE_RANK = { challenge: 2, support: 1, extend: 0 } as const
// 鏡射 storylines-repo 的 DISPOSITION_TO_VALENCE（該常數未 export、此處本地定義）
const DISPOSITION_TO_VALENCE = { confirmed: 'support', refuted: 'challenge' } as const

interface Touch { storylineId: number, valence: 'support' | 'challenge' | 'extend', note: string }
interface Resolve { storylineId: number, disposition: 'confirmed' | 'refuted', note: string }

function makeEntry(
  s: Storyline,
  valence: 'support' | 'challenge' | 'extend',
  note: string,
  resolveToday: 'confirmed' | 'refuted' | null,
  todayDate: string,
): StorylineBlockEntry {
  // 嚴格 `< todayDate`：brief 路徑此時 updates 全是 pre-today；regen 時今日 update 已持久化、
  // 嚴格不等式把它排除、避免 arcDays 重複計今日、且 priorNote 不會誤抓今日自身。
  const prior = s.updates.filter(u => u.briefDate < todayDate)
  const distinctDays = new Set(prior.map(u => u.briefDate))
  // 不信任 updates 寫入序、用 briefDate 字串比較取最近一筆（ISO date 字典序 = 時間序）
  const last = prior.reduce<Storyline['updates'][number] | null>(
    (acc, u) => (acc === null || u.briefDate > acc.briefDate ? u : acc),
    null,
  )
  return {
    title: s.title,
    thesis: s.thesis,
    valence,
    note,
    priorNote: last?.note ?? null,
    priorDate: last?.briefDate ?? null,
    arcDays: distinctDays.size + 1,
    resolveToday,
  }
}

export function entriesFromEditorResult(
  touches: Touch[],
  resolves: Resolve[],
  storylines: Storyline[],
  todayDate: string,
): StorylineBlockEntry[] {
  const byId = new Map(storylines.map(s => [s.id, s]))
  const resolveById = new Map(resolves.map(r => [r.storylineId, r]))
  const seen = new Set<number>()
  const entries: StorylineBlockEntry[] = []

  for (const t of touches) {
    const s = byId.get(t.storylineId)
    if (!s)
      continue
    seen.add(t.storylineId)
    const r = resolveById.get(t.storylineId)
    entries.push(makeEntry(s, t.valence, t.note, r?.disposition ?? null, todayDate))
  }
  for (const r of resolves) {
    if (seen.has(r.storylineId))
      continue
    const s = byId.get(r.storylineId)
    if (!s)
      continue
    entries.push(makeEntry(s, DISPOSITION_TO_VALENCE[r.disposition], r.note, r.disposition, todayDate))
  }

  entries.sort((a, b) =>
    (b.resolveToday ? 1 : 0) - (a.resolveToday ? 1 : 0)
    || (b.arcDays ?? 0) - (a.arcDays ?? 0)
    || VALENCE_RANK[b.valence] - VALENCE_RANK[a.valence])
  return entries.slice(0, CAP_CONTINUITY)
}

export function buildStorylineBlock(entries: StorylineBlockEntry[]): string | null {
  if (entries.length === 0)
    return null
  const lines = [STORYLINE_BLOCK_USER_TEXT.heading]
  for (const e of entries) {
    const arc = e.arcDays && e.arcDays >= 2 ? STORYLINE_BLOCK_USER_TEXT.arcSuffix(e.arcDays) : ''
    lines.push(STORYLINE_BLOCK_USER_TEXT.entryHeaderLine(e.title, STORYLINE_BLOCK_USER_TEXT.valenceLabel(e.valence), e.thesis, arc))
    if (e.priorNote && e.priorDate)
      lines.push(STORYLINE_BLOCK_USER_TEXT.priorLine(e.priorDate, e.priorNote))
    lines.push(STORYLINE_BLOCK_USER_TEXT.todayLine(e.note))
    if (e.resolveToday)
      lines.push(STORYLINE_BLOCK_USER_TEXT.resolveLine(e.resolveToday))
  }
  return lines.join('\n')
}

export function continuityHintFromEntries(entries: StorylineBlockEntry[]): string | null {
  const top = entries[0]
  if (!top)
    return null
  const arc = top.arcDays && top.arcDays >= 2 ? STORYLINE_BLOCK_USER_TEXT.continuityArcSuffix(top.arcDays) : ''
  return STORYLINE_BLOCK_USER_TEXT.continuityHint(top.title, arc, top.note)
}
