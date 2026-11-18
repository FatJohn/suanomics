import { inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../../src/db/client.js'
import { saveDailyBrief } from '../../src/db/repos/news-repo.js'
import { runInputsHash, saveShadowBrief } from '../../src/db/repos/shadow-briefs-repo.js'
import { dailyBriefs, shadowBriefs } from '../../src/db/schema.js'
import { loadShadowBrief } from './load-inputs.js'
import { makeBrief } from './test-brief.js'

const DATE = '2093-07-11'
const INPUTS = { version: 1, editor: { news: [] }, market: {} }

async function cleanup(): Promise<void> {
  await getDb().delete(dailyBriefs).where(inArray(dailyBriefs.briefDate, [DATE]))
  await getDb().delete(shadowBriefs).where(inArray(shadowBriefs.briefDate, [DATE]))
}

describe('loadShadowBrief（real DB）', () => {
  beforeEach(cleanup)
  afterAll(cleanup)

  it('影子報告的輸入與正式報告一致時讀得回來', async () => {
    await saveDailyBrief(DATE, [1], 'ok', makeBrief(), INPUTS)
    await saveShadowBrief(DATE, 'no-corpus', [1], makeBrief({ headline: '影子' }), runInputsHash(INPUTS))
    expect((await loadShadowBrief(DATE, 'no-corpus'))?.brief.headline).toBe('影子')
  })

  it('正式報告重跑換了輸入時拒評，不拿舊影子比新報告', async () => {
    await saveDailyBrief(DATE, [1], 'ok', makeBrief(), { ...INPUTS, market: { snapshotBlock: 'new' } })
    await saveShadowBrief(DATE, 'no-corpus', [1], makeBrief(), runInputsHash(INPUTS))
    await expect(loadShadowBrief(DATE, 'no-corpus')).rejects.toThrow('daily:shadow')
  })

  it('沒有影子報告時回 null', async () => {
    await saveDailyBrief(DATE, [1], 'ok', makeBrief(), INPUTS)
    expect(await loadShadowBrief(DATE, 'no-corpus')).toBeNull()
  })
})
