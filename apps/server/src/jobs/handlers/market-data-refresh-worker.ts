import type { RefreshResult } from '../../market-data/refresh.js'
import process from 'node:process'
import { refreshMarketData } from '../../market-data/refresh.js'

export interface ProcessMarketDataRefreshParams {
  updateProgress?: (n: number) => Promise<void> | void
}

export async function processMarketDataRefreshJob(p: ProcessMarketDataRefreshParams): Promise<RefreshResult> {
  await p.updateProgress?.(10)
  const r = await refreshMarketData({ fredApiKey: process.env.FRED_API_KEY ?? '' })
  await p.updateProgress?.(100)
  return r
}
