#!/usr/bin/env tsx

// Usage:
//   pnpm --filter server run podcast:tts -- --date 2026-04-30 [--timeout=N]
//   pnpm --filter server run podcast:tts 2026-04-30                  # positional date (backwards compat)
import process from 'node:process'
import { parseTimeoutMs, runJobCli } from './lib/run-job-cli.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseDate(argv: readonly string[]): string {
  let date: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--date') {
      date = argv[i + 1] ?? null
      i++
    }
    else if (a && DATE_RE.test(a) && !date) {
      // accept positional date for backwards compat (existing CLI uses positional)
      date = a
    }
  }
  if (!date || !DATE_RE.test(date)) {
    console.error('Usage: pnpm --filter server run podcast:tts -- --date YYYY-MM-DD [--timeout=N]')
    process.exit(2)
  }
  return date
}

async function main() {
  const argv = process.argv.slice(2)
  const date = parseDate(argv)
  await runJobCli({
    kind: 'podcast-tts',
    payload: { date },
    timeoutMs: parseTimeoutMs(argv),
    label: `running podcast-tts for ${date}...`,
  })
}

main().catch((err) => {
  console.error('[podcast:tts] uncaught', err)
  process.exit(1)
})
