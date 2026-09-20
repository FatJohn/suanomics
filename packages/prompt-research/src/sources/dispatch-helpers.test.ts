import { describe, expect, it } from 'vitest'
import { filterTranscript } from './dispatch-helpers.js'

describe('filterTranscript', () => {
  const full = [
    '[00:00] intro chitchat',
    '[00:30] market talk start',
    '[01:30] continuing market',
    '[02:30] ad break',
    '[03:30] macro event analysis',
    '[04:30] closing chatter',
  ].join('\n')

  const segmenter = {
    segments: [
      { startSec: 0, endSec: 30, topic: 'chitchat' },
      { startSec: 30, endSec: 150, topic: 'market' },
      { startSec: 150, endSec: 210, topic: 'ad' },
      { startSec: 210, endSec: 270, topic: 'macro_event' },
      { startSec: 270, endSec: 999, topic: 'chitchat' },
    ],
    keptTopics: ['market', 'macro_event'] as const,
  }

  it('keeps only lines whose timestamp falls in kept-topic segments', () => {
    const out = filterTranscript(full, segmenter)
    expect(out).toContain('market talk start')
    expect(out).toContain('continuing market')
    expect(out).toContain('macro event analysis')
    expect(out).not.toContain('intro chitchat')
    expect(out).not.toContain('ad break')
    expect(out).not.toContain('closing chatter')
  })

  it('returns input unchanged when keptTopics yields no spans', () => {
    const result = filterTranscript(full, {
      segments: [{ startSec: 0, endSec: 999, topic: 'joke' }],
      keptTopics: [],
    })
    expect(result).toBe(full)
  })

  it('preserves lines without timestamp prefix', () => {
    const withUntagged = `${full}\nfooter note without timestamp`
    const out = filterTranscript(withUntagged, segmenter)
    expect(out).toContain('footer note without timestamp')
  })
})
