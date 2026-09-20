import type { JobPayloadByKind } from '@suanomics/jobs'
import type { Digest } from '@suanomics/prompt-research'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SOURCES,
  dispatchSource,
  mergeDigests,
  pruneOldCandidates,
  runCompile,
} from '@suanomics/prompt-research'

export type PromptRefreshPayload = JobPayloadByKind['prompt-refresh']

export interface RunPromptRefreshResult {
  runId: string
  sourcesProcessed: number
  candidatesDir: string
  candidatesWritten: string[]
  candidatesPruned: string[]
}

// 透過 import.meta.url 計算 repo root、避免依賴 process.cwd()
// 此檔位置：apps/server/src/prompt-research/run-prompt-refresh.ts
// 4 levels up = repo root
// dist build 後位置：apps/server/dist/prompt-research/run-prompt-refresh.js
// 仍是 4 levels up = repo root
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../../..')

const OUTPUTS_BASE = resolve(REPO_ROOT, 'apps/server/.prompt-research-out')
const CANDIDATES_BASE = resolve(REPO_ROOT, 'packages/prompts/_candidates')

function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export async function runPromptRefresh(payload: PromptRefreshPayload): Promise<RunPromptRefreshResult> {
  const sources = payload.sources ?? DEFAULT_SOURCES
  const runId = makeRunId()

  const runOutputsDir = resolve(OUTPUTS_BASE, runId)
  await mkdir(runOutputsDir, { recursive: true })

  // distill：per-source、傳 runOutputsDir 給 YT log 寫
  const digests: Digest[] = []
  for (const spec of sources) {
    const digest = await dispatchSource(spec, runOutputsDir)
    digests.push(digest)
  }

  // merge in-memory
  const { draft } = mergeDigests(digests, { sources })

  // 寫 draft 到 file：runCompile 從 outputsDir/runId/merged-analyzer-prompt-draft.json 讀
  await writeFile(
    resolve(runOutputsDir, 'merged-analyzer-prompt-draft.json'),
    JSON.stringify(draft, null, 2),
    'utf-8',
  )

  // compile：寫 .system.ts 到 candidatesDir/<runId>/
  const candidatesDir = resolve(CANDIDATES_BASE, runId)
  const compileResult = await runCompile({
    runId,
    outputsDir: OUTPUTS_BASE,
    promptsDir: candidatesDir,
  })

  const candidatesWritten = compileResult.writtenPaths

  // 保留最近 10 個 runId、超過自動 prune
  const prune = await pruneOldCandidates({ candidatesBase: CANDIDATES_BASE, maxRuns: 10 })

  return {
    runId,
    sourcesProcessed: sources.length,
    candidatesDir,
    candidatesWritten,
    candidatesPruned: prune.removed,
  }
}
