import type { PromptRefreshPayload, RunPromptRefreshResult } from '../../prompt-research/run-prompt-refresh.js'
import {

  runPromptRefresh,

} from '../../prompt-research/run-prompt-refresh.js'

export interface ProcessPromptRefreshJobParams {
  payload: PromptRefreshPayload
  updateProgress?: (n: number) => Promise<void> | void
}

export async function processPromptRefreshJob(p: ProcessPromptRefreshJobParams): Promise<RunPromptRefreshResult> {
  await p.updateProgress?.(10)
  const result = await runPromptRefresh(p.payload)
  await p.updateProgress?.(100)
  return result
}
