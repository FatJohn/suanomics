#!/usr/bin/env tsx

import type { JobPayloadByKind } from '@suanomics/jobs'
import process from 'node:process'
import { parseTimeoutMs, runJobCli } from './lib/run-job-cli.js'

type PromptRefreshPayload = JobPayloadByKind['prompt-refresh']

interface CliArgs {
  sourceSlug?: string
  kindFilter?: 'yt-transcript' | 'skill-markdown' | 'custom-text'
  bucket?: string
}

function parseArgs(argv: readonly string[]): CliArgs {
  let sourceSlug: string | undefined
  let kindFilter: CliArgs['kindFilter']
  let bucket: string | undefined
  for (const a of argv) {
    if (a?.startsWith('--source=')) {
      sourceSlug = a.split('=')[1]
    }
    else if (a?.startsWith('--kind=')) {
      const k = a.split('=')[1] as CliArgs['kindFilter']
      if (k === 'yt-transcript' || k === 'skill-markdown' || k === 'custom-text')
        kindFilter = k
    }
    else if (a?.startsWith('--bucket=')) {
      bucket = a.split('=')[1]
    }
  }
  // GOTCHA: exactOptionalPropertyTypes — conditional spread for optional fields
  return {
    ...(sourceSlug !== undefined ? { sourceSlug } : {}),
    ...(kindFilter !== undefined ? { kindFilter } : {}),
    ...(bucket !== undefined ? { bucket } : {}),
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)

  // bucket 是去重字串、不是報告日，但它必填、要先算好再組 payload。
  const bucket = args.bucket ?? new Date().toISOString().slice(0, 10)

  // 若指定 --source 或 --kind、需要先 import DEFAULT_SOURCES 過濾、然後塞 payload.sources
  let payload: PromptRefreshPayload = { bucket }
  if (args.sourceSlug || args.kindFilter) {
    const { DEFAULT_SOURCES } = await import('@suanomics/prompt-research')
    const filtered = DEFAULT_SOURCES.filter((s: { slug: string, kind: string }) => {
      if (args.sourceSlug && s.slug !== args.sourceSlug)
        return false
      if (args.kindFilter && s.kind !== args.kindFilter)
        return false
      return true
    })
    if (filtered.length === 0) {
      console.error(`no sources matched --source=${args.sourceSlug ?? ''} --kind=${args.kindFilter ?? ''}`)
      process.exit(2)
    }
    payload = { bucket, sources: filtered }
  }

  await runJobCli({
    kind: 'prompt-refresh',
    payload,
    timeoutMs: parseTimeoutMs(argv),
    label: `running prompt-refresh (bucket=${bucket})...`,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
