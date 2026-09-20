#!/usr/bin/env tsx

import process from 'node:process'
import { parseTimeoutMs, runJobCli } from './lib/run-job-cli.js'

async function main() {
  // bucket 是純去重字串（只是長得像時間）、worker 從不消費它。
  const bucket = new Date().toISOString().slice(0, 13)
  await runJobCli({
    kind: 'news-refresh',
    payload: { bucket },
    timeoutMs: parseTimeoutMs(process.argv.slice(2)),
    label: `running news-refresh (bucket=${bucket})...`,
  })
}

main().catch((err) => {
  console.error('[news:refresh] uncaught', err)
  process.exit(1)
})
