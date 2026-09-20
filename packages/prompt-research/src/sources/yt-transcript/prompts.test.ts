import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { YT_PROMPT_VARS } from '../../pipeline/prompt-vars.js'
import {
  buildConsolidatorSystemPrompt,
  buildLensExtractorSystemPrompt,
  buildSegmenterSystemPrompt,
} from './prompts.js'

describe('buildSegmenterSystemPrompt', () => {
  it('shouldListAllSegmentTopics', () => {
    const p = buildSegmenterSystemPrompt(YT_PROMPT_VARS)
    for (const t of ['market', 'macro_event', 'joke', 'ad', 'chitchat', 'other']) {
      expect(p).toContain(t)
    }
  })

  it('shouldReferenceSegmenterOutputSchema', () => {
    expect(buildSegmenterSystemPrompt(YT_PROMPT_VARS)).toContain('SegmenterOutputSchema')
  })
})

describe('buildLensExtractorSystemPrompt', () => {
  it.each([
    'events',
    'cited_sources',
    'entities',
    'reasoning_chains',
    'impacts',
    'analyst_frames',
  ] as const)('shouldReturnPromptForLens_%s', (lens) => {
    const p = buildLensExtractorSystemPrompt(lens, YT_PROMPT_VARS)
    expect(p.length).toBeGreaterThan(200)
  })

  it('shouldEmbedComplianceGuardrailInEveryLensPrompt', () => {
    for (const lens of ['events', 'cited_sources', 'entities', 'reasoning_chains', 'impacts', 'analyst_frames'] as const) {
      const p = buildLensExtractorSystemPrompt(lens, YT_PROMPT_VARS)
      expect(p).toContain('投信投顧法')
      expect(p).toContain('ticker')
      expect(p).toContain('個股')
    }
  })

  it('shouldListAllForbiddenPhrasesInAnyLensPrompt', () => {
    const p = buildLensExtractorSystemPrompt('events', YT_PROMPT_VARS)
    for (const phrase of FORBIDDEN_PHRASES)
      expect(p).toContain(`「${phrase}」`)
  })

  it('shouldHaveLensSpecificInstructionsForEntities', () => {
    expect(buildLensExtractorSystemPrompt('entities', YT_PROMPT_VARS)).toContain('sector')
    expect(buildLensExtractorSystemPrompt('entities', YT_PROMPT_VARS)).toContain('macro_indicator')
  })

  it('shouldHaveLensSpecificInstructionsForAnalystFrames', () => {
    const p = buildLensExtractorSystemPrompt('analyst_frames', YT_PROMPT_VARS)
    expect(p).toContain('招式')
    expect(p).toContain('推論模式')
  })
})

describe('buildConsolidatorSystemPrompt', () => {
  it('shouldListAllSupplementSections', () => {
    const p = buildConsolidatorSystemPrompt(YT_PROMPT_VARS)
    expect(p).toContain('Top Macro Themes')
    expect(p).toContain('Cross-Episode Analyst Frames')
    expect(p).toContain('Sector-Level Impact Map')
    expect(p).toContain('Key Events Referenced')
    expect(p).toContain('Cited Sources')
    expect(p).toContain('Compliance Note')
  })

  it('shouldSpecifyTargetLength10to12kChars', () => {
    const p = buildConsolidatorSystemPrompt(YT_PROMPT_VARS)
    expect(p).toMatch(/10[,，]000.*12[,，]000/)
  })

  it('shouldBanTickerDirectionAndListForbiddenPhrases', () => {
    const p = buildConsolidatorSystemPrompt(YT_PROMPT_VARS)
    expect(p).toContain('ticker')
    expect(p).toContain('個股方向性')
    for (const phrase of FORBIDDEN_PHRASES)
      expect(p).toContain(`「${phrase}」`)
  })
})

describe('數據解讀聚焦指示', () => {
  it('analyst_frames lens 優先擷取數據解讀型招式', () => {
    const p = buildLensExtractorSystemPrompt('analyst_frames', YT_PROMPT_VARS)
    expect(p).toContain('數據解讀型')
    expect(p).toContain('統計口徑')
    expect(p).toContain('央行語言學')
  })

  it('consolidator Section 2 要求數據解讀型 frames 優先', () => {
    const p = buildConsolidatorSystemPrompt(YT_PROMPT_VARS)
    expect(p).toContain('數據解讀型')
  })
})

interface Baseline {
  segmenter: string
  lens_events: string
  lens_cited_sources: string
  lens_entities: string
  lens_reasoning_chains: string
  lens_impacts: string
  lens_analyst_frames: string
  consolidator: string
}

const __dirname = dirname(fileURLToPath(import.meta.url))

const baseline = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../pipeline/__fixtures__/yt-prompts-baseline.json'),
    'utf8',
  ),
) as Baseline

describe('yT prompt-vars byte-for-byte snapshot', () => {
  it('segmenter prompt with YT_PROMPT_VARS matches baseline exactly', () => {
    expect(buildSegmenterSystemPrompt(YT_PROMPT_VARS)).toBe(baseline.segmenter)
  })

  it.each([
    ['events', 'lens_events'],
    ['cited_sources', 'lens_cited_sources'],
    ['entities', 'lens_entities'],
    ['reasoning_chains', 'lens_reasoning_chains'],
    ['impacts', 'lens_impacts'],
    ['analyst_frames', 'lens_analyst_frames'],
  ] as const)('lens %s prompt with YT_PROMPT_VARS matches baseline', (lens, key) => {
    expect(buildLensExtractorSystemPrompt(lens, YT_PROMPT_VARS)).toBe(baseline[key])
  })

  it('consolidator prompt with YT_PROMPT_VARS matches baseline exactly', () => {
    expect(buildConsolidatorSystemPrompt(YT_PROMPT_VARS)).toBe(baseline.consolidator)
  })
})
