import type { CorpusRefreshResult } from './corpus-worker.js'

export interface CorpusRefreshArgs {
  sourceSlugs?: string[]
  force: boolean
}

export function parseCorpusRefreshArgs(argv: readonly string[]): CorpusRefreshArgs {
  const slugs: string[] = []
  let force = false
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
    else {
      throw new Error(`未知參數：${arg}`)
    }
  }
  return slugs.length > 0 ? { sourceSlugs: slugs, force } : { force }
}

// 單一來源偶發失敗只記 warning；全部失敗或沒有任何來源時，背景庫等於停止更新，要讓這一步變紅。
export function exitCodeFor(result: CorpusRefreshResult): number {
  const total = result.perSource.length
  return total === 0 || result.failedSources.length === total ? 1 : 0
}
