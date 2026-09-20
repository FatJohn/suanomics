import { describe, expect, it } from 'vitest'
import { callGemini } from './gemini-client.js'

describe('callGemini', () => {
  it('throws when GEMINI_API_KEY missing', async () => {
    const origKey = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    await expect(callGemini({
      systemPrompt: 'x',
      userContent: 'y',
      responseSchema: {},
    })).rejects.toThrow(/GEMINI_API_KEY/)
    if (origKey)
      process.env.GEMINI_API_KEY = origKey
  })
})
