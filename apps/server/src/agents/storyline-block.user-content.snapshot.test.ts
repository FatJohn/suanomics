import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import { describe, expect, it } from 'vitest'
import { buildStorylineBlock, continuityHintFromEntries, entriesFromEditorResult } from './storyline-block.js'

// Characterization test：釘住 storyline-block.ts 組給模型的 user content 逐字內容，在把
// 字面值搬到 prompts/storyline-block.user-content.ts 之前先凍結行為基線。
// 既有 storyline-block.test.ts 已涵蓋多數斷言與一條 inline snapshot，這裡另補檔案式
// snapshot，並用「updates 亂序」輸入證明 entriesFromEditorResult 的排序邏輯沒被動到。

describe('buildStorylineBlock / continuityHintFromEntries — characterization baseline', () => {
  it('zero entries → null', () => {
    expect(buildStorylineBlock([])).toBeNull()
    expect(continuityHintFromEntries([])).toBeNull()
  })

  it('renders full block: multiple entries, every valence, with/without prior note, resolveToday both variants', () => {
    const out = buildStorylineBlock([
      {
        title: '能源通膨',
        thesis: '油價回落壓抑通膨',
        valence: 'challenge',
        note: '原油庫存意外增加、與回落論點相左',
        priorNote: '荷姆茲復航、油價回落',
        priorDate: '2026-06-23',
        arcDays: 3,
        resolveToday: 'refuted',
      },
      {
        title: '台股資金行情',
        thesis: '外資回流',
        valence: 'extend',
        note: '連五買',
        arcDays: 4,
        resolveToday: 'confirmed',
      },
      {
        title: '稀土管制',
        thesis: '北京收緊稀土出口',
        valence: 'support',
        note: '正式公告',
        priorNote: null,
        priorDate: null,
        arcDays: 1,
        resolveToday: null,
      },
    ])
    expect(out).toMatchSnapshot()
  })

  it('continuity hint: with arc suffix and without (arcDays < 2)', () => {
    const withArc = continuityHintFromEntries([
      { title: '能源通膨', thesis: 't', valence: 'challenge', note: '原油庫存意外增加', arcDays: 3 },
    ])
    const withoutArc = continuityHintFromEntries([
      { title: 'A', thesis: 't', valence: 'extend', note: 'n', arcDays: 1 },
    ])
    expect({ withArc, withoutArc }).toMatchSnapshot()
  })
})

const energyLine: Storyline = {
  id: 2,
  title: '能源通膨',
  thesis: '油價回落壓抑通膨',
  status: 'open',
  entities: [],
  updates: [
    // 刻意亂序寫入（非 briefDate 遞增）：entriesFromEditorResult 內部用 briefDate 字串
    // 比較取最近一筆，不信任 updates 的寫入序——亂序輸入正好證明排序邏輯沒被動到。
    { briefDate: '2026-06-21', valence: 'extend', note: '最早一筆' },
    { briefDate: '2026-06-23', valence: 'support', note: '荷姆茲復航、油價回落' },
    { briefDate: '2026-06-22', valence: 'extend', note: '中間一筆' },
  ],
  lastTouchedBriefDate: '2026-06-23',
}

describe('entriesFromEditorResult — characterization baseline (out-of-order updates)', () => {
  it('picks the latest-by-briefDate update as priorNote/priorDate despite out-of-order array', () => {
    const entries = entriesFromEditorResult(
      [{ storylineId: 2, valence: 'challenge', note: '原油庫存意外增加' }],
      [],
      [energyLine],
      '2026-06-24',
    )
    expect(entries).toMatchSnapshot()
  })
})
