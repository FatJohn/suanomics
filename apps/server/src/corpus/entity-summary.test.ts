import type { CallAgentLLMParams } from '../agents/llm-wrapper.js'
import { describe, expect, it, vi } from 'vitest'
import { enrichEntitySummary } from './entity-summary.js'

// 注入點從「假 GoogleGenAI client」換成「假 callAgentLLM」：provider 呼叫與 JSON.parse 已由
// llm-wrapper 負責，本檔只剩 zod 驗證 / kind 正規化 / tags 切 5 / 失敗不 throw / 重試預算。
// 陣列元素是 Error 時代表該次呼叫拋錯（模擬 provider 失敗）。
function makeFakeCaller(...responses: unknown[]) {
  let i = 0
  return vi.fn(async (p: CallAgentLLMParams) => {
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    if (r instanceof Error)
      throw r
    p.onCallRecord?.({
      agentName: 'corpus-entity-summary',
      tokensIn: 2000,
      tokensOut: 300,
      costUsd: 0.0042,
      latencyMs: 1200,
      attempts: 1,
      provider: 'gemini',
    })
    return r
  })
}

describe('enrichEntitySummary', () => {
  it('happy path: 收下 wrapper parse 好的物件', async () => {
    const callLLM = makeFakeCaller({ contentSummary: 'abc', entities: [{ kind: 'company', name: 'TSMC', confidence: 0.9 }], topicTags: ['AI'] })
    const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
    expect(r.failed).toBe(false)
    expect(r.data?.contentSummary).toBe('abc')
    expect(r.data?.entities).toHaveLength(1)
  })

  it('unknown entity kind → downgrade to other', async () => {
    const callLLM = makeFakeCaller({ contentSummary: 's', entities: [{ kind: 'weird', name: 'x', confidence: 0.5 }], topicTags: [] })
    const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
    expect(r.failed).toBe(false)
    expect(r.data?.entities[0]?.kind).toBe('other')
  })

  it('topic tags clipped to 5', async () => {
    const callLLM = makeFakeCaller({ contentSummary: 's', entities: [], topicTags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })
    const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
    expect(r.data?.topicTags).toHaveLength(5)
  })

  it('走 per-agent routing：agentName 正確、wrapper 以單次模式呼叫（避免兩層 retry 相乘）', async () => {
    const callLLM = makeFakeCaller({ contentSummary: 's', entities: [], topicTags: [] })
    await enrichEntitySummary({ title: '標題', body: 'b' }, { callLLM })
    const params = callLLM.mock.calls[0]?.[0]
    expect(params?.agentName).toBe('corpus-entity-summary')
    expect(params?.maxRetries).toBe(1)
    expect(params?.userContent).toContain('標題')
  })

  it('成功時回傳實際 model 與 wrapper 實算成本（供 corpus 記帳）', async () => {
    const callLLM = makeFakeCaller({ contentSummary: 's', entities: [], topicTags: [] })
    const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
    expect(r.model).toMatch(/^gemini-/)
    expect(r.costUsd).toBe(0.0042)
    expect(r.tokensIn).toBe(2000)
  })

  // 這一段是重試預算：zod 比 Gemini structured output 嚴（confidence 限 0-1、topicTags ≤10），
  // 只有本檔擋得住的偏差、擋到就該再問一次而不是直接放棄整篇 enrichment。
  describe('retry budget', () => {
    it('zod 驗證失敗 → 重試 → 第二次成功', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const callLLM = makeFakeCaller(
        { contentSummary: 's', entities: [{ kind: 'company', name: 'x', confidence: 7 }], topicTags: [] }, // confidence 超出 0-1
        { contentSummary: 'ok', entities: [], topicTags: [] },
      )
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.failed).toBe(false)
      expect(r.data?.contentSummary).toBe('ok')
      expect(callLLM).toHaveBeenCalledTimes(2)
      vi.restoreAllMocks()
    })

    it('topicTags 超過 10 個（Gemini schema 擋不住）也會重試', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const callLLM = makeFakeCaller(
        { contentSummary: 's', entities: [], topicTags: Array.from({ length: 12 }, (_, i) => `t${i}`) },
        { contentSummary: 'ok', entities: [], topicTags: ['a'] },
      )
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.failed).toBe(false)
      expect(callLLM).toHaveBeenCalledTimes(2)
      vi.restoreAllMocks()
    })

    it('預設總嘗試次數 3（對齊搬進 wrapper 之前的行為）', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const callLLM = makeFakeCaller({ wrong: 'shape' })
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.failed).toBe(true)
      expect(callLLM).toHaveBeenCalledTimes(3)
      vi.restoreAllMocks()
    })

    it('provider 拋錯吃同一份預算（不是各算各的）', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const callLLM = makeFakeCaller(
        new Error('Gemini 500'),
        { contentSummary: 'ok', entities: [], topicTags: [] },
      )
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.failed).toBe(false)
      expect(callLLM).toHaveBeenCalledTimes(2)
      vi.restoreAllMocks()
    })

    it('maxAttempts 可調小為單次', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const callLLM = makeFakeCaller({ wrong: 'shape' })
      await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM, maxAttempts: 1 })
      expect(callLLM).toHaveBeenCalledTimes(1)
      vi.restoreAllMocks()
    })
  })

  // 失敗路徑不 silent swallow、且回 failed 而非 throw
  describe('failure semantics', () => {
    it('wrapper 拋錯（重試耗盡）→ 回 failed 不 throw + warn', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const callLLM = vi.fn(async () => {
        throw new Error('Gemini timeout')
      })
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.failed).toBe(true)
      expect(r.data).toBeNull()
      const msg = warnSpy.mock.calls[0]?.[0] as string
      expect(msg).toMatch(/entity-summary/)
      expect(msg).toMatch(/llm/i)
      expect(msg).toMatch(/Gemini timeout/)
      warnSpy.mockRestore()
    })

    it('zod schema 不符 → 回 failed + warn', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const callLLM = makeFakeCaller({ wrong: 'shape' })
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.failed).toBe(true)
      expect(r.data).toBeNull()
      const msg = warnSpy.mock.calls[0]?.[0] as string
      expect(msg).toMatch(/entity-summary/)
      expect(msg).toMatch(/schema/i)
      warnSpy.mockRestore()
    })
  })

  // 規格寫在 prompt 裡、沒有任何地方執行。長度走無損收斂、語言走 prompt。
  describe('contentSummary 規格把關', () => {
    it('過長的摘要被截到上限，且 entities / topicTags 不受牽連', async () => {
      const callLLM = makeFakeCaller({
        contentSummary: `${'甲'.repeat(90)}。${'乙'.repeat(200)}`,
        entities: [{ kind: 'company', name: '台積電', confidence: 0.9 }],
        topicTags: ['半導體', 'AI'],
      })
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.failed).toBe(false)
      expect(r.data?.contentSummary.length).toBeLessThanOrEqual(160)
      // 這一條是重點：長度偏差不得換掉整包標註
      expect(r.data?.entities).toHaveLength(1)
      expect(r.data?.topicTags).toEqual(['半導體', 'AI'])
      // 而且只問一次模型——長度不走重試
      expect(callLLM).toHaveBeenCalledTimes(1)
    })

    it('英文摘要照收不重試，只留一行 warn', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const english = 'The Federal Reserve held rates steady, citing persistent inflation.'
      const callLLM = makeFakeCaller({
        contentSummary: english,
        entities: [{ kind: 'macro', name: 'interest rate', confidence: 0.9 }],
        topicTags: ['fed'],
      })
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.failed).toBe(false)
      expect(r.data?.contentSummary).toBe(english)
      expect(callLLM).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls.some(c => /不是中文/.test(String(c[0])))).toBe(true)
      warnSpy.mockRestore()
    })

    it('正常長度的中文摘要原樣通過、不 warn', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const summary = '聯準會維持利率不變，會後聲明指出通膨壓力仍高於目標，並未給出降息時點。'
      const callLLM = makeFakeCaller({
        contentSummary: summary,
        entities: [{ kind: 'macro', name: '利率', confidence: 0.9 }],
        topicTags: ['fed'],
      })
      const r = await enrichEntitySummary({ title: 't', body: 'b' }, { callLLM })
      expect(r.data?.contentSummary).toBe(summary)
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })
})
