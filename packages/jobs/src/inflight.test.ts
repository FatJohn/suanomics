import { describe, expect, it } from 'vitest'
import { inflightAgeMs, isOrphanedInflight, orphanErrorMessage } from './inflight.js'
import { JOB_INFLIGHT_STALENESS_MS, JOB_KINDS } from './types.js'

const NOW = new Date('2026-08-22T12:00:00.000Z').getTime()

function ago(minutes: number): Date {
  return new Date(NOW - minutes * 60_000)
}

describe('jOB_INFLIGHT_STALENESS_MS', () => {
  it('每個 JobKind 都有值（漏一個就等於那個 kind 的孤兒永遠不會被回收）', () => {
    for (const kind of JOB_KINDS)
      expect(JOB_INFLIGHT_STALENESS_MS[kind]).toBeGreaterThan(0)
    expect(Object.keys(JOB_INFLIGHT_STALENESS_MS).sort()).toEqual([...JOB_KINDS].sort())
  })

  // 2026-08-22 對 prod 量到的 90 天最大值（秒）。窗必須明顯大於它，否則正在跑的 job
  // 會被自己人判成孤兒、去重再度失效。prompt-refresh 無樣本故不在表內。
  it('每個 kind 的窗都大於 prod 實測最大執行時間', () => {
    const measuredMaxSeconds: Partial<Record<string, number>> = {
      'news-refresh': 2060,
      'corpus-refresh': 1515,
      'daily-brief': 366,
      'podcast-tts': 346,
      'analyze': 185,
      'market-data-refresh': 167,
      'podcast-generate': 68,
    }
    for (const [kind, maxSeconds] of Object.entries(measuredMaxSeconds))
      expect(JOB_INFLIGHT_STALENESS_MS[kind as keyof typeof JOB_INFLIGHT_STALENESS_MS]).toBeGreaterThan(maxSeconds * 1000)
  })

  // 舊的全域常數。留這條是為了讓「回到單一 5 分鐘窗」這件事會紅。
  it('沒有任何 kind 退回舊的 5 分鐘窗', () => {
    for (const kind of JOB_KINDS)
      expect(JOB_INFLIGHT_STALENESS_MS[kind]).toBeGreaterThan(5 * 60 * 1000)
  })
})

describe('inflightAgeMs', () => {
  it('有 startedAt 時量的是執行時間，不是含排隊的總時長', () => {
    // concurrency=1 的 kind 排在後面的 job：建立於 40 分鐘前、5 分鐘前才輪到它跑。
    const row = { jobKind: 'daily-brief' as const, createdAt: ago(40), startedAt: ago(5) }
    expect(inflightAgeMs(row, NOW)).toBe(5 * 60_000)
    expect(isOrphanedInflight(row, NOW)).toBe(false)
  })

  it('queued row 沒有 startedAt，量到的是等待時間', () => {
    const row = { jobKind: 'analyze' as const, createdAt: ago(20), startedAt: null }
    expect(inflightAgeMs(row, NOW)).toBe(20 * 60_000)
  })

  it('兩個時間都缺就回 0（不得把資料不全的 row 當孤兒殺掉）', () => {
    expect(inflightAgeMs({ jobKind: 'analyze' }, NOW)).toBe(0)
    expect(isOrphanedInflight({ jobKind: 'analyze' }, NOW)).toBe(false)
  })
})

describe('isOrphanedInflight', () => {
  it('analyze 跑 10 分鐘還不算孤兒、跑 20 分鐘算', () => {
    expect(isOrphanedInflight({ jobKind: 'analyze', startedAt: ago(10) }, NOW)).toBe(false)
    expect(isOrphanedInflight({ jobKind: 'analyze', startedAt: ago(20) }, NOW)).toBe(true)
  })

  // 這條就是 already-inflight 去重的核心：舊的 5 分鐘窗會把跑到一半的 news-refresh 判成孤兒，
  // 於是同 payload 再打一次會併跑第二份。
  it('news-refresh 跑 35 分鐘仍不是孤兒（舊的 5 分鐘窗在這裡失效）', () => {
    expect(isOrphanedInflight({ jobKind: 'news-refresh', startedAt: ago(35) }, NOW)).toBe(false)
    expect(isOrphanedInflight({ jobKind: 'news-refresh', startedAt: ago(95) }, NOW)).toBe(true)
  })

  it('窗是逐 kind 的：同樣跑 20 分鐘，analyze 是孤兒、corpus-refresh 不是', () => {
    expect(isOrphanedInflight({ jobKind: 'analyze', startedAt: ago(20) }, NOW)).toBe(true)
    expect(isOrphanedInflight({ jobKind: 'corpus-refresh', startedAt: ago(20) }, NOW)).toBe(false)
  })
})

describe('orphanErrorMessage', () => {
  it('寫得出這不是 job 自己失敗的，而且帶得出活了多久', () => {
    const msg = orphanErrorMessage({ jobKind: 'analyze', createdAt: ago(42) }, NOW)
    expect(msg).toContain('orphaned')
    expect(msg).toContain('42m')
  })
})
