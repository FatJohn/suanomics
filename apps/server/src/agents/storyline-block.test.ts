import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import { describe, expect, it } from 'vitest'

import { buildStorylineBlock, CAP_CONTINUITY, continuityHintFromEntries, entriesFromEditorResult } from './storyline-block.js'

describe('buildStorylineBlock', () => {
  it('renders touched lines with valence labels, returns null when empty', () => {
    const out = buildStorylineBlock([
      { title: 'Fed 降息路徑', thesis: '年內降息兩碼', valence: 'support', note: 'CPI 低於預期' },
      { title: '台股資金行情', thesis: '外資回流', valence: 'extend', note: '連五買' },
    ])
    expect(out).toContain('## 追蹤中敘事線（今日有進展）')
    expect(out).toContain('【Fed 降息路徑】（今日支持）論點：年內降息兩碼')
    expect(out).toContain('今日進展：CPI 低於預期')
    expect(out).toContain('（今日進展）')
    expect(buildStorylineBlock([])).toBeNull()
  })

  it('uses neutral wording for challenge', () => {
    const out = buildStorylineBlock([{ title: 't', thesis: 'x', valence: 'challenge', note: 'n' }])
    expect(out).toContain('（今日反向訊號）')
  })

  it('renders valence label for each entry', () => {
    const block = buildStorylineBlock([{ title: 'A', thesis: 'th', valence: 'support', note: 'n' }])
    expect(block).toContain('今日支持')
    expect(block).toContain('A')
  })

  it('enriched entry 渲染 prior 對照 / 弧長 / 伏筆兌現', () => {
    const out = buildStorylineBlock([{
      title: '能源通膨',
      thesis: '油價回落壓抑通膨',
      valence: 'challenge',
      note: '原油庫存意外增加、與回落論點相左',
      priorNote: '荷姆茲復航、油價回落',
      priorDate: '2026-06-23',
      arcDays: 3,
      resolveToday: 'refuted',
    }])
    expect(out).toContain('已追蹤 3 天')
    expect(out).toContain('先前（2026-06-23）：荷姆茲復航、油價回落')
    expect(out).toContain('今日進展：原油庫存意外增加、與回落論點相左')
    expect(out).toContain('※今日論點被證偽（refuted）')
  })

  it('arcDays < 2 / 無 priorNote 時不渲染 arc / 對照行（新線首日）', () => {
    const out = buildStorylineBlock([{
      title: '稀土管制',
      thesis: '北京收緊稀土出口',
      valence: 'extend',
      note: '正式公告',
      priorNote: null,
      priorDate: null,
      arcDays: 1,
      resolveToday: null,
    }])
    expect(out).not.toContain('已追蹤')
    expect(out).not.toContain('先前（')
    expect(out).not.toContain('※今日論點')
    expect(out).toContain('今日進展：正式公告')
  })

  it('confirmed 渲染兌現字樣', () => {
    const out = buildStorylineBlock([{
      title: 'A',
      thesis: 't',
      valence: 'support',
      note: 'n',
      arcDays: 4,
      resolveToday: 'confirmed',
    }])
    expect(out).toContain('※今日論點兌現（confirmed）')
  })

  // 釘整個 block 結構 = 給 LLM 的 prompt 契約（比照 snapshot.ts inline snapshot 先例）
  it('pins the full block structure (prompt contract)', () => {
    const out = buildStorylineBlock([
      { title: 'Fed 降息路徑', thesis: '年內降息兩碼', valence: 'support', note: 'CPI 低於預期' },
      { title: '台股資金行情', thesis: '外資回流', valence: 'extend', note: '連五買' },
      { title: '半導體庫存', thesis: '下半年回補', valence: 'challenge', note: '財報下修' },
    ])
    expect(out).toMatchInlineSnapshot(`
      "## 追蹤中敘事線（今日有進展）
      - 【Fed 降息路徑】（今日支持）論點：年內降息兩碼
        今日進展：CPI 低於預期
      - 【台股資金行情】（今日進展）論點：外資回流
        今日進展：連五買
      - 【半導體庫存】（今日反向訊號）論點：下半年回補
        今日進展：財報下修"
    `)
  })
})

const energyLine: Storyline = {
  id: 2,
  title: '能源通膨',
  thesis: '油價回落壓抑通膨',
  status: 'open',
  entities: [],
  updates: [
    { briefDate: '2026-06-22', valence: 'extend', note: '荷姆茲緊張' },
    { briefDate: '2026-06-23', valence: 'support', note: '荷姆茲復航、油價回落' },
  ],
  lastTouchedBriefDate: '2026-06-23',
}
const newLine: Storyline = {
  id: 5,
  title: '稀土管制',
  thesis: '北京收緊稀土出口',
  status: 'open',
  entities: [],
  updates: [],
  lastTouchedBriefDate: null,
}

