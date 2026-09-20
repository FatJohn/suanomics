import process from 'node:process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixedWindowLimiter } from '../rate-limit.js'

vi.mock('@suanomics/db/repos/news-repo', () => ({
  getNewsItemById: vi.fn(async () => null),
  getNewsItemsByIds: vi.fn(async () => []),
  getLatestAnalysis: vi.fn(async () => null),
  getLatestDailyBrief: vi.fn(async () => null),
  getDailyBriefByDate: vi.fn(async () => null),
  listDailyBriefDates: vi.fn(async () => []),
}))

vi.mock('@suanomics/db/repos/analyses-repo', () => ({
  getAnalysisById: vi.fn(async () => null),
}))

// Import AFTER mocks are set up
// eslint-disable-next-line import/first
import { createBriefRoute } from './brief.js'

// route 不再 import enqueue 單例、改由呼叫端注入，所以這裡也不必再 mock 整個 @suanomics/jobs。
const enqueueJob = vi.fn(async (_kind: string, _payload: Record<string, unknown>) => ({
  auditId: 'audit-abc-123',
  status: 'queued' as const,
}))
const briefRoute = createBriefRoute({ enqueue: enqueueJob as never })

describe('briefRoute POST /brief/analyze (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shouldReturn400WhenBodyMissingBothIdAndPaste', async () => {
    const res = await briefRoute.request('/brief/analyze', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('shouldReturn202WithAuditIdAndPollUrlOnEnqueue', async () => {
    const res = await briefRoute.request('/brief/analyze', {
      method: 'POST',
      body: JSON.stringify({ title: '測試標題', content: '內文超過二十字的測試內容 ABCDEFGHIJ' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(202)
    const json = await res.json() as { auditId: string, status: string, pollUrl: string }
    expect(json.auditId).toBe('audit-abc-123')
    expect(json.status).toBe('queued')
    expect(json.pollUrl).toBe('/api/jobs/audit-abc-123')
  })

  it('shouldPassPayloadToEnqueueJob', async () => {
    await briefRoute.request('/brief/analyze', {
      method: 'POST',
      body: JSON.stringify({
        title: '測試標題',
        content: '內文超過二十字的測試內容 ABCDEFGHIJ',
        url: 'https://example.com/news/1',
      }),
      headers: { 'content-type': 'application/json' },
    })
    // reportDate 由 route 在 enqueue 當下算好（台北曆日）往下傳，worker 與 agent 不得自行現算。
    expect(enqueueJob).toHaveBeenCalledWith('analyze', {
      title: '測試標題',
      content: '內文超過二十字的測試內容 ABCDEFGHIJ',
      url: 'https://example.com/news/1',
      reportDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it('shouldOmitUrlFromPayloadWhenNotProvided', async () => {
    await briefRoute.request('/brief/analyze', {
      method: 'POST',
      body: JSON.stringify({ title: '測試標題', content: '內文超過二十字的測試內容 ABCDEFGHIJ' }),
      headers: { 'content-type': 'application/json' },
    })
    // eslint-disable-next-line ts/no-non-null-assertion -- test fixture guarantees enqueueJob was called once
    const call = enqueueJob.mock.calls[0]!
    expect(call[1]).not.toHaveProperty('url')
  })

  it('shouldReturn404WhenNewsItemIdNotFound', async () => {
    const res = await briefRoute.request('/brief/analyze', {
      method: 'POST',
      body: JSON.stringify({ newsItemId: 999 }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(404)
  })

  it('shouldPassNewsItemIdToEnqueuePayloadWhenNewsFound', async () => {
    const { getNewsItemById } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getNewsItemById).mockResolvedValueOnce({
      id: 42,
      title: '台積電動能延續',
      contentText: '產業動能延續、外資看多後市、評價趨勢評估維持高檔',
      url: 'https://news.example.com/42',
    } as never)

    await briefRoute.request('/brief/analyze', {
      method: 'POST',
      body: JSON.stringify({ newsItemId: 42 }),
      headers: { 'content-type': 'application/json' },
    })

    expect(enqueueJob).toHaveBeenCalledWith('analyze', expect.objectContaining({ newsItemId: 42 }))
  })

  it('shouldReturn503WhenEnqueueThrows', async () => {
    // 模擬 audit insert 失敗
    enqueueJob.mockRejectedValueOnce(new Error('audit insert failed'))
    const res = await briefRoute.request('/brief/analyze', {
      method: 'POST',
      body: JSON.stringify({ title: '測試標題', content: '內文超過二十字的測試內容 ABCDEFGHIJ' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(503)
    const json = await res.json() as { error: string, detail: string }
    expect(json.error).toBe('enqueue_failed')
    expect(json.detail).toContain('audit insert failed')
  })
})

// 沒有傳 analyzeLimiter 時（上面整組測試都是這樣建的 briefRoute）行為必須與加入
// 限流之前完全相同，這裡另外用注入了 limiter 的 route 驗證限流本身的行為。
describe('briefRoute POST /brief/analyze rate limiting', () => {
  const analyzeBody = JSON.stringify({ title: '測試標題', content: '內文超過二十字的測試內容 ABCDEFGHIJ' })
  const jsonHeaders = { 'content-type': 'application/json' }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TRUST_PROXY
  })

  it('blocks the 3rd request per client within the window and sets Retry-After', async () => {
    const limitedRoute = createBriefRoute({
      enqueue: enqueueJob,
      analyzeLimiter: {
        perClient: createFixedWindowLimiter({ limit: 2, windowMs: 60_000 }),
        global: createFixedWindowLimiter({ limit: 1000, windowMs: 3_600_000 }),
      },
    })

    const res1 = await limitedRoute.request('/brief/analyze', { method: 'POST', body: analyzeBody, headers: jsonHeaders })
    const res2 = await limitedRoute.request('/brief/analyze', { method: 'POST', body: analyzeBody, headers: jsonHeaders })
    const res3 = await limitedRoute.request('/brief/analyze', { method: 'POST', body: analyzeBody, headers: jsonHeaders })

    expect(res1.status).toBe(202)
    expect(res2.status).toBe(202)
    expect(res3.status).toBe(429)
    expect(res3.headers.get('Retry-After')).toBeTruthy()
    const json = await res3.json() as { error: string, detail: string, retryAfterSec: number }
    expect(json.error).toBe('rate_limited')
    // 前端的 useAnalyzeJob 優先顯示 detail，少了它讀者只會看到裸的 'rate_limited'。
    expect(json.detail).toContain(`${json.retryAfterSec} 秒`)
    expect(enqueueJob).toHaveBeenCalledTimes(2)
  })

  it('blocks once the global limit is exhausted, even across different per-client keys', async () => {
    process.env.TRUST_PROXY = 'true'
    const limitedRoute = createBriefRoute({
      enqueue: enqueueJob,
      analyzeLimiter: {
        perClient: createFixedWindowLimiter({ limit: 1000, windowMs: 60_000 }),
        global: createFixedWindowLimiter({ limit: 1, windowMs: 3_600_000 }),
      },
    })

    const res1 = await limitedRoute.request('/brief/analyze', {
      method: 'POST',
      body: analyzeBody,
      headers: { ...jsonHeaders, 'x-forwarded-for': '10.0.0.1' },
    })
    const res2 = await limitedRoute.request('/brief/analyze', {
      method: 'POST',
      body: analyzeBody,
      headers: { ...jsonHeaders, 'x-forwarded-for': '10.0.0.2' },
    })

    expect(res1.status).toBe(202)
    expect(res2.status).toBe(429)
    expect(res2.headers.get('Retry-After')).toBeTruthy()
    expect(enqueueJob).toHaveBeenCalledTimes(1)
  })

  it('does not rate-limit GET /brief/analyses/:id even after POST /brief/analyze is exhausted', async () => {
    const limitedRoute = createBriefRoute({
      enqueue: enqueueJob,
      analyzeLimiter: {
        perClient: createFixedWindowLimiter({ limit: 1, windowMs: 60_000 }),
        global: createFixedWindowLimiter({ limit: 1000, windowMs: 3_600_000 }),
      },
    })

    await limitedRoute.request('/brief/analyze', { method: 'POST', body: analyzeBody, headers: jsonHeaders })
    const blocked = await limitedRoute.request('/brief/analyze', { method: 'POST', body: analyzeBody, headers: jsonHeaders })
    expect(blocked.status).toBe(429)

    const { getAnalysisById } = await import('@suanomics/db/repos/analyses-repo')
    vi.mocked(getAnalysisById).mockResolvedValueOnce(null)
    const getRes = await limitedRoute.request('/brief/analyses/42')
    expect(getRes.status).toBe(404)
  })
})

describe('briefRoute GET /brief/news/:id', () => {
  it('shouldReturn400ForInvalidId', async () => {
    const res = await briefRoute.request('/brief/news/abc')
    expect(res.status).toBe(400)
  })

  it('shouldReturn404WhenNotFound', async () => {
    const res = await briefRoute.request('/brief/news/999')
    expect(res.status).toBe(404)
  })
})

describe('briefRoute GET /brief/by-date/:date', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shouldReturn400ForInvalidDateFormat', async () => {
    const res = await briefRoute.request('/brief/by-date/not-a-date')
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('invalid_date_format')
  })

  it('shouldReturnNullBriefAndEmptyItemsWhenNoBriefFound', async () => {
    // getDailyBriefByDate 預設 mock 回 null
    const res = await briefRoute.request('/brief/by-date/2026-04-28')
    expect(res.status).toBe(200)
    const json = await res.json() as { brief: null, items: unknown[] }
    expect(json.brief).toBeNull()
    expect(json.items).toEqual([])
  })

  it('shouldReturnPodcastJsonNullWhenBriefHasNoPodcast', async () => {
    // 模擬有 daily brief 但 podcastJson + audio 都尚未生成
    const { getDailyBriefByDate } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getDailyBriefByDate).mockResolvedValueOnce({
      briefDate: '2026-04-28',
      summary: '今日市場摘要',
      briefJson: null,
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    } as never)
    const res = await briefRoute.request('/brief/by-date/2026-04-28')
    expect(res.status).toBe(200)
    const json = await res.json() as { brief: { briefDate: string, summary: string, briefJson: unknown, podcastJson: unknown, audioUrl: string | null }, items: unknown[] }
    expect(json.brief.podcastJson).toBeNull()
    expect(json.brief.audioUrl).toBeNull()
  })

  // claimLedger 落地是為了稽核，不是給讀者面用的。少了這兩條，
  // 它會靜默地讓 briefJson 增加約 80%（2026-08-08 實測 66 KB → 約 119 KB）。
  it('strips claimLedger from /brief/by-date（稽核欄位不進讀者面）', async () => {
    const { getDailyBriefByDate } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getDailyBriefByDate).mockResolvedValueOnce({
      briefDate: '2026-08-07',
      summary: 's',
      briefJson: { headline: 'h', claimLedger: [{ id: 'c1' }] },
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    } as never)
    const res = await briefRoute.request('/brief/by-date/2026-08-07')
    const json = await res.json() as { brief: { briefJson: Record<string, unknown> } }
    expect(json.brief.briefJson.headline).toBe('h')
    expect(json.brief.briefJson).not.toHaveProperty('claimLedger')
  })

  it('strips claimLedger from /brief/daily', async () => {
    const { getLatestDailyBrief, getNewsItemsByIds } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getLatestDailyBrief).mockResolvedValueOnce({
      briefDate: '2026-08-07',
      summary: 's',
      briefJson: { headline: 'h', claimLedger: [{ id: 'c1' }] },
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    } as never)
    vi.mocked(getNewsItemsByIds).mockResolvedValueOnce([] as never)
    const res = await briefRoute.request('/brief/daily')
    const json = await res.json() as { brief: { briefJson: Record<string, unknown> } }
    expect(json.brief.briefJson.headline).toBe('h')
    expect(json.brief.briefJson).not.toHaveProperty('claimLedger')
  })

  // claimIds 指向 claimLedger 的 id，而 ledger 上面剛被剝掉——原樣送出去就是一串
  // 讀者面解不回任何東西的懸空引用。清成 []（不是 delete）：NarrativeSection.claimIds
  // 在型別上是必填，web 拿到的是 `as MarketBrief` 的 cast、不走 Zod parse，
  // delete 會讓型別說有、runtime 沒有。
  it('empties narrative claimIds（ledger 已剝除、id 解不回任何東西）', async () => {
    const { getDailyBriefByDate } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getDailyBriefByDate).mockResolvedValueOnce({
      briefDate: '2026-08-07',
      summary: 's',
      briefJson: {
        headline: 'h',
        claimLedger: [{ id: 'c1' }],
        narrative: {
          intro: 'i',
          sections: [
            { heading: 'h1', body: 'b1', relatedNewsIds: ['n1'], claimIds: ['c1', 'c2'], citationUrls: ['https://x'] },
            { heading: 'h2', body: 'b2', relatedNewsIds: [], claimIds: [], citationUrls: ['https://y'] },
          ],
          outro: 'o',
        },
      },
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    } as never)
    const res = await briefRoute.request('/brief/by-date/2026-08-07')
    const json = await res.json() as { brief: { briefJson: { narrative: { sections: Array<Record<string, unknown>> } } } }
    const sections = json.brief.briefJson.narrative.sections
    expect(sections[0]?.claimIds).toEqual([])
    expect(sections[1]?.claimIds).toEqual([])
    // 其餘 narrative 欄位原樣保留
    expect(sections[0]?.heading).toBe('h1')
    expect(sections[0]?.relatedNewsIds).toEqual(['n1'])
    expect(json.brief.briefJson.narrative.intro).toBe('i')
  })

  it('empties narrative claimIds on /brief/daily too（兩條路由共用同一個剝除）', async () => {
    const { getLatestDailyBrief, getNewsItemsByIds } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getLatestDailyBrief).mockResolvedValueOnce({
      briefDate: '2026-08-07',
      summary: 's',
      briefJson: {
        headline: 'h',
        claimLedger: [{ id: 'c1' }],
        narrative: {
          intro: 'i',
          sections: [{ heading: 'h1', body: 'b1', relatedNewsIds: [], claimIds: ['c1'], citationUrls: ['https://x'] }],
          outro: 'o',
        },
      },
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    } as never)
    vi.mocked(getNewsItemsByIds).mockResolvedValueOnce([] as never)
    const res = await briefRoute.request('/brief/daily')
    const json = await res.json() as { brief: { briefJson: { narrative: { sections: Array<Record<string, unknown>> } } } }
    expect(json.brief.briefJson.narrative.sections[0]?.claimIds).toEqual([])
  })

  // 剝除必須是純函式：repo 回來的 row 若被就地改掉，同一個 process 內任何拿著同一份
  // briefJson 的讀取者（快取、後續 handler）都會看到被清空的 claimIds
  it('does not mutate the row it was given', async () => {
    const { getDailyBriefByDate } = await import('@suanomics/db/repos/news-repo')
    const row = {
      briefDate: '2026-08-07',
      summary: 's',
      briefJson: {
        headline: 'h',
        claimLedger: [{ id: 'c1' }],
        narrative: {
          intro: 'i',
          sections: [{ heading: 'h1', body: 'b1', relatedNewsIds: [], claimIds: ['c1', 'c2'], citationUrls: ['https://x'] }],
          outro: 'o',
        },
      },
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    }
    vi.mocked(getDailyBriefByDate).mockResolvedValueOnce(row as never)
    await briefRoute.request('/brief/by-date/2026-08-07')
    expect(row.briefJson.claimLedger).toEqual([{ id: 'c1' }])
    expect(row.briefJson.narrative.sections[0]?.claimIds).toEqual(['c1', 'c2'])
  })

  it('leaves a null narrative alone', async () => {
    const { getDailyBriefByDate } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getDailyBriefByDate).mockResolvedValueOnce({
      briefDate: '2026-08-07',
      summary: 's',
      briefJson: { headline: 'h', narrative: null },
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    } as never)
    const res = await briefRoute.request('/brief/by-date/2026-08-07')
    const json = await res.json() as { brief: { briefJson: Record<string, unknown> } }
    expect(json.brief.briefJson.narrative).toBeNull()
  })

  it('shouldReturnAudioUrlWhenPodcastAudioPathSet', async () => {
    const { getDailyBriefByDate } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getDailyBriefByDate).mockResolvedValueOnce({
      briefDate: '2026-04-30',
      summary: 's',
      briefJson: null,
      podcastJson: null,
      podcastAudioPath: '2026-04-30.mp3',
      selectedNewsIds: [],
    } as never)
    const res = await briefRoute.request('/brief/by-date/2026-04-30')
    expect(res.status).toBe(200)
    const json = await res.json() as { brief: { audioUrl: string | null } }
    expect(json.brief.audioUrl).toBe('/audio/podcast/2026-04-30.mp3')
  })

  it('shouldReturnAudioUrlNullWhenPodcastAudioPathMissing', async () => {
    const { getDailyBriefByDate } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getDailyBriefByDate).mockResolvedValueOnce({
      briefDate: '2026-04-30',
      summary: 's',
      briefJson: null,
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    } as never)
    const res = await briefRoute.request('/brief/by-date/2026-04-30')
    expect(res.status).toBe(200)
    const json = await res.json() as { brief: { audioUrl: string | null } }
    expect(json.brief.audioUrl).toBeNull()
  })
})

describe('briefRoute GET /brief/daily', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shouldReturnAudioUrlWhenLatestBriefHasPodcastAudioPath', async () => {
    const { getLatestDailyBrief } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getLatestDailyBrief).mockResolvedValueOnce({
      briefDate: '2026-04-30',
      summary: 's',
      briefJson: null,
      podcastJson: null,
      podcastAudioPath: '2026-04-30.mp3',
      selectedNewsIds: [],
    } as never)
    const res = await briefRoute.request('/brief/daily')
    expect(res.status).toBe(200)
    const json = await res.json() as { brief: { audioUrl: string | null } }
    expect(json.brief.audioUrl).toBe('/audio/podcast/2026-04-30.mp3')
  })

  it('shouldReturnAudioUrlNullWhenLatestBriefHasNoPodcastAudioPath', async () => {
    const { getLatestDailyBrief } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(getLatestDailyBrief).mockResolvedValueOnce({
      briefDate: '2026-04-30',
      summary: 's',
      briefJson: null,
      podcastJson: null,
      podcastAudioPath: null,
      selectedNewsIds: [],
    } as never)
    const res = await briefRoute.request('/brief/daily')
    expect(res.status).toBe(200)
    const json = await res.json() as { brief: { audioUrl: string | null } }
    expect(json.brief.audioUrl).toBeNull()
  })
})

