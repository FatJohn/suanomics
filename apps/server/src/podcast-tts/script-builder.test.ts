import type { Podcast } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildFullScript, DEFAULT_MAX_CHARS, segmentPodcastScript } from './script-builder.js'

function makePodcast(overrides: Partial<Podcast> = {}): Podcast {
  return {
    briefDate: '2026-04-30',
    hook: { headline: 'Test hook', body: 'hook body text' },
    acts: [
      { actTitle: 'Act 1', storyline: 'ai-tech', body: 'act 1 body', citationUrls: ['https://x.com/a'], relatedNewsIds: ['n1'] },
      { actTitle: 'Act 2', storyline: 'rates', body: 'act 2 body', citationUrls: ['https://x.com/b'], relatedNewsIds: ['n2'] },
    ],
    takeaway: { body: 'takeaway body' },
    meta: { totalChars: 2000, persona: 'panpan', generatedAt: '2026-04-30T00:00:00Z' },
    ...overrides,
  }
}

describe('segmentPodcastScript', () => {
  it('每個 section 短於 cap 時各成一段、標註正確、不含 actTitle/url', () => {
    const segs = segmentPodcastScript(makePodcast())
    expect(segs.map(s => s.section)).toEqual(['hook', 'act', 'act', 'takeaway'])
    expect(segs.map(s => s.sectionIndex)).toEqual([0, 0, 1, 0])
    expect(segs.map(s => s.text)).toEqual(['hook body text', 'act 1 body', 'act 2 body', 'takeaway body'])
    expect(segs.some(s => s.text.includes('Act'))).toBe(false)
    expect(segs.some(s => s.text.includes('https://'))).toBe(false)
  })

  it('section 超過 cap 時在句界切、不切句中、串回等於原文', () => {
    const podcast = makePodcast({
      acts: [{ actTitle: 'A', storyline: 'ai-tech', body: '一二三。四五六。七八九。', citationUrls: ['https://x.com/1'], relatedNewsIds: ['n1'] }],
    })
    const segs = segmentPodcastScript(podcast, { maxChars: 5 })
    const actSegs = segs.filter(s => s.section === 'act')
    expect(actSegs.length).toBe(3)
    expect(actSegs.every(s => s.text.endsWith('。'))).toBe(true)
    expect(actSegs.map(s => s.text).join('')).toBe('一二三。四五六。七八九。')
    expect(actSegs.every(s => s.sectionIndex === 0)).toBe(true)
  })

  it('單一句子超過 cap 時不被切斷（整句成一段）', () => {
    const podcast = makePodcast({
      acts: [{ actTitle: 'A', storyline: 'ai-tech', body: '一二三四五六七八九十。', citationUrls: ['https://x.com/1'], relatedNewsIds: ['n1'] }],
    })
    const actSegs = segmentPodcastScript(podcast, { maxChars: 5 }).filter(s => s.section === 'act')
    expect(actSegs.length).toBe(1)
    expect(actSegs[0]?.text).toBe('一二三四五六七八九十。')
  })

  it('dEFAULT_MAX_CHARS 為 400', () => {
    expect(DEFAULT_MAX_CHARS).toBe(400)
  })
})

describe('buildFullScript', () => {
  it('joins hook → acts(in order) → takeaway with double newline, no actTitle/url', () => {
    expect(buildFullScript(makePodcast())).toBe('hook body text\n\nact 1 body\n\nact 2 body\n\ntakeaway body')
  })

  it('handles a single act', () => {
    const podcast = makePodcast({
      acts: [{ actTitle: 'A', storyline: 'ai-tech', body: '單段', citationUrls: ['https://x.com/1'], relatedNewsIds: ['n1'] }],
    })
    expect(buildFullScript(podcast)).toBe('hook body text\n\n單段\n\ntakeaway body')
  })
})
