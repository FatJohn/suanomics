import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBriefStore } from './brief.js'

describe('useBriefStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shouldStartWithIdleDailyState', () => {
    const s = useBriefStore()
    expect(s.dailyStatus).toBe('idle')
    expect(s.daily).toBeNull()
  })

  it('shouldTransitionToLoadingThenSuccessOnFetchDaily', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ brief: { briefDate: '2026-04-28', summary: 's' }, items: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const s = useBriefStore()
    const p = s.fetchDaily()
    expect(s.dailyStatus).toBe('loading')
    await p
    expect(s.dailyStatus).toBe('success')
    expect(s.daily?.brief?.summary).toBe('s')
  })

  it('shouldSetErrorStateWhenFetchFails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const s = useBriefStore()
    await s.fetchDaily()
    expect(s.dailyStatus).toBe('error')
  })

  describe('fetchNewsAnalysis', () => {
    it('shouldStartWithIdleAnalysisState', () => {
      const s = useBriefStore()
      expect(s.analysisStatus).toBe('idle')
      expect(s.analysis).toBeNull()
    })

    it('shouldSetAnalysisAndSuccessWhenFetchOk', async () => {
      const payload = {
        item: { id: 42 },
        analysis: {
          headline: 'h',
          summary: 's',
          relatedNews: [],
          affectedIndustries: [],
          relatedETFs: [],
          reasoningChain: ['a', 'b'],
          citations: [{ title: 't', url: 'https://x/1', quote: 'q' }],
          disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
        },
      }
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }))
      vi.stubGlobal('fetch', fetchMock)
      const s = useBriefStore()
      await s.fetchNewsAnalysis(42)
      expect(s.analysisStatus).toBe('success')
      expect(s.analysis?.headline).toBe('h')
    })

    it('shouldSetErrorWhenFetchFails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
      const s = useBriefStore()
      await s.fetchNewsAnalysis(42)
      expect(s.analysisStatus).toBe('error')
    })
  })

  // analyzePaste / paste* state 已搬到 useAnalyzeJob composable、
  // tests 改在 composables/useAnalyzeJob.test.ts。
})
