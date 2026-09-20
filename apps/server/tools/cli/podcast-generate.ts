#!/usr/bin/env tsx

// Usage:
//   pnpm --filter server run podcast:generate -- --date 2026-04-30 [--force] [--timeout=N]
import process from 'node:process'
import { parseTimeoutMs, runJobCli } from './lib/run-job-cli.js'

interface CliArgs {
  date: string
  force: boolean
}

function parseArgs(argv: readonly string[]): CliArgs {
  let date: string | null = null
  let force = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--date') {
      date = argv[i + 1] ?? null
      i++
    }
    else if (a === '--force') {
      force = true
    }
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: pnpm --filter server run podcast:generate -- --date YYYY-MM-DD [--force] [--timeout=N]')
    process.exit(2)
  }
  return { date, force }
}

async function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  await runJobCli({
    kind: 'podcast-generate',
    payload: { date: args.date, force: args.force },
    timeoutMs: parseTimeoutMs(argv),
    label: `running podcast-generate for ${args.date}...`,
  })
}

main().catch((err) => {
  console.error('[podcast-generate] uncaught', err)
  process.exit(1)
})