describe('briefRoute GET /brief/dates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gET /brief/dates returns date list', async () => {
    const { listDailyBriefDates } = await import('@suanomics/db/repos/news-repo')
    vi.mocked(listDailyBriefDates).mockResolvedValueOnce(['2026-06-14', '2026-06-13'])
    const res = await briefRoute.request('/brief/dates')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dates: ['2026-06-14', '2026-06-13'] })
  })

  it('gET /brief/dates returns empty list when none', async () => {
    const res = await briefRoute.request('/brief/dates')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dates: [] })
  })
})

describe('briefRoute GET /brief/analyses/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shouldReturn400ForNonNumericId', async () => {
    const res = await briefRoute.request('/brief/analyses/abc')
    expect(res.status).toBe(400)
  })

  it('shouldReturn400ForNonPositiveId', async () => {
    const res = await briefRoute.request('/brief/analyses/0')
    expect(res.status).toBe(400)
  })

  it('shouldReturn404WhenNotFound', async () => {
    const { getAnalysisById } = await import('@suanomics/db/repos/analyses-repo')
    vi.mocked(getAnalysisById).mockResolvedValueOnce(null)
    const res = await briefRoute.request('/brief/analyses/99')
    expect(res.status).toBe(404)
  })

  it('shouldReturn200WithPayloadWhenFound', async () => {
    const samplePayload = {
      headline: 'sample',
      summary: 's',
      relatedNews: [],
      affectedIndustries: [],
      relatedETFs: [],
      reasoningChain: ['r1', 'r2'],
      citations: [{ url: 'https://x/1', title: 't', quote: 'q' }],
      disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
    }
    const { getAnalysisById } = await import('@suanomics/db/repos/analyses-repo')
    vi.mocked(getAnalysisById).mockResolvedValueOnce({ payload: samplePayload as never })
    const res = await briefRoute.request('/brief/analyses/42')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual(samplePayload)
  })
})
