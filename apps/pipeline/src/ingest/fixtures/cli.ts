import type { CheckDeps, CheckOutcome } from './check.js'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { checkEntry, formatReport, hasFailure } from './check.js'
import { FIXTURE_MANIFESTS } from './registry.js'

// `pnpm fixtures:check` 的進入點。
//
// **刻意不進 CI**：它依賴外部服務當下可不可用，放進 CI 只會製造與程式碼無關的紅燈，
// 然後大家開始習慣忽略紅燈。它的定位是「動到某個 client 之前先跑一次」與「定期人工體檢」。
// 打不到對方（unreachable）不算失敗，只有形狀真的漂移才 exit 1。

const TIMEOUT_MS = 15_000

async function fetchLive(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'suanomics/0.1 (fixture shape check)' },
    })
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`)
    return await res.json()
  }
  finally {
    clearTimeout(timer)
  }
}

const deps: CheckDeps = {
  readFixture: (manifest, file) => readFileSync(new URL(file, manifest.baseUrl), 'utf-8'),
  fetchLive,
}

async function main(): Promise<void> {
  const outcomes: CheckOutcome[] = []
  for (const manifest of FIXTURE_MANIFESTS) {
    for (const entry of manifest.entries)
      outcomes.push(await checkEntry(manifest, entry, deps))
  }
  for (const line of formatReport(outcomes))
    console.error(line)
  process.exit(hasFailure(outcomes) ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error('[fixtures:check] 自己炸了：', err)
    process.exit(2)
  })
}
