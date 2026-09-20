import type { EpisodeL3 } from './schemas.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { GoogleGenAI } from '@google/genai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YT_PROMPT_VARS } from '../../pipeline/prompt-vars.js'
import { runConsolidator } from './consolidator.js'
import { createLogger } from './logger.js'

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: vi.fn() },
  })),
  Type: {},
}))

const SAMPLE_L3: EpisodeL3[] = [{
  episodeId: 'ep1',
  title: 'Ep1',
  url: 'https://x.test/1',
  publishedAt: '2026-04-21T00:00:00Z',
  durationSec: 3600,
  segmenter: {
    episodeId: 'ep1',
    durationSec: 3600,
    segments: [{ startSec: 0, endSec: 60, topic: 'market', headline: 'h', relevance: 0.9 }],
    keptTopics: ['market'],
    droppedMinutes: { joke: 0, ad: 0, chitchat: 0, other: 0 },
  },
  events: [],
  citedSources: [],
  entities: [],
  reasoningChains: [],
  impacts: [],
  analystFrames: [],
}]

const COMPLIANT_SUPPLEMENT = `# YT Analyst Digest · run-1

## 1. Top Macro Themes This Week
- 無關鍵事件
## 2. Cross-Episode Analyst Frames
- 無
## 3. Sector-Level Impact Map
- 無
## 4. Key Events Referenced
- 無
## 5. Cited Sources
- 無
## 6. Compliance Note
本 supplement 為 AI 工具從公開 KOL 直播萃取之分析模式參考、非投資建議、不含個股方向性評論。`

const UNCOMPLIANT_SUPPLEMENT = COMPLIANT_SUPPLEMENT.replace('無關鍵事件', '台積電偏多格局延續')

function mockClientWith(...responses: Array<{ text: string }>) {
  const gc = vi.fn()
  for (const response of responses)
    gc.mockResolvedValueOnce(response)

  const client = { models: { generateContent: gc } }
  vi.mocked(GoogleGenAI).mockImplementation(() => client as unknown as InstanceType<typeof GoogleGenAI>)
  return { gc }
}

describe('runConsolidator', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cons-'))
    vi.clearAllMocks()
    process.env.GEMINI_API_KEY = 'fake'
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('shouldReturnSupplementWhenCompliant', async () => {
    mockClientWith({ text: COMPLIANT_SUPPLEMENT })
    const logger = createLogger({ runId: 'run-1', runDir: dir })
    const result = await runConsolidator(SAMPLE_L3, 'run-1', logger, YT_PROMPT_VARS)
    expect(result).toContain('Top Macro Themes')
    expect(result).toContain('Compliance Note')
    logger.close()
  })

  it('shouldRetryWhenContainsTickerDirection', async () => {
    const { gc } = mockClientWith(
      { text: UNCOMPLIANT_SUPPLEMENT },
      { text: COMPLIANT_SUPPLEMENT },
    )
    const logger = createLogger({ runId: 'run-2', runDir: dir })
    const result = await runConsolidator(SAMPLE_L3, 'run-2', logger, YT_PROMPT_VARS)
    expect(result).not.toContain('台積電偏多')
    expect(gc).toHaveBeenCalledTimes(2)
    logger.close()
  })

  it('shouldThrowAfter2RetriesAllUncompliant', async () => {
    mockClientWith(
      { text: UNCOMPLIANT_SUPPLEMENT },
      { text: UNCOMPLIANT_SUPPLEMENT },
    )
    const logger = createLogger({ runId: 'run-3', runDir: dir })
    await expect(runConsolidator(SAMPLE_L3, 'run-3', logger, YT_PROMPT_VARS)).rejects.toThrow()
    logger.close()
  })
})
