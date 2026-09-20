// 週末回顧：把本週 [start,end] 內的 storyline 進展 render 成回顧 block（對照 buildStorylineBlock 風格）。
import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import { WEEKLY_RECAP_BLOCK_USER_TEXT } from '../prompts/weekly-recap-block.user-content.js'

export function buildWeeklyRecapBlock(storylines: Storyline[], start: string, end: string): string | null {
  const lines: string[] = [WEEKLY_RECAP_BLOCK_USER_TEXT.heading]
  let any = false
  for (const s of storylines) {
    const within = s.updates
      .filter(u => u.briefDate >= start && u.briefDate <= end)
      .sort((a, b) => a.briefDate.localeCompare(b.briefDate))
    if (within.length === 0)
      continue
    any = true
    lines.push(WEEKLY_RECAP_BLOCK_USER_TEXT.titleLine(s.title, s.thesis))
    for (const u of within)
      lines.push(WEEKLY_RECAP_BLOCK_USER_TEXT.updateLine(u.briefDate, WEEKLY_RECAP_BLOCK_USER_TEXT.valenceLabel(u.valence), u.note))
    const status = WEEKLY_RECAP_BLOCK_USER_TEXT.statusLabel(s.status)
    if (status)
      lines.push(WEEKLY_RECAP_BLOCK_USER_TEXT.statusLine(status))
  }
  return any ? lines.join('\n') : null
}
