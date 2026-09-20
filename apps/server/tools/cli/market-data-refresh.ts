#!/usr/bin/env tsx

import process from 'node:process'
import { parseTimeoutMs, runJobCli } from './lib/run-job-cli.js'

function parseBucket(argv: readonly string[]): string | undefined {
  for (const a of argv) {
    if (a?.startsWith('--bucket='))
      return a.split('=')[1]
  }
  return undefined
}

async function main() {
  const argv = process.argv.slice(2)
  // bucket 是純去重字串、不是報告日（`MarketDataRefreshPayloadSchema` 必填、worker 從不消費）。
  // 同一個 UTC 曆日要跑第二次會被去重擋掉，那時用 `--bucket=` 換一個值。
  const bucket = parseBucket(argv) ?? new Date().toISOString().slice(0, 10)
  await runJobCli({
    kind: 'market-data-refresh',
    payload: { bucket },
    timeoutMs: parseTimeoutMs(argv),
    label: `running market-data-refresh (bucket=${bucket})...`,
  })
}

main().catch((err) => {
  console.error('[market-data:refresh] uncaught', err)
  process.exit(1)
})
