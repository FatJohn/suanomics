import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('transcribeWithGemini', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.GEMINI_API_KEY = 'fake-key'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.GEMINI_API_KEY
  })

  it('returns transcript text from GenAI inline-data call', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '逐字稿內容' })
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: { generateContent },
      })),
    }))

    const { transcribeWithGemini } = await import('./gemini-stt.js')
    const out = await transcribeWithGemini({
      audio: Buffer.from([1, 2, 3]),
      mimeType: 'audio/mpeg',
      episodeId: 'ep1',
      hintLanguage: 'zh-TW',
    })

    expect(out).toBe('逐字稿內容')
    expect(generateContent).toHaveBeenCalledTimes(1)
    const callArg = generateContent.mock.calls[0][0]
    expect(callArg.contents[0].inlineData.mimeType).toBe('audio/mpeg')
    expect(callArg.contents[0].inlineData.data).toBe(Buffer.from([1, 2, 3]).toString('base64'))
  })

  it('throws when GEMINI_API_KEY missing', async () => {
    delete process.env.GEMINI_API_KEY
    const { transcribeWithGemini } = await import('./gemini-stt.js')
    await expect(transcribeWithGemini({
      audio: Buffer.from([]),
      mimeType: 'audio/mpeg',
      episodeId: 'ep',
    })).rejects.toThrow(/GEMINI_API_KEY/)
  })

  it('retries on empty response then returns on attempt 2', async () => {
    const generateContent = vi.fn()
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: 'second try ok' })
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent } })),
    }))

    const { transcribeWithGemini } = await import('./gemini-stt.js')
    const out = await transcribeWithGemini({
      audio: Buffer.from([0]),
      mimeType: 'audio/mpeg',
      episodeId: 'ep',
    })

    expect(out).toBe('second try ok')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it('embeds hintLanguage into system prompt', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: 'ok' })
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent } })),
    }))

    const { transcribeWithGemini } = await import('./gemini-stt.js')
    await transcribeWithGemini({
      audio: Buffer.from([0]),
      mimeType: 'audio/mpeg',
      episodeId: 'ep',
      hintLanguage: 'zh-TW',
    })

    const cfgArg = generateContent.mock.calls[0][0].config
    expect(cfgArg.systemInstruction).toContain('zh-TW')
  })

  it('falls back to File API when audio > 18MB inline limit', async () => {
    // 20MB audio：>18MB threshold、必走 File API path。
    const bigAudio = Buffer.alloc(20 * 1024 * 1024, 0xAB)

    const upload = vi.fn().mockResolvedValue({
      name: 'files/abc123',
      uri: 'https://generativelanguage.googleapis.com/v1/files/abc123',
      mimeType: 'audio/mpeg',
      state: 'ACTIVE', // 直接 ACTIVE、跳過 polling
    })
    const filesGet = vi.fn()
    const generateContent = vi.fn().mockResolvedValue({ text: 'large file transcript' })

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: { generateContent },
        files: { upload, get: filesGet },
      })),
    }))

    const { transcribeWithGemini } = await import('./gemini-stt.js')
    const out = await transcribeWithGemini({
      audio: bigAudio,
      mimeType: 'audio/mpeg',
      episodeId: 'ep-big',
    })

    expect(out).toBe('large file transcript')
    expect(upload).toHaveBeenCalledTimes(1)
    const uploadArg = upload.mock.calls[0][0]
    expect(uploadArg.config.mimeType).toBe('audio/mpeg')
    expect(uploadArg.file).toBeInstanceOf(Blob)
    expect(uploadArg.file.size).toBe(20 * 1024 * 1024)

    // 沒走 inline path、沒 polling get
    expect(filesGet).not.toHaveBeenCalled()

    // generateContent 用 fileData reference、非 inlineData
    const contents = generateContent.mock.calls[0][0].contents
    expect(contents[0].fileData).toEqual({
      mimeType: 'audio/mpeg',
      fileUri: 'https://generativelanguage.googleapis.com/v1/files/abc123',
    })
    expect(contents[0].inlineData).toBeUndefined()
  })

  it('polls files.get until ACTIVE before generateContent', async () => {
    const bigAudio = Buffer.alloc(20 * 1024 * 1024, 0xCD)

    const upload = vi.fn().mockResolvedValue({
      name: 'files/proc-1',
      uri: undefined,
      mimeType: 'audio/mpeg',
      state: 'PROCESSING',
    })
    // 第 1 次 get 還 PROCESSING、第 2 次 ACTIVE
    const filesGet = vi.fn()
      .mockResolvedValueOnce({ name: 'files/proc-1', state: 'PROCESSING' })
      .mockResolvedValueOnce({
        name: 'files/proc-1',
        uri: 'https://generativelanguage.googleapis.com/v1/files/proc-1',
        mimeType: 'audio/mpeg',
        state: 'ACTIVE',
      })
    const generateContent = vi.fn().mockResolvedValue({ text: 'polled transcript' })

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: { generateContent },
        files: { upload, get: filesGet },
      })),
    }))

    // poll interval = 3s 真等會拖測試 6s+、用 fake timers 把 setTimeout 立即推進。
    vi.useFakeTimers()

    const { transcribeWithGemini } = await import('./gemini-stt.js')
    const pending = transcribeWithGemini({
      audio: bigAudio,
      mimeType: 'audio/mpeg',
      episodeId: 'ep-poll',
    })

    // 推進到所有 polling 完成（兩次 3s sleep）
    await vi.runAllTimersAsync()
    const out = await pending

    vi.useRealTimers()

    expect(out).toBe('polled transcript')
    expect(filesGet).toHaveBeenCalledTimes(2)
    expect(generateContent).toHaveBeenCalledTimes(1)
    const contents = generateContent.mock.calls[0][0].contents
    expect(contents[0].fileData.fileUri).toBe('https://generativelanguage.googleapis.com/v1/files/proc-1')
  })

  it('throws when File API upload state becomes FAILED', async () => {
    const bigAudio = Buffer.alloc(20 * 1024 * 1024, 0xEE)

    const upload = vi.fn().mockResolvedValue({
      name: 'files/fail-1',
      state: 'PROCESSING',
    })
    const filesGet = vi.fn().mockResolvedValue({
      name: 'files/fail-1',
      state: 'FAILED',
    })
    const generateContent = vi.fn()

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: { generateContent },
        files: { upload, get: filesGet },
      })),
    }))

    vi.useFakeTimers()
    const { transcribeWithGemini } = await import('./gemini-stt.js')

    const pending = transcribeWithGemini({
      audio: bigAudio,
      mimeType: 'audio/mpeg',
      episodeId: 'ep-failed',
    }).catch((err: Error) => err)

    await vi.runAllTimersAsync()
    const result = await pending
    vi.useRealTimers()

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/FAILED/)
    expect(generateContent).not.toHaveBeenCalled()
  })
})
