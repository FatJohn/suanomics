import { inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../client.js'
import { dailyBriefs, shadowBriefs } from '../schema.js'
import { saveDailyBrief, saveIncompleteDailyBrief } from './news-repo.js'
import { getShadowBrief, getShadowSource, runInputsHash, saveShadowBrief } from './shadow-briefs-repo.js'

const DATE_A = '2093-07-01'
const DATE_B = '2093-07-02'

async function cleanup(): Promise<void> {
  await getDb().delete(dailyBriefs).where(inArray(dailyBriefs.briefDate, [DATE_A, DATE_B]))
  await getDb().delete(shadowBriefs).where(inArray(shadowBriefs.briefDate, [DATE_A, DATE_B]))
}

describe('shadow briefs repo', () => {
  beforeEach(cleanup)
  afterAll(cleanup)

  it('complete brief 帶 run_inputs 時讀得回來', async () => {
    await saveDailyBrief(DATE_A, [3, 4], 'ok', { headline: 'H' }, { version: 1, market: {} })
    expect(await getShadowSource(DATE_A)).toEqual({ selectedNewsIds: [3, 4], runInputs: { version: 1, market: {} } })
  })

  it('重跑沒給 run_inputs 時清成 null，不留上一次的輸入', async () => {
    await saveDailyBrief(DATE_A, [3], 'ok', { headline: 'H' }, { version: 1 })
    await saveDailyBrief(DATE_A, [3], 'ok', { headline: 'H' })
    expect(await getShadowSource(DATE_A)).toEqual({ selectedNewsIds: [3], runInputs: null })
  })

  it('沒有 complete brief 時回 null', async () => {
    await saveIncompleteDailyBrief(DATE_B, [], {})
    expect(await getShadowSource(DATE_A)).toBeNull()
    expect(await getShadowSource(DATE_B)).toBeNull()
  })

  it('影子報告依日期與 variant 存取，重存覆蓋同一列', async () => {
    await saveShadowBrief(DATE_A, 'no-corpus', [1], { headline: 'v1' }, 'h1')
    const id = await saveShadowBrief(DATE_A, 'no-corpus', [2], { headline: 'v2' }, 'h2')
    expect(await getShadowBrief(DATE_A, 'no-corpus')).toEqual({ id, selectedNewsIds: [2], briefJson: { headline: 'v2' }, inputsHash: 'h2' })
    expect(await getShadowBrief(DATE_A, 'other')).toBeNull()
    expect(await getShadowBrief(DATE_B, 'no-corpus')).toBeNull()
  })

  it('影子報告不碰 daily_briefs', async () => {
    await saveShadowBrief(DATE_A, 'no-corpus', [1], { headline: 'v1' }, 'h1')
    expect(await getDb().select().from(dailyBriefs).where(inArray(dailyBriefs.briefDate, [DATE_A]))).toEqual([])
  })

  it('run_inputs 經過 jsonb 來回後 hash 不變，內容不同則不同', async () => {
    // jsonb 依鍵長度重排：寫入時 version 在 editor 前、bb 在 a 前，讀回來順序不同。
    const inputs = { version: 1, market: { bb: 1, a: [2] }, editor: { news: [] } }
    await saveDailyBrief(DATE_A, [3], 'ok', { headline: 'H' }, inputs)
    const stored = (await getShadowSource(DATE_A))?.runInputs
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(inputs))
    expect(runInputsHash(stored)).toBe(runInputsHash(inputs))
    expect(runInputsHash(stored)).not.toBe(runInputsHash({ ...inputs, version: 2 }))
  })
})
