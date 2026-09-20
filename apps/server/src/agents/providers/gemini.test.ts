import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callGemini } from './gemini.js'

const generateContentMock = vi.fn()
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
}))

describe('callGemini', () => {
  beforeEach(() => {
    generateContentMock.mockReset()
    process.env.GEMINI_API_KEY = 'test'
  })

  it('解析 usageMetadata.cachedContentTokenCount → cachedReadTokens', async () => {
    generateContentMock.mockResolvedValue({
      text: '{"x":1}',
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, cachedContentTokenCount: 800 },
    })
    const res = await callGemini({
      modelName: 'gemini-3.5-flash',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 30_000,
    })
    expect(res.tokensIn).toBe(1000)
    expect(res.tokensOut).toBe(500)
    expect(res.cachedReadTokens).toBe(800)
  })

  it('無 cachedContentTokenCount → cachedReadTokens = 0', async () => {
    generateContentMock.mockResolvedValue({
      text: '{"x":1}',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    })
    const res = await callGemini({
      modelName: 'gemini-3.5-flash',
      systemPrompt: 's',
      userContent: 'u',
      responseSchema: {},
      timeoutMs: 30_000,
    })
    expect(res.cachedReadTokens).toBe(0)
  })

  // ───── 故障注入 ─────
  //
  // 這支 client 在此之前只有兩條測試，兩條都走成功路徑、mock 都是自造的成功回應形狀
  // ——與觸發 firecrawl 事故同型。下面這幾條讓失敗路徑真的被走過一次，
  // 並把「兩種不同的壞法目前長得一模一樣」這件事釘在測試裡，而不是留在某個人的印象裡。

  it('sDK 拋錯（網路／HTTP）會原樣往上拋，不吞成空結果', async () => {
    generateContentMock.mockRejectedValue(new Error('fetch failed: ECONNRESET'))
    await expect(callGemini({ modelName: 'm', systemPrompt: 's', userContent: 'u', timeoutMs: 1000 }))
      .rejects
      .toThrow(/ECONNRESET/)
  })

  // 逾時是自己那顆計時器 abort 的。llm-wrapper 對 AbortError 刻意不重試
  // （llm-wrapper.ts:172），所以這個 name 是有語意的，不能被包成別的東西。
  it('abortError 保留 name，llm-wrapper 才判得出「不要重試」', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    generateContentMock.mockRejectedValue(abort)
    await expect(callGemini({ modelName: 'm', systemPrompt: 's', userContent: 'u', timeoutMs: 1000 }))
      .rejects
      .toMatchObject({ name: 'AbortError' })
  })

  it('模型回非 JSON 時拋出來，不是靜靜回空物件', async () => {
    generateContentMock.mockResolvedValue({ text: 'I am sorry, I cannot help with that.' })
    await expect(callGemini({ modelName: 'm', systemPrompt: 's', userContent: 'u', timeoutMs: 1000 }))
      .rejects
      .toThrow(SyntaxError)
  })

  // ★ 已知缺口，刻意釘住而不是順手修：「模型回了東西但不是 JSON」與「模型什麼都沒回」
  //   目前是同一個 SyntaxError，呼叫端分不出來。為 scraper 定的契約（呼叫失敗與
  //   合法空結果要在型別上分得開）還沒套到 provider 這一層——這是之後才要做的事。
  it('空回應與壞 JSON 目前是同一種錯（契約缺口，非迴歸）', async () => {
    const fail = async (text: string | undefined): Promise<string> => {
      generateContentMock.mockResolvedValue(text === undefined ? {} : { text })
      try {
        await callGemini({ modelName: 'm', systemPrompt: 's', userContent: 'u', timeoutMs: 1000 })
        return 'no-throw'
      }
      catch (e) {
        return (e as Error).constructor.name
      }
    }
    expect(await fail(undefined)).toBe('SyntaxError')
    expect(await fail('')).toBe('SyntaxError')
    expect(await fail('not json')).toBe('SyntaxError')
  })

  it('反向對照：成功路徑不受影響', async () => {
    generateContentMock.mockResolvedValue({ text: '{"ok":true}', usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } })
    const r = await callGemini({ modelName: 'm', systemPrompt: 's', userContent: 'u', timeoutMs: 1000 })
    expect(r).toMatchObject({ raw: { ok: true }, tokensIn: 3, tokensOut: 4 })
  })
})
