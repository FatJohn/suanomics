import { containsForbiddenPhrase, CROSS_MARKET_SIGNAL_GROUPS } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { SERIES_SPECS } from '../market-data/series-config.js'
import { buildSnapshotBlock } from '../market-data/snapshot.js'
import { MACRO_FRAMES, renderMacroFramesSection } from './macro-frames.js'

function seriesSpec(id: string) {
  const s = SERIES_SPECS.find(x => x.seriesId === id)
  if (!s)
    throw new Error(id)
  return s
}

describe('macro frames data integrity', () => {
  it('is non-empty', () => {
    expect(MACRO_FRAMES.length).toBeGreaterThan(0)
  })

  it('every frame has a valid structure', () => {
    for (const f of MACRO_FRAMES) {
      expect(f.id, 'id non-empty').toBeTruthy()
      expect(f.name, 'name non-empty').toBeTruthy()
      expect(f.whenToApply, 'whenToApply non-empty').toBeTruthy()
      expect(f.questions.length, `${f.id} has questions`).toBeGreaterThan(0)
      expect(f.questions.every(q => q.trim().length > 0), `${f.id} questions non-blank`).toBe(true)
      expect(f.snapshotRefs.length, `${f.id} has snapshotRefs`).toBeGreaterThan(0)
    }
  })

  it('frame ids are unique', () => {
    const ids = MACRO_FRAMES.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every snapshotRef points to a real series in SERIES_SPECS', () => {
    const validIds = new Set(SERIES_SPECS.map(s => s.seriesId))
    for (const f of MACRO_FRAMES) {
      for (const ref of f.snapshotRefs) {
        expect(validIds.has(ref), `frame ${f.id} references unknown series ${ref}`).toBe(true)
      }
    }
  })

  // 通膨 frame 問「商品 vs 服務」「供給面 vs 需求面」，但一直沒接上四條成分序列。
  it('binds the inflation frame to headline + core + the four CPI components', () => {
    const frame = MACRO_FRAMES.find(f => f.id === 'inflation-decomposition')
    expect(frame?.snapshotRefs).toEqual([
      'us-cpi-yoy',
      'us-core-cpi-yoy',
      'us-cpi-energy-yoy',
      'us-cpi-food-yoy',
      'us-cpi-shelter-yoy',
      'us-cpi-supercore-yoy',
    ])
  })

  it('has the real-rate decomposition frame bound to real/breakeven/nominal series', () => {
    const frame = MACRO_FRAMES.find(f => f.id === 'real-rate-decomposition')
    expect(frame, 'real-rate-decomposition frame exists').toBeTruthy()
    expect(frame?.snapshotRefs).toEqual(
      expect.arrayContaining(['us-10y-real-rate', 'us-10y-breakeven', 'us-10y-yield']),
    )
    expect(frame?.questions.length ?? 0, 'has depth questions').toBeGreaterThanOrEqual(3)
  })
})

describe('renderMacroFramesSection', () => {
  it('renders the section header', () => {
    expect(renderMacroFramesSection()).toContain('## 總經數據解讀框架')
  })

  it('renders every frame name and its questions', () => {
    const out = renderMacroFramesSection()
    for (const f of MACRO_FRAMES) {
      expect(out, `header for ${f.id}`).toContain(f.name)
      for (const q of f.questions) {
        expect(out, `question of ${f.id}`).toContain(q)
      }
    }
  })

  it('renders the bound series ids for each frame', () => {
    const out = renderMacroFramesSection()
    for (const f of MACRO_FRAMES) {
      for (const ref of f.snapshotRefs) {
        expect(out, `series ${ref} of ${f.id}`).toContain(ref)
      }
    }
  })

  it('contains no forbidden compliance phrases', () => {
    expect(containsForbiddenPhrase(renderMacroFramesSection()).hit).toBe(false)
  })
})

// 跨市場訊號一致性接線的耦合守衛。
//
// macro-frames 的兩條問題用**硬編中文字串**指向另外兩個地方的產物：快照小節標題
// （snapshot.ts）與訊號組名（@suanomics/shared 的 CROSS_MARKET_SIGNAL_GROUPS）。這條耦合
// 已經證明會動——本分支第一個 commit 就因為實際渲染後才發現問題而改掉了兩組極名。
//
// 沒有這組測試，哪天有人改了標題或組名，prompt 會平靜地叫 LLM 去引用一個不存在的
// 區塊，而問題自帶的 fallback（「該小節不存在時才自行判讀」）會讓模型悄悄退回這次改動
// 想廢掉的自行判方向：退化零訊號、CI 全綠、唯一硬 gate NarrativeSchema 量不到。
describe('跨市場訊號的 prompt 引用不得指向不存在的東西', () => {
  const referencing = MACRO_FRAMES.flatMap(f => f.questions).filter(q => q.includes('跨市場訊號一致性'))

  it('確實有問題在引用該小節（改寫沒有被整段刪掉）', () => {
    expect(referencing.length).toBeGreaterThan(0)
  })

  it('引用的小節標題與 buildSnapshotBlock 實際產出的標題一致', () => {
    const block = buildSnapshotBlock([
      { spec: seriesSpec('taiex-margin-short-balance'), points: [{ date: '2026-06-11', value: 210 }, { date: '2026-06-10', value: 200 }] },
      { spec: seriesSpec('taiex-sbl-balance'), points: [{ date: '2026-06-11', value: 55 }, { date: '2026-06-10', value: 50 }] },
    ], new Date('2026-06-12T08:00:00Z'), '2026-06-12') ?? ''
    expect(block).toContain('跨市場訊號一致性')
  })

  it('引用的組名都存在於 CROSS_MARKET_SIGNAL_GROUPS', () => {
    const labels = new Set(CROSS_MARKET_SIGNAL_GROUPS.map(g => g.label))
    // 引號內的組名就是要對照的東西；沒抓到代表問法被改寫成別的形式、這組守衛也要跟著更新
    const quoted = referencing.flatMap(q => [...q.matchAll(/「([^」]+)」/g)].map(m => m[1] ?? ''))
    const groupRefs = quoted.filter(s => s !== '跨市場訊號一致性')
    expect(groupRefs.length).toBeGreaterThan(0)
    for (const ref of groupRefs) {
      expect(labels, `macro-frames 引用的組名「${ref}」不存在於 CROSS_MARKET_SIGNAL_GROUPS`).toContain(ref)
    }
  })
})