describe('entriesFromEditorResult', () => {
  it('帶出 prior note / priorDate / arcDays（prior distinct 天數 + 1）', () => {
    const [e] = entriesFromEditorResult(
      [{ storylineId: 2, valence: 'challenge', note: '原油庫存意外增加' }],
      [],
      [energyLine],
      '2026-06-24',
    )
    expect(e).toEqual({
      title: '能源通膨',
      thesis: '油價回落壓抑通膨',
      valence: 'challenge',
      note: '原油庫存意外增加',
      priorNote: '荷姆茲復航、油價回落',
      priorDate: '2026-06-23',
      arcDays: 3,
      resolveToday: null,
    })
  })

  it('新線首日：無 prior、arcDays = 1', () => {
    const [e] = entriesFromEditorResult(
      [{ storylineId: 5, valence: 'extend', note: '正式公告' }],
      [],
      [newLine],
      '2026-06-24',
    )
    expect(e?.priorNote).toBeNull()
    expect(e?.priorDate).toBeNull()
    expect(e?.arcDays).toBe(1)
  })

  it('touch + 同線 resolve：同一 entry 帶 valence/note 與 resolveToday', () => {
    const [e] = entriesFromEditorResult(
      [{ storylineId: 2, valence: 'support', note: '今日進一步支持' }],
      [{ storylineId: 2, disposition: 'confirmed', note: '論點兌現' }],
      [energyLine],
      '2026-06-24',
    )
    expect(e?.note).toBe('今日進一步支持')
    expect(e?.resolveToday).toBe('confirmed')
  })

  it('resolve-only（未 touch）：valence 由 disposition 推得、note = resolve note', () => {
    const [e] = entriesFromEditorResult(
      [],
      [{ storylineId: 2, disposition: 'refuted', note: '論點被證偽' }],
      [energyLine],
      '2026-06-24',
    )
    expect(e?.valence).toBe('challenge') // refuted → challenge
    expect(e?.note).toBe('論點被證偽')
    expect(e?.resolveToday).toBe('refuted')
  })

  it('排序 + cap top-2：resolve 優先 → arcDays 多優先 → valence challenge>support>extend', () => {
    const a: Storyline = { ...energyLine, id: 11, title: 'A', updates: [{ briefDate: '2026-06-23', valence: 'extend', note: 'x' }] } // arcDays 2
    const b: Storyline = { ...energyLine, id: 12, title: 'B', updates: [] } // arcDays 1
    const c: Storyline = { ...energyLine, id: 13, title: 'C', updates: [] } // arcDays 1、但被 resolve
    const entries = entriesFromEditorResult(
      [
        { storylineId: 11, valence: 'extend', note: 'na' },
        { storylineId: 12, valence: 'challenge', note: 'nb' },
        { storylineId: 13, valence: 'support', note: 'nc' },
      ],
      [{ storylineId: 13, disposition: 'confirmed', note: 'r' }],
      [a, b, c],
      '2026-06-24',
    )
    expect(entries.map(e => e.title)).toEqual(['C', 'A']) // C(resolve) 先、A(arcDays2) 次、B 被 cap 砍
    expect(entries.length).toBe(CAP_CONTINUITY)
  })

  it('unknown storylineId → skip', () => {
    const entries = entriesFromEditorResult(
      [{ storylineId: 999, valence: 'support', note: 'x' }],
      [],
      [energyLine],
      '2026-06-24',
    )
    expect(entries).toEqual([])
  })
})

describe('continuityHintFromEntries', () => {
  it('取第一條 render 單行 hint（含 title / 弧長 / 今日 note）', () => {
    const hint = continuityHintFromEntries([
      { title: '能源通膨', thesis: 't', valence: 'challenge', note: '原油庫存意外增加', arcDays: 3 },
      { title: '次要線', thesis: 't2', valence: 'extend', note: 'x', arcDays: 1 },
    ])
    expect(hint).toBe('延續主線「能源通膨」（已追蹤 3 天）：原油庫存意外增加')
  })

  it('arcDays < 2 不帶弧長片段', () => {
    const hint = continuityHintFromEntries([{ title: 'A', thesis: 't', valence: 'extend', note: 'n', arcDays: 1 }])
    expect(hint).toBe('延續主線「A」：n')
  })

  it('空陣列 → null', () => {
    expect(continuityHintFromEntries([])).toBeNull()
  })
})
