import { JOB_KINDS } from '@suanomics/jobs'
import { describe, expect, it } from 'vitest'
import { concurrencyEnvFor, JOB_SPECS, resolveConcurrency } from './specs.js'

describe('jOB_SPECS 完整性', () => {
  // 漏一個 kind ＝ 那個 kind 的 job 完全沒有 handler 在消費，只會靜靜堆在 runner 佇列裡。
  // 這條在 runner 註冊處是一行的存在與否，沒有東西擋。
  it('每個 job kind 都有 spec', () => {
    const declared = JOB_SPECS.map(s => s.kind).sort()
    expect(declared).toEqual([...JOB_KINDS].sort())
  })

  it('沒有重複註冊', () => {
    expect(new Set(JOB_SPECS.map(s => s.kind)).size).toBe(JOB_SPECS.length)
  })

  // 逐 kind 釘死整張表，而不是只斷言 `> 0`：併發值是行為（corpus-refresh 與 news-refresh
  // 各 2 條、其餘序列跑），把 2 改成 1 或把 1 改成 4 在只驗正整數的斷言下不會紅。
  it('併發預設逐 kind 釘死', () => {
    const table = Object.fromEntries(JOB_SPECS.map(s => [s.kind, s.defaultConcurrency]))
    expect(table).toEqual({
      'corpus-refresh': 2,
      'news-refresh': 2,
      'analyze': 1,
      'daily-brief': 1,
      'podcast-generate': 1,
      'podcast-tts': 1,
      'prompt-refresh': 1,
      'market-data-refresh': 1,
    })
  })
})

describe('concurrencyEnvFor', () => {
  /**
   * 逐條釘住推導結果 ＝ 這些名字是 prod 已經在用的環境變數。
   * 推導規則改壞的話，env 會靜默失效、worker 全部回退成預設併發，而沒有任何錯誤訊息。
   */
  it.each([
    ['corpus-refresh', 'CORPUS_REFRESH_CONCURRENCY'],
    ['analyze', 'ANALYZE_CONCURRENCY'],
    ['daily-brief', 'DAILY_BRIEF_CONCURRENCY'],
    ['podcast-generate', 'PODCAST_GENERATE_CONCURRENCY'],
    ['podcast-tts', 'PODCAST_TTS_CONCURRENCY'],
    ['news-refresh', 'NEWS_REFRESH_CONCURRENCY'],
    ['prompt-refresh', 'PROMPT_REFRESH_CONCURRENCY'],
    ['market-data-refresh', 'MARKET_DATA_REFRESH_CONCURRENCY'],
  ] as const)('%s → %s', (kind, expected) => {
    expect(concurrencyEnvFor(kind)).toBe(expected)
  })
})

describe('resolveConcurrency', () => {
  const spec = { kind: 'analyze', defaultConcurrency: 3 } as const

  it('沒設環境變數時用預設', () => {
    expect(resolveConcurrency(spec, {})).toBe(3)
  })

  it('設了合法值就採用', () => {
    expect(resolveConcurrency(spec, { ANALYZE_CONCURRENCY: '5' })).toBe(5)
  })

  // 打錯值不該讓 worker 以 0 併發啟動（那等於整個 queue 停擺、而且沒有錯誤訊息）
  it.each(['0', '-1', 'abc', ''])('非正整數 %o 回退到預設', (raw) => {
    expect(resolveConcurrency(spec, { ANALYZE_CONCURRENCY: raw })).toBe(3)
  })
})
