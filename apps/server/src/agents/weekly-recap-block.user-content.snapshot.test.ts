import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import { describe, expect, it } from 'vitest'
import { buildWeeklyRecapBlock } from './weekly-recap-block.js'

// Characterization test：釘住 weekly-recap-block.ts 組給模型的 user content 逐字內容，
// 在把字面值搬到 prompts/weekly-recap-block.user-content.ts 之前先凍結行為基線。

function line(overrides: Partial<Storyline>): Storyline {
  return { id: 1, title: 'AI 去槓桿', thesis: '市場對 AI 資本支出回收的疑慮', status: 'open', entities: [], updates: [], lastTouchedBriefDate: null, ...overrides }
}

describe('buildWeeklyRecapBlock — characterization baseline', () => {
  it('all-empty window → null', () => {
    expect(buildWeeklyRecapBlock([line({ updates: [{ briefDate: '2026-06-01', valence: 'extend', note: 'old' }] })], '2026-07-06', '2026-07-10')).toBeNull()
  })

  it('renders full block: multiple storylines, every valence, every status (confirmed/refuted/open/dormant)', () => {
    const confirmedLine = line({
      id: 1,
      title: 'AI 去槓桿',
      status: 'confirmed',
      updates: [
        { briefDate: '2026-07-06', valence: 'support', note: '週一：疑慮升溫' },
        { briefDate: '2026-07-09', valence: 'challenge', note: '週四：財報打臉' },
      ],
    })
    const refutedLine = line({
      id: 2,
      title: '半導體庫存去化',
      status: 'refuted',
      updates: [{ briefDate: '2026-07-07', valence: 'extend', note: '庫存持續下降' }],
    })
    const openLine = line({
      id: 3,
      title: '央行降息路徑',
      status: 'open',
      updates: [{ briefDate: '2026-07-08', valence: 'support', note: '市場預期不變' }],
    })
    const dormantLine = line({
      id: 4,
      title: '地緣風險溢價',
      status: 'dormant',
      updates: [{ briefDate: '2026-07-08', valence: 'challenge', note: '風險溢價收斂' }],
    })
    const out = buildWeeklyRecapBlock([confirmedLine, refutedLine, openLine, dormantLine], '2026-07-06', '2026-07-10')
    expect(out).toMatchSnapshot()
  })
})
