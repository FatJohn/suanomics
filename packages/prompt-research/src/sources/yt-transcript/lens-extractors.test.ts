import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { GoogleGenAI } from '@google/genai'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YT_PROMPT_VARS } from '../../pipeline/prompt-vars.js'
import { LENS_CONCURRENCY, runAllLenses, runLens } from './lens-extractors.js'
import { createLogger } from './logger.js'

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: vi.fn() },
  })),
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    ARRAY: 'ARRAY',
    NUMBER: 'NUMBER',
    INTEGER: 'INTEGER',
  },
}))

const VALID_EVENTS = {
  episodeId: 'ep1',
  events: [
    {
      title: '美國 CPI 公布',
      date: '2026-04-20',
      description: '美國公布最新 CPI 數據，市場關注通膨路徑變化。',
      segmentRef: { startSec: 120, endSec: 180 },
    },
  ],
}

const INVALID_ENTITIES = {
  episodeId: 'ep1',
  entities: [
    {
      kind: 'ticker',
      name: '2330',
      mentionCount: 2,
      context: '主持人提到台股權值股。',
    },
  ],
}

const VALID_ENTITIES = {
  episodeId: 'ep1',
  entities: [
    {
      kind: 'sector',
      name: '半導體',
      mentionCount: 2,
      context: '主持人提到半導體產業景氣循環。',
    },
  ],
}

function mockClientWith(...responses: Array<{ text: string }>) {
  const gc = vi.fn()
  for (const response of responses)
    gc.mockResolvedValueOnce(response)

  const client = { models: { generateContent: gc } }
  vi.mocked(GoogleGenAI).mockImplementation(() => client as unknown as InstanceType<typeof GoogleGenAI>)
  return { gc }
}

interface GenerateContentParams {
  config?: { responseSchema?: { properties?: Record<string, unknown> } }
}

/** 依 responseSchema 的 key 辨識這次呼叫是哪個 lens，回傳一組通過該 lens schema 的空陣列回應。 */
function lensSuccessTextFor(params: GenerateContentParams): string {
  const keys = Object.keys(params.config?.responseSchema?.properties ?? {})
  if (keys.includes('events'))
    return JSON.stringify({ episodeId: 'ep1', events: [] })
  if (keys.includes('sources'))
    return JSON.stringify({ episodeId: 'ep1', sources: [] })
  if (keys.includes('entities'))
    return JSON.stringify({ episodeId: 'ep1', entities: [] })
  if (keys.includes('chains'))
    return JSON.stringify({ episodeId: 'ep1', chains: [] })
  if (keys.includes('impacts'))
    return JSON.stringify({ episodeId: 'ep1', impacts: [] })
  if (keys.includes('frames'))
    return JSON.stringify({ episodeId: 'ep1', frames: [] })
  throw new Error(`unclassified lens call in test mock: ${keys.join(',')}`)
}

describe('runLens', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lens-'))
    vi.clearAllMocks()
    process.env.GEMINI_API_KEY = 'fake-key'
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('shouldValidateAndReturnForEvents', async () => {
    mockClientWith({ text: JSON.stringify(VALID_EVENTS) })
    const logger = createLogger({ runId: 'r1', runDir: dir })
    const result = await runLens('events', 'fake transcript', 'ep1', logger, YT_PROMPT_VARS)
    expect(result.episodeId).toBe('ep1')
    expect(result.events[0]?.title).toBe('美國 CPI 公布')
    logger.close()
  })

  it('shouldRejectEntitiesWithTickerKind', async () => {
    const { gc } = mockClientWith(
      { text: JSON.stringify(INVALID_ENTITIES) },
      { text: JSON.stringify(VALID_ENTITIES) },
    )
    const logger = createLogger({ runId: 'r2', runDir: dir })
    const result = await runLens('entities', 'fake transcript', 'ep1', logger, YT_PROMPT_VARS)
    expect(gc).toHaveBeenCalledTimes(2)
    expect(result.entities[0]?.kind).toBe('sector')
    logger.close()
  })
})

describe('runAllLenses', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lens-all-'))
    vi.clearAllMocks()
    process.env.GEMINI_API_KEY = 'fake-key'
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // 6 個 lens 上限並行 LENS_CONCURRENCY（=3）跑，不是 Promise.all 一次全開——改回
  // Promise.all 會讓 maxActive 變成 6，這條斷言會紅。
  it('caps concurrent lens calls at LENS_CONCURRENCY and preserves LENS_ORDER in the result', async () => {
    let active = 0
    let maxActive = 0
    const gc = vi.fn(async (params: GenerateContentParams) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 20))
      active--
      return { text: lensSuccessTextFor(params) }
    })
    const client = { models: { generateContent: gc } }
    vi.mocked(GoogleGenAI).mockImplementation(() => client as unknown as InstanceType<typeof GoogleGenAI>)

    const logger = createLogger({ runId: 'r-all', runDir: dir })
    const result = await runAllLenses('fake transcript', 'ep1', logger, YT_PROMPT_VARS)
    logger.close()

    expect(gc).toHaveBeenCalledTimes(6)
    expect(maxActive).toBe(LENS_CONCURRENCY)
    expect(Object.keys(result)).toEqual([
      'events',
      'cited_sources',
      'entities',
      'reasoning_chains',
      'impacts',
      'analyst_frames',
    ])
  })

  // 錯誤語意要跟原本 Promise.all 一致：任一 lens 重試到底仍失敗，整包最終要 reject。
  it('rejects when one lens exhausts retries, matching Promise.all error semantics', async () => {
    const gc = vi.fn(async (params: GenerateContentParams) => {
      const keys = Object.keys(params.config?.responseSchema?.properties ?? {})
      if (keys.includes('entities'))
        return { text: 'not-json' }
      return { text: lensSuccessTextFor(params) }
    })
    const client = { models: { generateContent: gc } }
    vi.mocked(GoogleGenAI).mockImplementation(() => client as unknown as InstanceType<typeof GoogleGenAI>)

    const logger = createLogger({ runId: 'r-all-fail', runDir: dir })
    await expect(runAllLenses('fake transcript', 'ep1', logger, YT_PROMPT_VARS)).rejects.toThrow()
    logger.close()
  })
})
