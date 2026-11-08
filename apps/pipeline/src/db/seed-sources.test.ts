import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectHttpUrls } from './source-policy.js'
import { EXTERNAL_SOURCES_SEED } from './seed-external-sources.js'
import { SEED } from './seed.js'

const doc = readFileSync(new URL('../../../../docs/sources.md', import.meta.url), 'utf-8')
const dataRows = doc.split('\n').filter(line => line.startsWith('|') && !/^\|[-|\s]+\|$/.test(line) && !line.startsWith('| 名稱') && !line.startsWith('| 用法'))
  .filter(line => !/^\| (正文|前言|標題連結) \|/.test(line))

function rowFor(url: string): string | undefined {
  return dataRows.find(line => line.split('|').some(cell => cell.trim() === url))
}

describe('docs/sources.md', () => {
  it('每一行都有 https 條款連結', () => {
    expect(dataRows.length).toBeGreaterThan(20)
    for (const row of dataRows)
      expect(row.match(/https:\/\//g)?.length ?? 0, row).toBeGreaterThanOrEqual(1)
  })

  it('news_sources 每筆 feed 都在表內，且 URL 之外另有條款連結', () => {
    for (const { slug, rssUrl } of SEED) {
      const row = rowFor(rssUrl)
      expect(row, `${slug} 不在 docs/sources.md`).toBeDefined()
      expect(row?.match(/https:\/\//g)?.length ?? 0, slug).toBeGreaterThanOrEqual(2)
    }
  })

  it('external_sources 每筆 URL 都在表內', () => {
    for (const source of EXTERNAL_SOURCES_SEED) {
      for (const url of collectHttpUrls(source.config))
        expect(rowFor(url), `${source.slug} ${url} 不在 docs/sources.md`).toBeDefined()
    }
  })

  it('不接清單裡的網域不得出現在 seed', () => {
    const banned = ['bbc.co', 'aljazeera', 'nhk.or.jp', 'technews.tw', 'yahoo.com', 'eia.gov', 'ltn.com.tw', 'oilprice', 'cnbc', 'nextapple', 'udn.com', 'ctee', 'news.google.com', 'rsshub']
    const urls = [...SEED.map(s => s.rssUrl), ...EXTERNAL_SOURCES_SEED.flatMap(s => collectHttpUrls(s.config))]
    for (const url of urls) {
      for (const domain of banned)
        expect(url.includes(domain), `${url} 含 ${domain}`).toBe(false)
    }
  })
})
