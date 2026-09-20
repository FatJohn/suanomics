import type { KeyNumber } from '@suanomics/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

type Status = 'idle' | 'loading' | 'success' | 'error'

// 市場關鍵數字（零 LLM、獨立於 brief）。`/d/:date` 歷史頁要那一天的收盤，不是今天的——
// 帶 `date` 就讓卡片跟著檢視日期走，不帶（`/`）維持現行行為：當下最新值。
export const useMarketStore = defineStore('market', () => {
  const keyNumbers = ref<KeyNumber[]>([])
  const status = ref<Status>('idle')

  async function fetchKeyNumbers(date?: string): Promise<void> {
    status.value = 'loading'
    try {
      const url = date === undefined
        ? `${API_BASE}/api/market/snapshot`
        // encodeURIComponent：日期來自路由參數，`/d/a%26b` 這類值不編碼會把 query 截斷。
        : `${API_BASE}/api/market/snapshot?date=${encodeURIComponent(date)}`
      const res = await fetch(url)
      if (!res.ok)
        throw new Error('fail')
      const data = await res.json() as { series: KeyNumber[] }
      keyNumbers.value = data.series
      status.value = 'success'
    }
    catch {
      status.value = 'error'
      keyNumbers.value = []
    }
  }

  return { keyNumbers, status, fetchKeyNumbers }
})
