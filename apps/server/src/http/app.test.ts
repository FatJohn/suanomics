import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'

// route 層的限流測試是自己建 limiter 再注入的，守不到「createApp 有沒有真的把
// limiter 接上去」——那條線斷掉時 route 測試照樣全綠，而正式跑起來的 app 完全沒有限流。
describe('createApp analyze rate limit wiring', () => {
  const analyzeBody = JSON.stringify({ title: '測試標題', content: '內文超過二十字的測試內容 ABCDEFGHIJ' })
  const jsonHeaders = { 'content-type': 'application/json' }

  afterEach(() => {
    delete process.env.ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN
    delete process.env.ANALYZE_RATE_LIMIT_GLOBAL_PER_HOUR
  })

  function buildApp() {
    const enqueue = vi.fn(async () => ({ auditId: 'audit-1', status: 'queued' as const }))
    const app = createApp({ enqueue: enqueue as never, runner: { stats: vi.fn() } as never })
    const post = () => app.request('/api/brief/analyze', { method: 'POST', body: analyzeBody, headers: jsonHeaders })
    return { enqueue, post }
  }

  it('applies the per-client limit read from env', async () => {
    process.env.ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN = '1'
    const { enqueue, post } = buildApp()

    expect((await post()).status).toBe(202)
    expect((await post()).status).toBe(429)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('applies the global limit read from env', async () => {
    process.env.ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN = '0'
    process.env.ANALYZE_RATE_LIMIT_GLOBAL_PER_HOUR = '2'
    const { enqueue, post } = buildApp()

    expect((await post()).status).toBe(202)
    expect((await post()).status).toBe(202)
    expect((await post()).status).toBe(429)
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it('lets every request through when both layers are disabled with 0', async () => {
    process.env.ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN = '0'
    process.env.ANALYZE_RATE_LIMIT_GLOBAL_PER_HOUR = '0'
    const { enqueue, post } = buildApp()

    for (let i = 0; i < 8; i += 1)
      expect((await post()).status).toBe(202)
    expect(enqueue).toHaveBeenCalledTimes(8)
  })
})
