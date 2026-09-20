import type { MarketBrief } from '@suanomics/shared'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCompliance, MarketBriefSchema } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { listCanaryDates, loadCanarySources } from './canary-fixtures.js'
import { isValidEvalDate } from './date.js'

// 這支測試守的是 fixtures/canary-example 這個具體目錄，不是 CANARY_DIR——
// CANARY_DIR 在放了真實 fixtures 的機器上會指到真的那組（見 canary-fixtures.test.ts
// 對 resolveCanaryDir 的說明），這裡要驗的是公開 repo 一定會 clone 到的合成樣本本身。
const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), './fixtures/canary-example')

const dates = listCanaryDates(EXAMPLE_DIR)

function readRawBrief(date: string): unknown {
  return JSON.parse(readFileSync(resolve(EXAMPLE_DIR, date, 'brief.json'), 'utf8'))
}

describe('canary-example fixtures', () => {
  it('至少有兩天、且每個目錄名都是合法日期格式', () => {
    expect(dates.length).toBeGreaterThanOrEqual(2)
    for (const d of dates)
      expect(isValidEvalDate(d)).toBe(true)
  })

  it.each(dates)('%s：brief.json 通過 MarketBriefSchema', (date) => {
    const parsed = MarketBriefSchema.safeParse(readRawBrief(date))
    expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true)
  })

  it.each(dates)('%s：sources.json 每筆欄位齊全、contentText 至少 300 字元', (date) => {
    const rows = loadCanarySources(date, EXAMPLE_DIR)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.id).toBeTypeOf('number')
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.url.length).toBeGreaterThan(0)
      expect(r.publishedAt.length).toBeGreaterThan(0)
      expect(r.contentText.length).toBeGreaterThanOrEqual(300)
    }
  })

  it.each(dates)('%s：dailyThesis 與 viewpoints 都存在（否則 brief-canary 的 ablation 是 no-op）', (date) => {
    const raw = readRawBrief(date) as { dailyThesis?: unknown, viewpoints?: unknown }
    expect(raw.dailyThesis).toBeTruthy()
    expect(raw.viewpoints).toBeTruthy()
  })

  it.each(dates)('%s：headline+summary+dailyThesis+narrative+viewpoints 全文通過 compliance gate', (date) => {
    const brief: MarketBrief = MarketBriefSchema.parse(readRawBrief(date))
    const narrativeText = brief.narrative
      ? [brief.narrative.intro, ...brief.narrative.sections.flatMap(s => [s.heading, s.body, s.takeaway ?? '']), brief.narrative.outro].join('\n')
      : ''
    const viewpointsText = brief.viewpoints
      ? [...brief.viewpoints.supportPoints, ...brief.viewpoints.riskPoints, brief.viewpoints.netRead].join('\n')
      : ''
    const fullText = [brief.headline, brief.summary, brief.dailyThesis ?? '', narrativeText, viewpointsText].join('\n')
    expect(checkCompliance(fullText)).toBeNull()
  })

  it('所有 sources 的 url 與 citations 的 url 都以 https://example.com/ 開頭', () => {
    for (const date of dates) {
      for (const r of loadCanarySources(date, EXAMPLE_DIR))
        expect(r.url.startsWith('https://example.com/')).toBe(true)
      const brief = readRawBrief(date) as { citations: { url: string }[] }
      for (const c of brief.citations)
        expect(c.url.startsWith('https://example.com/')).toBe(true)
    }
  })
})
