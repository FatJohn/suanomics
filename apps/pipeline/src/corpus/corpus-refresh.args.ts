import type { CorpusRefreshResult } from './corpus-worker.js'

export interface CorpusRefreshArgs {
  sourceSlugs?: string[]
  force: boolean
  maxEnrich: number
}

// 每篇最多問 3 次模型（entity-summary 的重試預算），150 篇的最壞情況是 450 次呼叫，
// 落在 AGENTS.md 的單批 500 次以內。
export const DEFAULT_MAX_ENRICH = 150

function parseMaxEnrich(raw: string | undefined): number {
  const value = Number(raw)
  if (raw === undefined || !Number.isInteger(value) || value <= 0)
    throw new Error(`--max-enrich 必須是正整數，收到 ${raw ?? '（未提供）'}`)
  return value
}

export function parseCorpusRefreshArgs(argv: readonly string[]): CorpusRefreshArgs {
  const slugs: string[] = []
  let force = false
  let maxEnrich = DEFAULT_MAX_ENRICH
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--')
      continue
    if (arg === '--force') {
      force = true
    }
    else if (arg === '--source') {
      const slug = argv[++i]
      if (slug === undefined || slug.startsWith('--'))
        throw new Error('--source 要接來源 slug')
      slugs.push(slug)
    }
    else if (arg === '--max-enrich') {
      maxEnrich = parseMaxEnrich(argv[++i])
    }
    else {
      throw new Error(`未知參數：${arg}`)
    }
  }
  return slugs.length > 0 ? { sourceSlugs: slugs, force, maxEnrich } : { force, maxEnrich }
}

// 單一來源偶發失敗只記 warning；全部失敗或沒有任何來源時，背景庫等於停止更新，要讓這一步變紅。
export function exitCodeFor(result: CorpusRefreshResult): number {
  const total = result.perSource.length
  return total === 0 || result.failedSources.length === total ? 1 : 0
}
