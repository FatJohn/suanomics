import type { LlmCallRecord } from './llm-wrapper.js'
import { checkCompliance } from '@suanomics/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as wrapper from './llm-wrapper.js'
import { buildMarketCloseFraming } from './market-close-framing.js'
import { callSynthesizer, sanitizeSynthesizerOutput } from './synthesizer.js'

vi.mock('./llm-wrapper.js')
vi.mock('../prompts/synthesizer.prompt.js', () => ({
  SYNTHESIZER_SYSTEM_PROMPT: 'TEST_SYN',
}))
vi.mock('@suanomics/shared', async () => {
  const actual = await vi.importActual<typeof import('@suanomics/shared')>('@suanomics/shared')
  return { ...actual, checkCompliance: vi.fn() }
})

// Synthesizer 解耦後只產 prose（無 citations / disclaimer）。relatedNews 改 newsId 引用。
const validSynth = {
  headline: '產業連動觀察',
  summary: 'sector level analysis',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['第一步觀察', '第二步推論'],
}

describe('callSynthesizer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Default: compliance passes — individual tests override as needed
    vi.mocked(checkCompliance).mockReturnValue(null)
  })

  it('should return synthesizer output when compliance passes', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(validSynth)
    const out = await callSynthesizer({ analystOutputs: [], date: '2026-04-25' })
    expect(out.summary).toBe('sector level analysis')
  })

  it('should retry once with feedback when compliance violates', async () => {
    vi.mocked(wrapper.callAgentLLM)
      .mockResolvedValueOnce({ ...validSynth, summary: 'TSMC 加碼' })
      .mockResolvedValueOnce(validSynth)
    vi.mocked(checkCompliance)
      .mockReturnValueOnce({ violation: 'ticker-direction', matched: 'TSMC 加碼' })
      .mockReturnValueOnce(null)
    const out = await callSynthesizer({ analystOutputs: [], date: '2026-04-25' })
    expect(out.summary).toBe('sector level analysis')
    expect(wrapper.callAgentLLM).toHaveBeenCalledTimes(2)
  })

  it('should sanitize and return best-effort after retries exhausted (no throw)', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ ...validSynth, summary: '做多 TSMC' })
    vi.mocked(checkCompliance).mockReturnValue({ violation: 'forbidden', matched: '做多' })
    const out = await callSynthesizer({ analystOutputs: [], date: '2026-04-25' })
    expect(out.summary).toBe('順向部位 TSMC') // sanitize fallback 改寫、不 throw
    expect(wrapper.callAgentLLM).toHaveBeenCalledTimes(3)
  })

  it('emits synthForbiddenSanitized count when sanitize fallback runs', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ ...validSynth, summary: '做多' })
    vi.mocked(checkCompliance).mockReturnValue({ violation: 'forbidden', matched: '做多' })
    const records: LlmCallRecord[] = []
    await callSynthesizer({ analystOutputs: [], date: '2026-04-25', onCallRecord: r => records.push(r) })
    const audit = records.find(r => r.synthForbiddenSanitized !== undefined)
    expect(audit?.synthForbiddenSanitized).toBe(1)
  })

  it('hard-cuts summary > 300 with no sentence boundary (fallback, no 「…」)', async () => {
    const longSummary = 'A'.repeat(500) // 無句界 → fallback 硬切到 300
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ ...validSynth, summary: longSummary })
    const out = await callSynthesizer({ analystOutputs: [], date: '2026-04-25' })
    expect(out.summary.length).toBe(300)
    expect(out.summary.endsWith('…')).toBe(false)
  })

  it('truncates summary > 300 at sentence boundary without 「…」', async () => {
    const longSummary = '今日市場重點摘要。'.repeat(40) // 360 字、每句以。結尾
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({ ...validSynth, summary: longSummary })
    const out = await callSynthesizer({ analystOutputs: [], date: '2026-04-25' })
    expect(out.summary.length).toBeLessThanOrEqual(300)
    expect(out.summary.endsWith('。')).toBe(true)
    expect(out.summary).not.toContain('…')
  })

  it('synthesizer user content includes market snapshot when provided', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(validSynth)
    await callSynthesizer({ analystOutputs: [], date: '2026-04-25', marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點' })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('## 今日市場數據')
    expect(args?.userContent).toContain('# 市場數據參考')
    expect(args?.userContent).toContain('照抄')
  })

  it('synthesizer user content omits market section when null', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(validSynth)
    await callSynthesizer({ analystOutputs: [], date: '2026-04-25', marketSnapshot: null })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('今日市場數據')
  })

  it('marks speculative chain industry line with [推測] and appends 語氣指示句', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(validSynth)
    const baseChain = {
      industry: '半導體',
      mechanism: '需求傳導',
      affectedTickers: ['2330'],
      direction: 'positive' as const,
      citations: [],
    }
    await callSynthesizer({
      analystOutputs: [{
        newsId: 'n1',
        primaryImpact: '主衝擊',
        cascadeChains: [{ ...baseChain, speculative: true }],
        reasoning: 'r',
      }],
      date: '2026-06-13',
    })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).toContain('industry: 半導體 [推測]')
    expect(args?.userContent).toContain('標 [推測] 的傳導鏈無來源佐證、請以「若…則…」條件語氣呈現、不得作為 highlights 依據。')
  })

  it('omits [推測] marker and 指示句 when no speculative chain', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(validSynth)
    const baseChain = {
      industry: '半導體',
      mechanism: '需求傳導',
      affectedTickers: ['2330'],
      direction: 'positive' as const,
      citations: [],
    }
    await callSynthesizer({
      analystOutputs: [{
        newsId: 'n1',
        primaryImpact: '主衝擊',
        cascadeChains: [baseChain],
        reasoning: 'r',
      }],
      date: '2026-06-13',
    })
    const args = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(args?.userContent).not.toContain('[推測]')
    expect(args?.userContent).not.toContain('語氣呈現')
  })

  it('throws a clear invariant error when maxComplianceRetries is 0 (no attempts run)', async () => {
    await expect(callSynthesizer({ analystOutputs: [], date: '2026-04-25', maxComplianceRetries: 0 }))
      .rejects
      .toThrow(/no parseable output/)
  })

  it('有 continuityHint 時注入 hint + 誠實指引到 user content', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(validSynth)
    await callSynthesizer({
      analystOutputs: [],
      date: '2026-06-24',
      continuityHint: '延續主線「能源通膨」（已追蹤 3 天）：原油庫存意外增加',
    })
    const arg = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(arg?.userContent).toContain('延續主線「能源通膨」（已追蹤 3 天）：原油庫存意外增加')
    expect(arg?.userContent).toContain('勿硬連')
  })

  it('無 continuityHint 時不注入連續段', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(validSynth)
    await callSynthesizer({ analystOutputs: [], date: '2026-06-24' })
    const arg = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(arg?.userContent).not.toContain('延續追蹤線')
  })

  it('注入市場收盤時間框架 block + 規則句', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(validSynth)
    await callSynthesizer({
      analystOutputs: [],
      date: '2026-06-27',
      marketCloseFraming: buildMarketCloseFraming('2026-06-26', '2026-06-27'),
    })
    const uc = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? ''
    expect(uc).toContain('市場收盤時間框架')
    expect(uc).toContain('台股')
  })

  it('should include violation type but NOT echo matched substring in retry user content (C1 防 echo)', async () => {
    vi.mocked(wrapper.callAgentLLM)
      .mockResolvedValueOnce({ ...validSynth, summary: '非法字' })
      .mockResolvedValueOnce(validSynth)
    vi.mocked(checkCompliance)
      .mockReturnValueOnce({ violation: 'forbidden', matched: '非法字' })
      .mockReturnValueOnce(null)
    await callSynthesizer({ analystOutputs: [], date: '2026-04-25' })
    const secondCall = vi.mocked(wrapper.callAgentLLM).mock.calls[1]?.[0]
    // 違反類型必須回到 prompt（讓 LLM 知道哪一類失敗）
    expect(secondCall?.userContent).toContain('forbidden')
    expect(secondCall?.userContent).toMatch(/重寫整段/)
    // 但 matched substring 不可 echo：echo 提高下次再 echo 的機率、同樣的失敗模式
    expect(secondCall?.userContent).not.toContain('非法字')
  })
})

