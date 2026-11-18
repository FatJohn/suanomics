import type { CorpusRefreshResult } from './corpus-worker.js'
import { describe, expect, it } from 'vitest'
import { exitCodeFor, parseCorpusRefreshArgs } from './corpus-refresh.args.js'

describe('parseCorpusRefreshArgs', () => {
  it('沒有參數 → 全部來源、不 force', () => {
    expect(parseCorpusRefreshArgs([])).toEqual({ force: false })
  })

  it('--source 可重複、--force 開啟', () => {
    expect(parseCorpusRefreshArgs(['--', '--source', 'fsc-news', '--source', 'cbc-press', '--force']))
      .toEqual({ sourceSlugs: ['fsc-news', 'cbc-press'], force: true })
  })

  it('未知參數直接報錯，不默默忽略', () => {
    expect(() => parseCorpusRefreshArgs(['--sources', 'x'])).toThrow(/未知參數/)
  })

  it('--source 沒給值 → 報錯', () => {
    expect(() => parseCorpusRefreshArgs(['--source'])).toThrow(/--source/)
  })
})

function result(perSource: Array<{ slug: string, fetchFailed: boolean }>): CorpusRefreshResult {
  return {
    insertedCount: 0,
    skippedCount: 0,
    reusedEnrichmentCount: 0,
    enrichmentFailedCount: 0,
    notEnrichableCount: 0,
    failedSources: perSource.filter(s => s.fetchFailed).map(s => s.slug),
    perSource: perSource.map(s => ({ ...s, inserted: 0, skipped: 0, reused: 0, enrichmentFailed: 0, notEnrichable: 0 })),
  }
}

describe('exitCodeFor', () => {
  // 單一來源偶發失敗（例如 feed 暫時 404）不該讓整步變紅；全部失敗才是環境或網路壞了。
  it('部分來源失敗 → 0', () => {
    expect(exitCodeFor(result([{ slug: 'a', fetchFailed: true }, { slug: 'b', fetchFailed: false }]))).toBe(0)
  })

  it('全部來源失敗 → 1', () => {
    expect(exitCodeFor(result([{ slug: 'a', fetchFailed: true }, { slug: 'b', fetchFailed: true }]))).toBe(1)
  })

  // 沒有任何啟用來源代表 seed 沒跑或全被 config 驗證擋掉，背景庫不會再更新，要看得見。
  it('沒有任何來源 → 1', () => {
    expect(exitCodeFor(result([]))).toBe(1)
  })
})
