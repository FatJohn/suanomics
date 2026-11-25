const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
const FIRECRAWL_TIMEOUT_MS = 30_000

interface FirecrawlResponse {
  success?: unknown
  data?: { markdown?: unknown }
}

export function firecrawlMarkdown(body: unknown): string | null {
  const response = body as FirecrawlResponse | null
  const markdown = response?.success === true ? response.data?.markdown : null
  return typeof markdown === 'string' && markdown.trim() !== '' ? markdown.trim() : null
}

/** 只在 Readability 抽不到時由呼叫端使用；失敗回 null，不影響該則新聞的標題與連結入庫。 */
export async function scrapeWithFirecrawl(url: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[firecrawl] HTTP ${res.status}: ${url}`)
      return null
    }
    return firecrawlMarkdown(await res.json())
  }
  catch (err) {
    console.warn(`[firecrawl] failed: ${url}`, err)
    return null
  }
}
