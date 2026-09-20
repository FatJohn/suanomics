import type { EvidenceClaim } from '@suanomics/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as wrapper from './llm-wrapper.js'
import { runViewpointsDebate } from './viewpoints-debate.js'

vi.mock('./llm-wrapper.js')

const PARAMS = {
  thesis: '今日主線由 AI 算力與利率拉鋸主導',
  headline: 'h',
  summary: 's',
  marketSnapshot: null,
  cascadeChains: [],
}

const llm = vi.mocked(wrapper.callAgentLLM)
// callAgentLLM 為泛型、mock 回傳值以 as never 迴避 T 推導
function once(value: unknown) {
  llm.mockResolvedValueOnce(value as never)
}
// 3 次呼叫順序：support（Promise.all 陣列序 0）→ risk（序 1）→ net-read（await 後）
function mockDebate(support: string[], risk: string[], netRead: string) {
  once({ points: support })
  once({ points: risk })
  once({ netRead })
}

describe('runViewpointsDebate', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns viewpoints on happy path', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.supportPoints).toEqual(['支持一', '支持二'])
    expect(out?.riskPoints).toEqual(['風險一', '風險二'])
    expect(out?.netRead.length).toBe(130)
  })

  // ledger 必須真的抵達**兩個 side** 的 userContent。只在 params 上加欄位、
  // 忘了往 buildDebateMaterial 傳，型別與其餘測試都不會紅。
  it('passes claim ledger into both support and risk material', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
    const claim: EvidenceClaim = {
      id: 'c18',
      kind: 'fact',
      claimType: 'named-number',
      claim: '2026年8月11日費城半導體指數收於12,098點。',
      evidenceRefs: [],
      asOf: '2026-08-11',
      checks: [],
    }
    await runViewpointsDebate({ ...PARAMS, claimLedger: [claim] })
    const [support, risk] = llm.mock.calls
    expect(support?.[0]?.userContent).toContain('[c18]')
    expect(support?.[0]?.userContent).toContain('12,098')
    expect(risk?.[0]?.userContent).toContain('[c18]')
    expect(risk?.[0]?.userContent).toContain('12,098')
  })

  // 亂碼防線（2026-08-12 A/B 觀察到的真實產出、當時通過了 compliance gate 與 schema）
  const GARBLED = '成由攥䍕挧攥萱刑甘成甥、嘐瀕外資售日買超台股達903.08億元。'

  it('drops a garbled point but keeps viewpoints when >=2 clean remain', async () => {
    mockDebate(['支持一', '支持二', GARBLED], ['風險一', '風險二'], 'a'.repeat(130))
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.supportPoints).toEqual(['支持一', '支持二'])
  })

  it('degrades to null when netRead is garbled', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], `${GARBLED}${'a'.repeat(130)}`)
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  it('degrades to null when garbling leaves fewer than 2 risk points', async () => {
    mockDebate(['支持一', '支持二'], [GARBLED, `${GARBLED}又一句`], 'a'.repeat(130))
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  // 句級降級：單一違規 point 被丟棄、其餘保留（只要仍 ≥2 點）
  it('strips a violating support point but keeps viewpoints when >=2 clean remain', async () => {
    mockDebate(['支持一', '支持二', '佈局科技股'], ['風險一', '風險二'], 'a'.repeat(130))
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.supportPoints).toEqual(['支持一', '支持二'])
    expect(out?.riskPoints).toEqual(['風險一', '風險二'])
  })

  it('strips violating points from both support and risk', async () => {
    mockDebate(['支持一', '看多台股', '支持三'], ['風險一', '做空科技', '風險三'], 'a'.repeat(130))
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.supportPoints).toEqual(['支持一', '支持三'])
    expect(out?.riskPoints).toEqual(['風險一', '風險三'])
  })

  // 句級降級：net-read 內的違規句被丟棄、乾淨句保留（strip 後仍 >=120 字）
  it('strips a violating sentence from net-read but keeps the clean remainder', async () => {
    const cleanSentence = '此觀點在利率穩定下成立且資金回流。' // 17 字含句號
    const clean = cleanSentence.repeat(8) // 136 字、>=120
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], `${clean}這裡建議買進股票。`)
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.netRead).toBe(clean)
    expect(out?.netRead).not.toContain('建議買')
  })

  // 丟棄違規 point 後不足 2 點 → schema invalid → degrade null
  it('degrades to null when stripping drops support below min 2', async () => {
    mockDebate(['支持一', '佈局台積電'], ['風險一', '風險二'], 'a'.repeat(130))
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  // net-read 整句皆違規（strip 後清空）→ 低於 min 120 → degrade null
  it('degrades to null when net-read strips below min length', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], `${'a'.repeat(120)}建議買`)
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  it('degrades to null when fewer than 2 points (schema invalid)', async () => {
    mockDebate(['只有一點'], ['風險一', '風險二'], 'a'.repeat(130))
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  it('degrades to null when an LLM call throws', async () => {
    llm.mockRejectedValue(new Error('gemini 500') as never)
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  it('uses agentName viewpoints-debate for all three calls', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
    await runViewpointsDebate(PARAMS)
    const names = llm.mock.calls.map(c => (c[0] as { agentName: string }).agentName)
    expect(names).toEqual(['viewpoints-debate', 'viewpoints-debate', 'viewpoints-debate'])
  })
})
