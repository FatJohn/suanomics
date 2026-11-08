import { eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../client.js'
import { dailyBriefs, sourceFetchResults } from '../schema.js'
import { getDailyBriefByDate, getDailyBriefsForDates, getLatestDailyBrief, getRecentBriefSummaries, listDailyBriefDates, saveDailyBrief, saveIncompleteDailyBrief } from './news-repo.js'
import { getSourceFetchHistory, recordSourceFetchResults } from './source-fetch-repo.js'

const DATE_A = '2096-03-01'
const DATE_B = '2096-03-02'
const SLUG = 'orch25-source'

async function cleanup(): Promise<void> {
  await getDb().delete(dailyBriefs).where(inArray(dailyBriefs.briefDate, [DATE_A, DATE_B]))
  await getDb().delete(sourceFetchResults).where(like(sourceFetchResults.slug, 'orch25-%'))
}

describe('daily brief status', () => {
  beforeEach(cleanup)
  afterAll(cleanup)

  it('incomplete 寫入 status 與 progress，且 brief_json 留空', async () => {
    await saveIncompleteDailyBrief(DATE_A, [], { failedStage: 'editor', completedStages: ['ingest'] })
    expect(await getDailyBriefByDate(DATE_A)).toMatchObject({ status: 'incomplete', briefJson: null, progress: { failedStage: 'editor' } })
  })

  it('incomplete 不覆蓋已存在的完整 brief', async () => {
    await saveDailyBrief(DATE_A, [], 'ok', { headline: 'H' })
    await saveIncompleteDailyBrief(DATE_A, [], { failedStage: 'editor' })
    expect(await getDailyBriefByDate(DATE_A)).toMatchObject({ status: 'complete', summary: 'ok', progress: null })
  })

  it('完整 brief 覆蓋 incomplete 時清掉 progress', async () => {
    await saveIncompleteDailyBrief(DATE_A, [], { failedStage: 'editor' })
    await saveDailyBrief(DATE_A, [], 'ok', { headline: 'H' })
    expect(await getDailyBriefByDate(DATE_A)).toMatchObject({ status: 'complete', progress: null })
  })

  it('最新一筆跳過 incomplete', async () => {
    await saveDailyBrief(DATE_A, [], 'ok', { headline: 'H' })
    await saveIncompleteDailyBrief(DATE_B, [], {})
    expect((await getLatestDailyBrief())?.briefDate).not.toBe(DATE_B)
  })

  it('日期清單排除 incomplete', async () => {
    await saveDailyBrief(DATE_A, [], 'ok', { headline: 'H' })
    await saveIncompleteDailyBrief(DATE_B, [], {})
    const dates = await listDailyBriefDates()
    expect(dates).toContain(DATE_A)
    expect(dates).not.toContain(DATE_B)
  })

  it('指定日期查詢排除 incomplete', async () => {
    await saveDailyBrief(DATE_A, [], 'ok', { headline: 'H' })
    await saveIncompleteDailyBrief(DATE_B, [], {})
    const rows = await getDailyBriefsForDates([DATE_A, DATE_B])
    expect(rows.map(r => r.briefDate)).toEqual([DATE_A])
  })

  it('近日摘要排除 incomplete', async () => {
    await saveDailyBrief(DATE_A, [], 'ok', { headline: 'H' })
    await saveIncompleteDailyBrief(DATE_B, [], {})
    const dates = (await getRecentBriefSummaries(3, '2096-03-03')).map(b => b.briefDate)
    expect(dates).toEqual([DATE_A])
  })

  it('同日重跑覆寫來源結果，歷史依日期新到舊', async () => {
    await recordSourceFetchResults(DATE_A, [{ slug: SLUG, failed: true, httpStatus: 500 }])
    await recordSourceFetchResults(DATE_B, [{ slug: SLUG, failed: true, httpStatus: 403 }])
    await recordSourceFetchResults(DATE_B, [{ slug: SLUG, failed: false, httpStatus: null }])
    const rows = await getDb().select().from(sourceFetchResults).where(eq(sourceFetchResults.slug, SLUG))
    expect(rows).toHaveLength(2)
    expect((await getSourceFetchHistory(DATE_A)).get(SLUG)).toEqual([
      { runDate: DATE_B, failed: false, httpStatus: null },
      { runDate: DATE_A, failed: true, httpStatus: 500 },
    ])
  })
})
