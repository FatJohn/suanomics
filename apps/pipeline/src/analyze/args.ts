export type AnalyzeArgs
  = | { source: 'url', url: string, title?: string }
    | { source: 'text', text: string, title?: string }

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  }
  catch {
    return false
  }
}

export function parseAnalyzeArgs(argv: readonly string[]): AnalyzeArgs {
  const values: { url?: string | undefined, text?: string | undefined, title?: string | undefined } = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--')
      continue
    if (arg === '--url' || arg === '--text' || arg === '--title')
      values[arg.slice(2) as 'url' | 'text' | 'title'] = argv[++i] ?? ''
    else
      throw new Error(`未知參數：${arg}`)
  }
  const { url, text, title } = values
  if (title !== undefined && title.trim() === '')
    throw new Error('--title 不可為空白')
  const withTitle = title !== undefined ? { title } : {}
  if (url !== undefined && text !== undefined)
    throw new Error('--url 與 --text 只能擇一')
  if (url !== undefined) {
    if (!isHttpUrl(url))
      throw new Error(`--url 必須是 http(s) 網址，收到 ${url || '（未提供）'}`)
    return { source: 'url', url, ...withTitle }
  }
  if (text !== undefined) {
    if (text.trim() === '')
      throw new Error('--text 不可為空白')
    return { source: 'text', text, ...withTitle }
  }
  throw new Error('需要 --url 或 --text')
}
