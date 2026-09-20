import { describe, expect, it } from 'vitest'
import { dispatchSource } from './index.js'

describe('dispatchSource', () => {
  it('throws for unknown kind', async () => {
    // eslint-disable-next-line ts/no-explicit-any -- intentionally testing unknown kind at runtime
    const spec = { kind: 'xyz' as any, slug: 's', displayName: 'd', pipeline: 'light' as const, config: {} }
    await expect(dispatchSource(spec)).rejects.toThrow(/unknown source kind/i)
  })

  it('rejects yt-transcript with light pipeline', async () => {
    const spec = { kind: 'yt-transcript' as const, slug: 's', displayName: 'd', pipeline: 'light' as const, config: { playlistUrl: 'https://youtube.com/a' } }
    await expect(dispatchSource(spec)).rejects.toThrow(/deep pipeline required for yt-transcript/i)
  })
})

describe('dispatchSource (podcast-rss)', () => {
  it('rejects podcast-rss with light pipeline', async () => {
    const spec = {
      kind: 'podcast-rss' as const,
      slug: 's',
      displayName: 'd',
      pipeline: 'light' as const,
      config: { rssUrl: 'https://example.com/feed.xml' },
    }
    await expect(dispatchSource(spec)).rejects.toThrow(/deep pipeline required for podcast-rss/i)
  })

  it('rejects podcast-rss with invalid config (missing rssUrl)', async () => {
    const spec = {
      kind: 'podcast-rss' as const,
      slug: 's',
      displayName: 'd',
      pipeline: 'deep' as const,
      // eslint-disable-next-line ts/no-explicit-any -- intentionally invalid config to verify schema parse rejection
      config: {} as any,
    }
    await expect(dispatchSource(spec)).rejects.toThrow()
  })
})
