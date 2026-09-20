import type { MarketBrief, Podcast } from '@suanomics/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface NewsItem {
  id: number
  title: string
  url: string
  publishedAt: string | null
}

export interface DailyPayload {
  // briefJson 含完整 MarketBrief、舊 row null
  // podcastJson 含完整 Podcast（PodcastWriter 產出）、audioUrl 為 TTS 產出的音訊 URL
  brief: { briefDate: string, summary: string, briefJson: MarketBrief | null, podcastJson: Podcast | null, audioUrl?: string | null } | null
  items: NewsItem[]
}

type Status = 'idle' | 'loading' | 'success' | 'error'

// 分析貼新聞 (`analyzePaste`) state 已搬到
// `composables/useAnalyzeJob.ts` 的 async polling composable、store 保純薄。
export const useBriefStore = defineStore('brief', () => {
  const daily = ref<DailyPayload | null>(null)
  const dailyStatus = ref<Status>('idle')
  const analysis = ref<MarketBrief | null>(null)
  const analysisStatus = ref<Status>('idle')
  const podcastJson = ref<Podcast | null>(null)
  const audioUrl = ref<string | null>(null)

  // daily / by-date 兩條 fetch 共用同一套 state 寫入邏輯、抽出避免重複
  function applyDailyPayload(payload: DailyPayload): void {
    daily.value = payload
    podcastJson.value = payload.brief?.podcastJson ?? null
    // audioUrl 後端回 relative path（/audio/podcast/...）、要拼 API_BASE
    // 才能跨 domain 抓檔案（web 與 server 是兩個容器、不同 origin）
    const rawAudioUrl = payload.brief?.audioUrl ?? null
    audioUrl.value = rawAudioUrl ? `${API_BASE}${rawAudioUrl}` : null
  }

  // daily 與 by-date 共用同一套 loading/fetch/錯誤處理、差別只在 URL
  async function loadReport(url: string): Promise<void> {
    dailyStatus.value = 'loading'
    try {
      const res = await fetch(url)
      if (!res.ok)
        throw new Error('fail')
      applyDailyPayload(await res.json() as DailyPayload)
      dailyStatus.value = 'success'
    }
    catch {
      dailyStatus.value = 'error'
    }
  }

  const availableDates = ref<string[]>([])

  async function fetchDaily(): Promise<void> {
    await loadReport(`${API_BASE}/api/brief/daily`)
  }

  async function fetchByDate(date: string): Promise<void> {
    await loadReport(`${API_BASE}/api/brief/by-date/${date}`)
  }

  async function fetchDates(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/brief/dates`)
      if (!res.ok)
        return
      const data = await res.json() as { dates: string[] }
      availableDates.value = data.dates
    }
    catch {
      // 切換器無資料時靜默、不擋報告顯示
    }
  }

  async function fetchNewsAnalysis(id: number): Promise<void> {
    analysisStatus.value = 'loading'
    try {
      const res = await fetch(`${API_BASE}/api/brief/news/${id}`)
      if (!res.ok)
        throw new Error('fail')
      const data = await res.json() as { item: unknown, analysis: MarketBrief | null }
      analysis.value = data.analysis
      analysisStatus.value = 'success'
    }
    catch {
      analysisStatus.value = 'error'
    }
  }

  return {
    daily,
    dailyStatus,
    analysis,
    analysisStatus,
    podcastJson,
    audioUrl,
    availableDates,
    fetchDaily,
    fetchByDate,
    fetchDates,
    fetchNewsAnalysis,
  }
})
