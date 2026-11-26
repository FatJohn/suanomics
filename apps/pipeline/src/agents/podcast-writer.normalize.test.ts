import { describe, expect, it } from 'vitest'
import { preNormalizePodcastRaw } from './podcast-writer.normalize.js'

describe('preNormalizePodcastRaw control-char hygiene', () => {
  it('strips control chars from hook/act/takeaway bodies before clamp', () => {
    const raw = {
      briefDate: '2026-06-16',
      hook: { headline: '\u8A0A\u001A\u865F', body: '\u58D3\u529B\u001A\u9084\u662F\u5728\u90A3\u88CF' },
      acts: [{ actTitle: 'A\u200Bct', storyline: 'ai-tech', body: '\u5167\uFFFD\u5BB9', citationUrls: ['https://x/a'], relatedNewsIds: ['n1'] }],
      takeaway: { body: '\u6536\uFEFF\u5C3E' },
      meta: { totalChars: 2000, persona: 'panpan', generatedAt: '2026-06-16T00:00:00.000Z' },
    }
    const out = preNormalizePodcastRaw(raw, ['https://x/a'], '2026-06-16') as {
      hook: { headline: string, body: string }
      acts: Array<{ actTitle: string, body: string }>
      takeaway: { body: string }
    }
    expect(out.hook.headline).toBe('\u8A0A\u865F')
    expect(out.hook.body).toBe('\u58D3\u529B\u9084\u662F\u5728\u90A3\u88CF')
    expect(out.acts[0]?.actTitle).toBe('Act')
    expect(out.acts[0]?.body).toBe('\u5167\u5BB9')
    expect(out.takeaway.body).toBe('\u6536\u5C3E')
  })
})
