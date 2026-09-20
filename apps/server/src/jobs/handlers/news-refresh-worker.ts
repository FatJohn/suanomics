import type { RunNewsRefreshResult } from '../../news/refresh.js'
import { runNewsRefresh } from '../../news/refresh.js'

export interface ProcessNewsRefreshJobParams {
  updateProgress?: (n: number) => Promise<void> | void
}

export async function processNewsRefreshJob(p: ProcessNewsRefreshJobParams): Promise<RunNewsRefreshResult> {
  await p.updateProgress?.(10)
  const result = await runNewsRefresh()
  await p.updateProgress?.(100)
  return result
}
