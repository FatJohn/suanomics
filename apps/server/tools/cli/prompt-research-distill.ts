#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
import type { Digest, SourceSpec } from '@suanomics/prompt-research'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process, { exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SOURCES,
  dispatchSource,
  mergeDigests,
} from '@suanomics/prompt-research'
import { Command } from 'commander'
import { enforceLlmRunBudget, estimateTotalCalls } from './lib/llm-run-budget.js'
import { estimatePromptResearchDistill } from './lib/llm-run-estimates.js'

export interface DistillOpts {
  kind?: 'yt-transcript' | 'skill-markdown' | 'custom-text' | 'podcast-rss'
  skill?: string
  file?: string
  rss?: string
  out: string
  dryRun: boolean
  mergeOnly: boolean
  count?: number
  /** 批次跑前預算閘門的確認旗標，等同其餘批次腳本的 `--yes`。 */
  yes?: boolean
}

export function parseSkillAdHoc(arg: string): SourceSpec {
  const [repoRef, pathPart] = arg.split(':')
  const [repoOwner, repoName] = (repoRef ?? '').split('/')
  if (!repoOwner || !repoName || !pathPart) {
    throw new Error('--skill expects "owner/repo:path/to/SKILL.md"')
  }
  return {
    kind: 'skill-markdown',
    slug: `adhoc-${repoOwner}-${repoName}`,
    displayName: `${repoOwner}/${repoName}`,
    pipeline: 'light',
    config: { repoOwner, repoName, skillPath: pathPart, ref: 'main' },
  }
}

export function parseRssAdHoc(url: string): SourceSpec {
  const hostname = new URL(url).hostname.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  return {
    kind: 'podcast-rss',
    slug: `adhoc-podcast-${hostname}`,
    displayName: hostname,
    pipeline: 'deep',
    config: { rssUrl: url, count: 5 },
  }
}

/** --skill／--file／--rss／--kind／--count 覆寫全部套用完之後的最終 specs 陣列。 */
export function resolveDistillSpecs(opts: DistillOpts): SourceSpec[] {
  let specs: SourceSpec[] = DEFAULT_SOURCES
  if (opts.skill) {
    specs = [parseSkillAdHoc(opts.skill)]
  }
  else if (opts.file) {
    specs = [{
      kind: 'custom-text',
      slug: 'custom',
      displayName: 'custom',
      pipeline: 'light',
      config: { filePath: opts.file },
    }]
  }
  else if (opts.rss) {
    specs = [parseRssAdHoc(opts.rss)]
  }
  if (opts.kind)
    specs = specs.filter(s => s.kind === opts.kind)
  if (typeof opts.count === 'number') {
    specs = specs.map((s) => {
      if (s.kind === 'yt-transcript' || s.kind === 'podcast-rss')
        return { ...s, config: { ...s.config, count: opts.count } }
      return s
    })
  }
  return specs
}

// export 是為了測試能 mock @suanomics/prompt-research 的 dispatchSource／mergeDigests，直接驗證
// 預算閘門會不會擋下它們（不用真的打 Gemini）；runDistill 不會在 import 當下自動跑，見檔尾
// isMainModule 的守門（同 brief-rerun.ts 的慣例）。
export async function runDistill(opts: DistillOpts): Promise<void> {
  const specs = resolveDistillSpecs(opts)

  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = resolve(opts.out, `${runId}-run`)

  if (opts.dryRun) {
    // dry-run 不落地、不跑 pipeline，只印估算——跟 model-ab.ts 的 --analyze／--probe 同一類，
    // 不打真 LLM，不受下面的預算閘門管（llm-cli-manifest.ts 對這兩支的既有分類原則）。
    console.log(JSON.stringify({
      runId,
      specs: specs.map(s => ({ slug: s.slug, kind: s.kind, pipeline: s.pipeline })),
      estimated_calls: estimateTotalCalls(estimatePromptResearchDistill(specs)),
    }, null, 2))
    return
  }

  // yt-transcript／podcast-rss 的 count 越高、每集 segmenter+lens+STT 的呼叫數
  // 越容易撞到 500 次／尖峰 10 的專案風險門檻（見 llm-run-estimates.ts）。
  enforceLlmRunBudget(estimatePromptResearchDistill(specs), {
    confirmed: opts.yes === true,
    errLog: line => console.error(line),
    // ★ 刻意用 process.exit（不是檔頭 import 的 exit）：後者在模組載入當下就把函式參照
    // 綁死，測試裡 vi.spyOn(process, 'exit') 換掉 process.exit 這個 property 對它沒有作用
    // （同 news-backfill-tags.ts 的教訓）。
    exit: process.exit,
    // 這支腳本沒有 --limit／--dates／--replicates，縮小範圍的正確做法是調小 --count。
    narrowingHint: '--count 縮小 yt-transcript／podcast-rss 的集數',
  })

  mkdirSync(join(runDir, 'per-source'), { recursive: true })

  const digests: Digest[] = []
  for (const spec of specs) {
    console.warn(`[run] ${spec.slug} (${spec.kind})`)
    const digest = await dispatchSource(spec, runDir)
    digests.push(digest)
    writeFileSync(
      join(runDir, 'per-source', `${spec.slug}.json`),
      JSON.stringify(digest, null, 2),
      'utf8',
    )
  }

  const { markdown, draft } = mergeDigests(digests, { sources: specs })
  const mdPath = join(runDir, 'merged-analyzer-prompt-draft.md')
  const jsonPath = join(runDir, 'merged-analyzer-prompt-draft.json')
  writeFileSync(mdPath, markdown, 'utf8')
  writeFileSync(jsonPath, JSON.stringify(draft, null, 2), 'utf8')
  console.log(mdPath)
  console.log(jsonPath)
}

const program = new Command()
program
  .name('prompt-research-distill')
  .description('Distill source materials into a merged analyzer prompt draft')
  .option('-k, --kind <kind>', 'yt-transcript | skill-markdown | custom-text | podcast-rss')
  .option('-s, --skill <arg>', '"owner/repo:path/to/SKILL.md"')
  .option('-f, --file <path>', 'custom-text file path')
  .option('-r, --rss <url>', 'podcast RSS feed URL (ad-hoc)')
  .option('-o, --out <dir>', 'output directory (relative to apps/server/ CWD)', '.prompt-research-out')
  .option('--dry-run', 'print plan only')
  .option('--merge-only', '(reserved) merge existing digests')
  .option('--count <n>', 'count override (yt-transcript / podcast-rss)', (v: string) => Number.parseInt(v, 10))
  .option('--yes', 'skip the pre-run LLM budget confirmation (see tools/cli/lib/llm-run-budget.ts)')
  .action((opts: DistillOpts) => runDistill(opts).then(() => exit(0)).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    exit(1)
  }))

// 只在「這支檔案被直接執行」時才跑 CLI parse（同 brief-rerun.ts 的慣例）——否則測試 import
// runDistill／resolveDistillSpecs 這些函式時，會在 import 當下就跑進 commander.parseAsync。
const isMainModule = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
  program.parseAsync(process.argv).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    exit(1)
  })
}
