import type { CascadeChain } from '@suanomics/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tagChainForceGroups } from './chain-grouper.js'
import * as wrapper from './llm-wrapper.js'

vi.mock('./llm-wrapper.js')

const llm = vi.mocked(wrapper.callAgentLLM)
function once(value: unknown) {
  llm.mockResolvedValueOnce(value as never)
}

function chain(industry: string): CascadeChain {
  return { industry, mechanism: 'm', affectedTickers: [], direction: 'positive', citations: [] }
}

const FORCES = ['半導體與先進代工', '金融與證券業']

describe('tagChainForceGroups', () => {
  beforeEach(() => {
    llm.mockReset()
  })

  it('把 label 的歸類套回每一條 chain，而不是只回傳映射', async () => {
    once({ mapping: [{ label: '先進晶圓代工', force: '半導體與先進代工' }, { label: '銀行業', force: '金融與證券業' }] })

    const out = await tagChainForceGroups({ chains: [chain('先進晶圓代工'), chain('銀行業')], forceNames: FORCES })

    expect(out.map(c => c.forceGroup)).toEqual(['半導體與先進代工', '金融與證券業'])
  })

  it('同一個 label 出現在多條 chain 上時，每條都要標到（去重只發生在送進 LLM 的那份）', async () => {
    once({ mapping: [{ label: '半導體', force: '半導體與先進代工' }] })

    const out = await tagChainForceGroups({ chains: [chain('半導體'), chain('半導體')], forceNames: FORCES })

    expect(out.map(c => c.forceGroup)).toEqual(['半導體與先進代工', '半導體與先進代工'])
    // 送出去的 user content 裡那個 label 只列一次（整行比對——力場名「半導體與先進代工」
    // 也以「- 半導體」開頭，用 includes 數會多算）
    const sent = String(llm.mock.calls[0]?.[0]?.userContent ?? '')
    expect(sent.split('\n').filter(l => l === '- 半導體')).toHaveLength(1)
  })

  it('模型回 "null" 的 label 標成 null——歸不進去是正常結果不是失敗', async () => {
    once({ mapping: [{ label: '生技製藥CDMO', force: 'null' }] })

    const out = await tagChainForceGroups({ chains: [chain('生技製藥CDMO')], forceNames: FORCES })

    expect(out[0]?.forceGroup).toBeNull()
  })

  it('模型自創或改寫過的分組名一律當歸不進去', async () => {
    // spike 實測過的真實失敗樣態：力場名被抄成「半導體與先進代工（mixed）」
    once({ mapping: [{ label: '半導體', force: '半導體與先進代工（mixed）' }, { label: '銀行業', force: '我自己想的分組' }] })

    const out = await tagChainForceGroups({ chains: [chain('半導體'), chain('銀行業')], forceNames: FORCES })

    expect(out.map(c => c.forceGroup)).toEqual([null, null])
  })

  it('模型漏掉的 label 標成 null，不是留 undefined', async () => {
    once({ mapping: [{ label: '半導體', force: '半導體與先進代工' }] })

    const out = await tagChainForceGroups({ chains: [chain('半導體'), chain('沒被回覆的產業')], forceNames: FORCES })

    expect(out[1]?.forceGroup).toBeNull()
  })

  it('llm 失敗時原樣回傳、forceGroup 全部留 undefined——讀者面靠這個退回不分組', async () => {
    llm.mockRejectedValueOnce(new Error('boom'))

    const out = await tagChainForceGroups({ chains: [chain('半導體')], forceNames: FORCES })

    expect(out).toHaveLength(1)
    expect(out[0]?.forceGroup).toBeUndefined()
  })

  it('沒有力場名時不呼叫 LLM', async () => {
    const out = await tagChainForceGroups({ chains: [chain('半導體')], forceNames: [] })

    expect(llm).not.toHaveBeenCalled()
    expect(out[0]?.forceGroup).toBeUndefined()
  })

  it('沒有 chain 時不呼叫 LLM', async () => {
    const out = await tagChainForceGroups({ chains: [], forceNames: FORCES })

    expect(llm).not.toHaveBeenCalled()
    expect(out).toEqual([])
  })

  it('力場名單獨餵、不帶方向後綴——spike 實測帶後綴模型會照抄進 force', async () => {
    once({ mapping: [] })

    await tagChainForceGroups({ chains: [chain('半導體')], forceNames: FORCES })

    const sent = String(llm.mock.calls[0]?.[0]?.userContent ?? '')
    expect(sent).toContain('- 半導體與先進代工\n')
    expect(sent).not.toMatch(/半導體與先進代工[（(]/)
  })
})
