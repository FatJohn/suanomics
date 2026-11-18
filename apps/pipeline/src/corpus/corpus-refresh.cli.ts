#!/usr/bin/env tsx
import process from 'node:process'
import { parseArgs } from 'node:util'
import { parseTimeoutMs, runJobCli } from './lib/run-job-cli.js'

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', multiple: true },
      force: { type: 'boolean', default: false },
      timeout: { type: 'string' },
    },
    strict: false,
  })

  const payload = {
    ...(values.source && Array.isArray(values.source) && values.source.length > 0
      ? { sourceSlugs: values.source as string[] }
      : {}),
    force: values.force === true,
  }

  await runJobCli({
    kind: 'corpus-refresh',
    payload,
    timeoutMs: parseTimeoutMs(process.argv.slice(2)),
    label: 'running corpus-refresh...',
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
