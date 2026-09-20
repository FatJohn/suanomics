import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { GoogleGenAI } from '@google/genai'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YT_PROMPT_VARS } from '../../pipeline/prompt-vars.js'
import { createLogger } from './logger.js'
import { runSegmenter } from './segmenter.js'

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

const VALID_OUTPUT = {
  episodeId: 'ep1',
  durationSec: 3600,
  segments: [
    { startSec: 0, endSec: 1800, topic: 'market', headline: 'intro', relevance: 0.9 },
    { startSec: 1800, endSec: 3600, topic: 'joke', headline: 'ad', relevance: 0.1 },
  ],
  keptTopics: ['market', 'macro_event'],
  droppedMinutes: { joke: 30, ad: 0, chitchat: 0, other: 0 },
}

function mockClientWith(...responses: Array<{ text: string }>) {
  const gc = vi.fn()
  for (const r of responses) gc.mockResolvedValueOnce(r)
  const client = { models: { generateContent: gc } }
  vi.mocked(GoogleGenAI).mockImplementation(() => client as unknown as InstanceType<typeof GoogleGenAI>)
  return { client, gc }
}

describe('runSegmenter', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seg-'))
    vi.clearAllMocks()
    process.env.GEMINI_API_KEY = 'fake-key'
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('shouldReturnValidatedOutputWhenGeminiRespondsValidJson', async () => {
    mockClientWith({ text: JSON.stringify(VALID_OUTPUT) })
    const logger = createLogger({ runId: 'r1', runDir: dir })
    const result = await runSegmenter('fake transcript', 'ep1', logger, YT_PROMPT_VARS)
    expect(result.episodeId).toBe('ep1')
    expect(result.segments).toHaveLength(2)
    logger.close()
  })

  it('shouldRetryOnceWhenFirstResponseIsInvalidSchema', async () => {
    const { gc } = mockClientWith(
      { text: '{"invalid": true}' },
      { text: JSON.stringify(VALID_OUTPUT) },
    )
    const logger = createLogger({ runId: 'r2', runDir: dir })
    const result = await runSegmenter('t', 'ep1', logger, YT_PROMPT_VARS)
    expect(gc).toHaveBeenCalledTimes(2)
    expect(result.episodeId).toBe('ep1')
    logger.close()
  })

  it('shouldThrowAfterTwoRetriesAllFail', async () => {
    mockClientWith({ text: 'not json' }, { text: 'still not json' })
    const logger = createLogger({ runId: 'r3', runDir: dir })
    await expect(runSegmenter('t', 'ep1', logger, YT_PROMPT_VARS)).rejects.toThrow()
    logger.close()
  })
})