describe('sanitizeSynthesizerOutput', () => {
  const base = {
    headline: '',
    summary: '',
    relatedNews: [],
    affectedIndustries: [],
    relatedETFs: [],
    reasoningChain: [],
  }
  it('rewrites map-covered directional phrases across prose fields and counts distinct hits', () => {
    const { sanitized, count } = sanitizeSynthesizerOutput({
      ...base,
      headline: '做多訊號',
      summary: '看空台積電',
      reasoningChain: ['偏多'],
    })
    expect(sanitized.headline).toBe('順向部位訊號')
    expect(sanitized.summary).toBe('估值承壓台積電')
    expect(sanitized.reasoningChain[0]).toBe('動能偏強')
    expect(count).toBe(3)
  })

  it('rewrites nested relatedNews / affectedIndustries / relatedETFs prose, leaves enum/ticker', () => {
    const { sanitized } = sanitizeSynthesizerOutput({
      ...base,
      relatedNews: [{ newsId: 'n1', relationType: 'cause', reasoning: '建議觀察' }],
      affectedIndustries: [{ name: '半導體', direction: 'positive', confidence: 'high', reasoning: '值得關注' }],
      relatedETFs: [{ ticker: '0050', name: '台灣50', rationale: '可以考慮' }],
    })
    expect(sanitized.relatedNews[0]?.reasoning).toBe('後續可觀察')
    expect(sanitized.relatedNews[0]?.relationType).toBe('cause')
    expect(sanitized.affectedIndustries[0]?.reasoning).toBe('後續可觀察')
    expect(sanitized.affectedIndustries[0]?.direction).toBe('positive')
    expect(sanitized.relatedETFs[0]?.rationale).toBe('可評估')
    expect(sanitized.relatedETFs[0]?.ticker).toBe('0050')
  })

  it('leaves phrases not in the rewrite map untouched (count 0)', () => {
    const { sanitized, count } = sanitizeSynthesizerOutput({ ...base, headline: '建議買進', summary: '一般觀察' })
    expect(sanitized.headline).toBe('建議買進')
    expect(count).toBe(0)
  })
})
