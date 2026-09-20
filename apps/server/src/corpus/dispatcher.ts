import type { HtmlSelectorConfig } from './sources/html-selector.js'
import type { FetchedEntry, RssFetchConfig } from './sources/rss.js'
import { fetchHtmlSelector } from './sources/html-selector.js'
import { fetchRssSource } from './sources/rss.js'

export type DispatchInput
  = | { kind: 'rss', config: RssFetchConfig }
    | { kind: 'html-selector', config: HtmlSelectorConfig }
    | { kind: 'official-feed', config: RssFetchConfig }

export async function dispatchFetch(input: DispatchInput): Promise<FetchedEntry[]> {
  switch (input.kind) {
    case 'rss':
    case 'official-feed':
      return fetchRssSource(input.config)
    case 'html-selector':
      return fetchHtmlSelector(input.config)
    default:
      throw new Error(`unknown source kind: ${(input as { kind: string }).kind}`)
  }
}
