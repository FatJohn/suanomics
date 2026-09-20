import { describe, expect, it } from 'vitest'
import {
  EditorOutputSchema,
  EditorSelectionSchema,
  EditorStorylineSchema,
  parseEditorOutput,
  sanitizeSelection,
  sanitizeStoryline,
} from './editor-output.js'

const VALID_SELECTION = {
  mainThemes: ['Fed 政策轉向'],
  dailyThesis: '半導體封測鏈訂單能見度延展、是今日台股結構性關注升溫的核心',
  selectedNewsIds: [1, 2, 3, 4, 5],
}
const VALID_STORYLINE = {
  storylineTouches: [{ storylineId: 7, valence: 'support', note: 'CPI 低於預期' }],
  resolveStorylines: [],
  newStorylines: [{ title: '日圓套利平倉', thesis: '日銀升息引發資金回流', entities: ['BOJ'] }],
}
const VALID = { ...VALID_SELECTION, ...VALID_STORYLINE }

describe('editorSelectionSchema', () => {
  it('accepts valid selection', () => {
    expect(EditorSelectionSchema.safeParse(VALID_SELECTION).success).toBe(true)
  })
  it('rejects empty mainThemes and >2 themes', () => {
    expect(EditorSelectionSchema.safeParse({ ...VALID_SELECTION, mainThemes: [] }).success).toBe(false)
    expect(EditorSelectionSchema.safeParse({ ...VALID_SELECTION, mainThemes: ['a', 'b', 'c'] }).success).toBe(false)
  })
  it('rejects missing dailyThesis', () => {
    const { dailyThesis: _dt, ...rest } = VALID_SELECTION
    expect(EditorSelectionSchema.safeParse(rest).success).toBe(false)
  })
  it('rejects dailyThesis shorter than 10 chars', () => {
    expect(EditorSelectionSchema.safeParse({ ...VALID_SELECTION, dailyThesis: '太短' }).success).toBe(false)
  })
  it('rejects dailyThesis longer than 150 chars', () => {
    expect(EditorSelectionSchema.safeParse({ ...VALID_SELECTION, dailyThesis: 'a'.repeat(151) }).success).toBe(false)
  })
})

describe('editorStorylineSchema', () => {
  it('parses valence touches and resolveStorylines', () => {
    const r = EditorStorylineSchema.safeParse({
      storylineTouches: [{ storylineId: 5, valence: 'support', note: 'n' }],
      resolveStorylines: [{ storylineId: 6, disposition: 'refuted', note: 'r' }],
      newStorylines: [],
    })
    expect(r.success).toBe(true)
  })
  it('defaults all three arrays when absent', () => {
    const r = EditorStorylineSchema.parse({})
    expect(r).toEqual({ storylineTouches: [], resolveStorylines: [], newStorylines: [] })
  })
})

// EditorOutputSchema 只是 prompt 文字指涉的名字錨點，不是執行期契約——
// 它比 parseEditorOutput 嚴格（例如 3 條 resolve 它 reject、parse 則截斷後接受）。
describe('editorOutputSchema (prompt 的名字錨點、非執行期契約)', () => {
  it('accepts the union of both layers', () => {
    expect(EditorOutputSchema.safeParse(VALID).success).toBe(true)
  })
  it('is stricter than parseEditorOutput: rejects what parse would truncate', () => {
    const overLimit = { ...VALID, resolveStorylines: [1, 2, 3].map(i => ({ storylineId: i, disposition: 'confirmed', note: `n${i}` })) }
    expect(EditorOutputSchema.safeParse(overLimit).success).toBe(false)
    expect(parseEditorOutput(overLimit).storyline.resolveStorylines).toHaveLength(2)
  })
})

