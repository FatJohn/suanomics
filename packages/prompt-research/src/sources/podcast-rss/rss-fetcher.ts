export interface RssFetchConfig {
  url: string
  fetchImpl?: typeof fetch
}

export interface RssFetchResult {
  xml: string
  url: string
}

export async function fetchRssFeed(cfg: RssFetchConfig): Promise<RssFetchResult> {
  const fetchImpl = cfg.fetchImpl ?? fetch
  const res = await fetchImpl(cfg.url, {
    headers: { 'user-agent': 'suanomics-prompt-research/1.0' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok)
    throw new Error(`rss fetch HTTP ${res.status}: ${await res.text()}`)
  const xml = await res.text()
  return { xml, url: cfg.url }
}
