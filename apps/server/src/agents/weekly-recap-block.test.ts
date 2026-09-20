import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import { describe, expect, it } from 'vitest'
import { buildWeeklyRecapBlock } from './weekly-recap-block.js'

function line(overrides: Partial<Storyline>): Storyline {
  return { id: 1, title: 'AI 去槓桿', thesis: '市場對 AI 資本支出回收的疑慮', status: 'open', entities: [], updates: [], lastTouchedBriefDate: null, ...overrides }
}

describe('buildWeeklyRecapBlock', () => {
  it('render 區間內 updates、含 thesis 與逐日進展', () => {
    const s = line({ updates: [
      { briefDate: '2026-07-06', valence: 'support', note: '週一：疑慮升溫' },
      { briefDate: '2026-07-09', valence: 'challenge', note: '週四：財報打臉' },
      { briefDate: '2026-06-01', valence: 'extend', note: '區間外舊進展' },
    ] })
    const out = buildWeeklyRecapBlock([s], '2026-07-06', '2026-07-10')
    expect(out).not.toBeNull()
    expect(out).toContain('本週敘事線回顧')
    expect(out).toContain('AI 去槓桿')
    expect(out).toContain('週一：疑慮升溫')
    expect(out).toContain('週四：財報打臉')
    expect(out).not.toContain('區間外舊進展')
  })
  it('confirmed/refuted 標示兌現/被證偽', () => {
    const s = line({ status: 'confirmed', updates: [{ briefDate: '2026-07-08', valence: 'support', note: '兌現' }] })
    const out = buildWeeklyRecapBlock([s], '2026-07-06', '2026-07-10')
    expect(out).not.toBeNull()
    expect(out).toContain('兌現')
  })
  it('無區間內 update 的 storyline 被略過；全空回 null', () => {
    const s = line({ updates: [{ briefDate: '2026-06-01', valence: 'extend', note: 'old' }] })
    expect(buildWeeklyRecapBlock([s], '2026-07-06', '2026-07-10')).toBeNull()
  })
})