// 選稿層與 storyline 層必須互不拖累。
// 修的是實查出來的缺陷——原本是裸 .parse()、任一欄位不合就整包 throw。
describe('parseEditorOutput — 兩層互不拖累', () => {
  it('keeps selection intact when a newStorylines title exceeds its 60-char cap', () => {
    const r = parseEditorOutput({
      ...VALID,
      newStorylines: [{ title: 'a'.repeat(61), thesis: 'x', entities: [] }],
    })
    expect(r.selection).not.toBeNull()
    expect(r.selection?.dailyThesis).toBe(VALID_SELECTION.dailyThesis)
    expect(r.selection?.selectedNewsIds).toEqual([1, 2, 3, 4, 5])
    // 壞的那條新線被丟掉、既有線的更新不受牽連
    expect(r.storyline.newStorylines).toHaveLength(0)
    expect(r.storyline.storylineTouches).toHaveLength(1)
  })

  it('keeps storyline state intact when the selection layer is invalid', () => {
    const r = parseEditorOutput({ ...VALID, dailyThesis: '太短' })
    expect(r.selection).toBeNull()
    expect(r.storyline.storylineTouches).toHaveLength(1)
    expect(r.storyline.newStorylines).toHaveLength(1)
  })

  it('drops only the malformed entry inside an array, not the whole array', () => {
    const r = parseEditorOutput({
      ...VALID,
      storylineTouches: [
        { storylineId: 7, valence: 'support', note: 'good' },
        { storylineId: 8, valence: 'not-a-valence', note: 'bad' },
        { storylineId: 9, valence: 'extend', note: 'also good' },
      ],
    })
    expect(r.storyline.storylineTouches.map(t => t.storylineId)).toEqual([7, 9])
  })

  it('truncates resolveStorylines to 2 instead of failing the whole layer', () => {
    const r = parseEditorOutput({
      ...VALID,
      resolveStorylines: [1, 2, 3].map(i => ({ storylineId: i, disposition: 'confirmed', note: `n${i}` })),
    })
    expect(r.storyline.resolveStorylines).toHaveLength(2)
    expect(r.selection).not.toBeNull()
  })

  // 兩個契約上限都在 parse 層施加，sanitize 不再是第二個截斷點
  it('truncates newStorylines to 2', () => {
    const three = [1, 2, 3].map(i => ({ title: `t${i}`, thesis: 'x', entities: [] }))
    expect(parseEditorOutput({ ...VALID, newStorylines: three }).storyline.newStorylines).toHaveLength(2)
  })

  // 逐筆容錯不能是靜默降級：呼叫端要能 log 出「今天丟了幾筆」
  it('reports how many entries were dropped', () => {
    const r = parseEditorOutput({
      ...VALID,
      storylineTouches: [
        { storylineId: 7, valence: 'support', note: 'good' },
        { storylineId: 8, valence: 'bad-valence', note: 'x' },
      ],
      newStorylines: [{ title: 'a'.repeat(61), thesis: 'x', entities: [] }],
    })
    expect(r.schemaDroppedEntries).toBe(2)
  })

  it('reports zero dropped entries for fully valid output', () => {
    expect(parseEditorOutput(VALID).schemaDroppedEntries).toBe(0)
  })

  it('returns null selection and empty storyline arrays for non-object input', () => {
    for (const raw of [null, undefined, 'string', 42, []]) {
      const r = parseEditorOutput(raw)
      expect(r.selection).toBeNull()
      expect(r.storyline).toEqual({ storylineTouches: [], resolveStorylines: [], newStorylines: [] })
    }
  })
})

describe('sanitizeSelection', () => {
  it('filters hallucinated news ids', () => {
    const s = sanitizeSelection({ ...VALID_SELECTION, selectedNewsIds: [1, 2, 99, 3, 4, 5] }, [1, 2, 3, 4, 5, 6])
    expect(s.ok).toBe(true)
    expect(s.selectedNewsIds).toEqual([1, 2, 3, 4, 5])
  })
  it('marks not-ok when fewer than 2 valid news survive', () => {
    expect(sanitizeSelection({ ...VALID_SELECTION, selectedNewsIds: [98, 99] }, [1, 2, 3]).ok).toBe(false)
  })
  it('dedupes repeated news ids so ok counts distinct articles', () => {
    const s = sanitizeSelection({ ...VALID_SELECTION, selectedNewsIds: [1, 1, 2] }, [1, 2, 3])
    expect(s.selectedNewsIds).toEqual([1, 2])
    expect(s.ok).toBe(true)
  })
  it('marks not-ok when duplicates collapse below 2 distinct articles', () => {
    const s = sanitizeSelection({ ...VALID_SELECTION, selectedNewsIds: [1, 1] }, [1, 2, 3])
    expect(s.selectedNewsIds).toEqual([1])
    expect(s.ok).toBe(false)
  })
  it('carries mainThemes and dailyThesis through untouched', () => {
    const s = sanitizeSelection(VALID_SELECTION, [1, 2, 3, 4, 5])
    expect(s.mainThemes).toEqual(VALID_SELECTION.mainThemes)
    expect(s.dailyThesis).toBe(VALID_SELECTION.dailyThesis)
  })
})

describe('sanitizeStoryline', () => {
  it('filters a hallucinated storyline id', () => {
    const s = sanitizeStoryline(
      { ...VALID_STORYLINE, storylineTouches: [{ storylineId: 42, valence: 'support', note: 'ghost' }] },
      [7],
    )
    expect(s.storylineTouches).toHaveLength(0)
  })
  it('dedupes repeated storyline touches last-wins', () => {
    const s = sanitizeStoryline(
      {
        ...VALID_STORYLINE,
        storylineTouches: [
          { storylineId: 7, valence: 'extend', note: 'first' },
          { storylineId: 7, valence: 'challenge', note: 'second' },
        ],
      },
      [7],
    )
    expect(s.storylineTouches).toHaveLength(1)
    expect(s.storylineTouches[0]?.valence).toBe('challenge')
  })
  it('filters resolveStorylines to open ids and dedups last-wins', () => {
    const s = sanitizeStoryline(
      {
        ...VALID_STORYLINE,
        storylineTouches: [
          { storylineId: 5, valence: 'extend', note: 'a' },
          { storylineId: 5, valence: 'support', note: 'b' },
        ],
        resolveStorylines: [
          { storylineId: 7, disposition: 'confirmed', note: 'x' },
          { storylineId: 99, disposition: 'refuted', note: 'ghost' },
        ],
      },
      [5, 7],
    )
    expect(s.storylineTouches).toHaveLength(1)
    expect(s.storylineTouches[0]?.valence).toBe('support')
    expect(s.resolveStorylines).toHaveLength(1)
    expect(s.resolveStorylines[0]?.storylineId).toBe(7)
  })
  it('does NOT truncate newStorylines — that cap belongs to parseEditorOutput', () => {
    const three = [1, 2, 3].map(i => ({ title: `t${i}`, thesis: 'x', entities: [] }))
    const s = sanitizeStoryline({ ...VALID_STORYLINE, newStorylines: three }, [])
    expect(s.newStorylines).toHaveLength(3)
  })
})
