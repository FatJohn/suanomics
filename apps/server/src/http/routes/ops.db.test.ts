import { closeDb } from '@suanomics/db/client'
import { getStorylineActivity } from '@suanomics/db/repos/storyline-activity'
import { afterAll, describe, expect, it } from 'vitest'
import { opsRoute } from './ops.js'

// 真 DB 整合測試，**刻意不 mock 任何 repo**。ops.test.ts 把三個 repo 都 mock 掉，
// 所以 2026-08-21 那次事故（getSourceActivity 的日期參數在真 driver 上炸、端點連續
// 四天 500、daily-brief 與外部監控一起停擺）在 CI 全綠的情況下溜進 prod。
// 這支的職責就一個：這條 route 端到端打真 Postgres 時要回得出排程觸發方讀得懂的 JSON。
// 來源分類本身的正確性由 packages/db 的 articles-repo.db.test.ts（真 DB）與
// packages/shared 的 source-silence.test.ts 顧，這裡不重複。

interface StatusBody {
  generatedAt: string
  days: Array<{
    date: string
    expected: string
    ok: boolean
    claims: { total: number, grounded: number } | null
    storylines: { touched: number, usable: number }
  }>
  storylines: { open: number, total: number }
  sources: { windowDays: number, silent: string[], never: string[], neverUnexpected: string[], zeroUsable: string[], usability: unknown[] }
  newsSources: { windowDays: number, silent: string[], never: string[], neverUnexpected: string[], zeroUsable: string[], usability: unknown[] }
}

describe('gET /ops/publication-status (real DB)', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('returns 200 with a JSON body a daily scheduler can parse', async () => {
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-17')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = await res.json() as StatusBody
    // 排程觸發方常見的第一步是 `jq -r '.days[0].expected'`；這裡斷言的就是那一條路徑
    expect(body.days).toHaveLength(1)
    expect(['weekday-brief', 'weekend-recap', 'skip']).toContain(body.days[0]?.expected)
    expect(typeof body.generatedAt).toBe('string')
  })

  // 日報來源那組走的是另一支 repo 函式（getNewsSourceActivity）、另一張表，
  // 而 ops.test.ts 把它 mock 掉了。這一條是它在真 driver 上跑得起來的唯一證據——
  // 理由與本檔存在的理由完全相同（見檔頭）。
  it('answers with the news-source block too (different table, different repo fn)', async () => {
    const body = await (await opsRoute.request('/ops/publication-status?date=2026-07-17')).json() as StatusBody
    expect(typeof body.newsSources.windowDays).toBe('number')
    for (const key of ['silent', 'never', 'neverUnexpected', 'zeroUsable', 'usability'] as const)
      expect(Array.isArray(body.newsSources[key]), `newsSources.${key}`).toBe(true)
    // corpus 那組新增的兩個欄位同樣要在真 DB 路徑上存在
    expect(Array.isArray(body.sources.zeroUsable)).toBe(true)
    expect(Array.isArray(body.sources.usability)).toBe(true)
  })

  it('answers with the source-silence block, which is what the 500 came from', async () => {
    const body = await (await opsRoute.request('/ops/publication-status?date=2026-07-17')).json() as StatusBody
    expect(body.sources.windowDays).toBeGreaterThan(0)
    expect(Array.isArray(body.sources.silent)).toBe(true)
    expect(Array.isArray(body.sources.never)).toBe(true)
    // neverUnexpected 是「預期外從未產出的來源」那類檢查要讀的欄位。
    // 它若是 undefined，用 jq `// []` 讀的監控會把它吃成空陣列——也就是**告警靜默失效**，
    // 而端點仍然 200、單元測試仍然全綠。所以要在真 DB 這一層釘住它存在。
    expect(Array.isArray(body.sources.neverUnexpected)).toBe(true)
  })

  it('still answers when days is expanded across the whole window', async () => {
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-17&days=7')
    expect(res.status).toBe(200)
    expect((await res.json() as StatusBody).days).toHaveLength(7)
  })
})

// claim ledger 與敘事線兩組新訊號。前者純算 briefJson、後者要真的讀 storylines
// 的 jsonb 陣列——ops.test.ts 把 getStorylineActivity 整支 mock 掉了，所以那邊全綠只證明
// 我對回傳形狀的想像自洽。這一支要的就是「這條 route 端到端打真 Postgres 時不會 500、
// 而且回得出排程觸發方的 jq 讀得懂的數字」，那正是 2026-08-21 那次唯一漏掉的東西。
//
// 逐日計數的語意由 packages/db 的 storyline-activity.db.test.ts（真 DB、有 seed）顧，
// 這裡不重複——那條路徑已經被驗過了，在這裡再 seed 一次只是把同一組斷言寫兩遍。
describe('gET /ops/publication-status 的內容旗標訊號（real DB）', () => {
  it('days[] 帶 claims 與 storylines 兩個鍵，top level 帶 storylines 池子狀態', async () => {
    const body = await (await opsRoute.request('/ops/publication-status?date=2026-07-17')).json() as StatusBody
    const day = body.days[0]
    expect(day).toHaveProperty('claims')
    expect(day).toHaveProperty('storylines')
    expect(typeof day?.storylines.touched).toBe('number')
    expect(typeof day?.storylines.usable).toBe('number')
    expect(typeof body.storylines.open).toBe('number')
    expect(typeof body.storylines.total).toBe('number')
  })

  it('days 展開時每一天都有 storylines，不會只填第一天', async () => {
    const body = await (await opsRoute.request('/ops/publication-status?date=2026-07-17&days=5')).json() as StatusBody
    expect(body.days).toHaveLength(5)
    for (const d of body.days)
      expect(typeof d.storylines.touched).toBe('number')
  })

  it('route 回的逐日數字與直接呼叫 repo 一致（真資料、不 seed）', async () => {
    const dates = ['2026-07-17', '2026-07-16', '2026-07-15']
    const body = await (await opsRoute.request('/ops/publication-status?date=2026-07-17&days=3')).json() as StatusBody
    const direct = await getStorylineActivity(dates)
    expect(body.days.map(d => d.storylines)).toEqual(dates.map(d => direct.byDate[d]))
    expect(body.storylines).toEqual({ open: direct.open, total: direct.total })
  })
})
