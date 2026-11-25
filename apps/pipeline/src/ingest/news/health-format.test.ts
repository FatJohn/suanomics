import type { SourceHealth } from './health.js'
import { describe, expect, it } from 'vitest'
import { formatNewsHealthReport } from './health-format.js'

const NOW = new Date('2026-08-28T12:00:00Z')

function row(over: Partial<SourceHealth> = {}): SourceHealth {
  return {
    slug: 'cna',
    displayName: '中央社財經',
    isActive: true,
    isProxy: false,
    totalItems: 100,
    inWindow: 12,
    usable: 10,
    byContentSource: { 'scrape': 8, 'rss-excerpt': 4 },
    bodyLenP50: 688,
    bodyLenP90: 1200,
    latestPublishedAt: new Date('2026-08-28T02:00:00Z'),
    stalenessDays: 0,
    flags: [],
    ...over,
  }
}

/**
 * 取某個來源那一列、切成欄位陣列。
 *
 * ★ 斷言一定要對**整列的欄位序列**，不是 `toContain('12')` 那種子字串比對——
 * 後者在這張表上鬆到形同沒驗：`'100'` 涵蓋 `'10'`、`'1200'` 涵蓋 `'12'`，
 * 把「可用」整欄刪掉五條斷言仍然全綠（2026-08-28 驗收實際做過這個變異測試）。
 */
function cellsFor(out: string, slug: string): string[] {
  const line = out.split('\n').find(l => l.trimStart().startsWith(slug)) ?? ''
  return line.trim().split(/\s+/)
}

describe('formatNewsHealthReport', () => {
  it('每個來源一列，欄位序列固定（刪掉或換位任一欄都要紅）', () => {
    const out = formatNewsHealthReport([row()], { windowDays: 7, now: NOW })
    expect(cellsFor(out, 'cna')).toEqual([
      'cna',
      'ok',
      '100',
      '12',
      '10',
      '8',
      '4',
      '688',
      '1200',
      '2026-08-28',
      '0',
    ])
  })

  it('標頭寫明窗長與 now（報告離開終端機之後還讀得懂）', () => {
    const out = formatNewsHealthReport([row()], { windowDays: 7, now: NOW })
    expect(out).toContain('近 7 天')
    expect(out).toContain('now=2026-08-28T12:00:00.000Z')
  })

  // ★ positive control：什麼都沒驗到與全部通過的輸出不可以長得一樣（同 `/api/ops/publication-status`
  // 對 corpus 那組立的規矩）。指錯 DATABASE_URL 打到空庫會印「沒有來源被標記」，
  // 沒有這行就會被讀成全綠。
  it('印出實際檢查了幾個來源，空庫與全綠不會長得一樣', () => {
    const many = formatNewsHealthReport([row(), row({ slug: 'eia' })], { windowDays: 7, now: NOW })
    const none = formatNewsHealthReport([], { windowDays: 7, now: NOW })
    expect(many).toContain('檢查 2 個來源')
    expect(none).toContain('檢查 0 個來源')
    expect(many).not.toBe(none)
  })

  it('停用來源看得出來、且不與啟用來源混淆', () => {
    const out = formatNewsHealthReport([row({ slug: 'anue', isActive: false })], { windowDays: 7, now: NOW })
    expect(cellsFor(out, 'anue')[1]).toBe('off')
  })

  it('代理來源標出來（它的可用數天生是 0、不標會被讀成故障）', () => {
    const out = formatNewsHealthReport([row({ slug: 'wsj-markets', isProxy: true })], { windowDays: 7, now: NOW })
    expect(cellsFor(out, 'wsj-markets')[1]).toBe('proxy')
  })

  it('沒有 pubDate 時 pubDate 與停更兩欄都是 -，不是 NaN 或 1970', () => {
    const out = formatNewsHealthReport(
      [row({ latestPublishedAt: null, stalenessDays: null })],
      { windowDays: 7, now: NOW },
    )
    const cells = cellsFor(out, 'cna')
    expect(cells[9]).toBe('-')
    expect(cells[10]).toBe('-')
  })

  it('旗標印在該列的最後幾欄', () => {
    const out = formatNewsHealthReport(
      [row({ slug: 'google-news-udn', flags: ['title-only', 'no-scrape'] })],
      { windowDays: 7, now: NOW },
    )
    expect(cellsFor(out, 'google-news-udn').slice(11)).toEqual(['title-only', 'no-scrape'])
  })

  it('結尾彙總只列有旗標的來源，健康的不出現在那一段', () => {
    const out = formatNewsHealthReport(
      [row({ slug: 'google-news-udn', flags: ['no-scrape'] }), row()],
      { windowDays: 7, now: NOW },
    )
    const summary = out.slice(out.indexOf('旗標：'))
    expect(summary).toContain('google-news-udn')
    expect(summary).not.toContain('cna')
    expect(summary).toContain('1/2')
  })

  it('全部健康時明說沒有旗標，不留空白讓人猜', () => {
    const out = formatNewsHealthReport([row()], { windowDays: 7, now: NOW })
    expect(out.slice(out.indexOf('旗標：'))).toContain('沒有來源被標記')
  })

  it('零來源不炸（新環境還沒 seed 就是這樣）', () => {
    expect(() => formatNewsHealthReport([], { windowDays: 7, now: NOW })).not.toThrow()
  })
})
