import { FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildEntitySummaryPrompt } from './entity-summary-prompt.js'

describe('buildEntitySummaryPrompt', () => {
  it('指示 AI 做摘要 + entities + topicTags', () => {
    const p = buildEntitySummaryPrompt()
    expect(p).toMatch(/摘要/)
    expect(p).toMatch(/entities/)
    expect(p).toMatch(/topic/i)
  })

  it('列出禁用詞 (含 FORBIDDEN_PHRASES 代表性字眼)', () => {
    const p = buildEntitySummaryPrompt()
    expect(p).toMatch(/建議買/)
    expect(p).toMatch(/保證獲利/)
  })

  it('entity kind whitelist 含 company/ticker/sector/macro/other', () => {
    const p = buildEntitySummaryPrompt()
    for (const k of ['company', 'ticker', 'sector', 'macro', 'other'])
      expect(p).toContain(k)
  })

  it('summary 長度硬約束 ~120 字', () => {
    const p = buildEntitySummaryPrompt()
    expect(p).toMatch(/80.{0,5}120|120 字|120.{0,5}字/)
  })

  it('topicTags max 5', () => {
    expect(buildEntitySummaryPrompt()).toMatch(/\b5\b/)
  })

  it('imports FORBIDDEN_PHRASES (sanity check on source)', () => {
    expect(FORBIDDEN_PHRASES.length).toBeGreaterThan(0)
  })
})

// 規格與範例自相矛盾的守衛。
//
// 原本第 3 條寫「短詞、< 6 字」，但同一份 prompt 的四組範例全是英文 kebab-case、
// 長度 8–13（`geopolitics` 11、`supply-chain` 12、`semiconductor` 13、`us-china` 8）。
// 下游 `normTag`（eval/model-ab/normalize.ts）也是把 tag 正規化成小寫 kebab-case，
// 印證範例才是實際契約。2026-08-04 定案：**範例才算數、改規格**。
//
// 這組測試把「規格」與「範例」綁在一起——只改其中一邊就會紅。
describe('topicTags 規格與範例必須自洽', () => {
  // 抽出 prompt 裡所有 `topicTags: [...]` 範例的實際值
  function exampleTags(): string[] {
    const p = buildEntitySummaryPrompt()
    return [...p.matchAll(/topicTags:\s*\[([^\]]*)\]/g)]
      .flatMap(m => (m[1] ?? '').split(','))
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(s => s.length > 0)
  }

  it('範例確實抓得到（正則沒有失效）', () => {
    expect(exampleTags().length).toBeGreaterThanOrEqual(9)
  })

  it('每個範例 tag 都是小寫 kebab-case', () => {
    for (const tag of exampleTags())
      expect(tag, `範例 tag「${tag}」不是小寫 kebab-case`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('規格本身明說 kebab-case', () => {
    expect(buildEntitySummaryPrompt()).toMatch(/kebab-case/)
  })

  // 這條是本 issue 的核心：舊規格的字數上限會把自己的範例全部判成違規。
  it('不得再出現與範例矛盾的字數上限', () => {
    const p = buildEntitySummaryPrompt()
    const longest = Math.max(...exampleTags().map(t => t.length))
    const limits = [...p.matchAll(/<\s*(\d+)\s*字/g)].map(m => Number(m[1]))
    for (const limit of limits)
      expect(limit, `prompt 寫了「< ${limit} 字」但自己的範例最長是 ${longest}`).toBeGreaterThan(longest)
  })
})
