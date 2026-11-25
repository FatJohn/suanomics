import type { AnalystOutput, CascadeChain } from './types.js'
import { describe, expect, it } from 'vitest'
import { renumberChainsAcrossNews } from './chain-ids.js'

const base = { industry: 'i', mechanism: 'm', affectedTickers: [], direction: 'neutral' as const, citations: [] }
const t1 = (n: number): CascadeChain => ({ ...base, chainId: `t1-${n}`, tier: 1 })
const t2 = (n: number, parent: number): CascadeChain => ({ ...base, chainId: `t2-${n}`, tier: 2, parentChainId: `t1-${parent}` })
const output = (cascadeChains: CascadeChain[]): AnalystOutput => ({ primaryImpact: 'p', reasoning: 'r', claims: [], cascadeChains })

describe('renumberChainsAcrossNews', () => {
  it('t1 與 t2 各自跨新聞連號', () => {
    const out = renumberChainsAcrossNews([output([t1(0), t1(1), t2(0, 0)]), output([t1(0), t2(0, 0), t2(1, 0)])])
    expect(out.flatMap(o => o.cascadeChains.map(c => c.chainId))).toEqual(['t1-0', 't1-1', 't2-0', 't1-2', 't2-1', 't2-2'])
  })

  it('二階鏈的 parent 指向同則新聞改號後的一階鏈', () => {
    const out = renumberChainsAcrossNews([output([t1(0), t1(1)]), output([t1(0), t1(1), t2(0, 1)])])
    expect(out[1]?.cascadeChains[2]?.parentChainId).toBe('t1-3')
  })

  it('沒有 chainId 的鏈原樣保留，其他欄位不動', () => {
    const noId: CascadeChain = { ...base, industry: 'no-id' }
    const out = renumberChainsAcrossNews([output([noId, t1(0)])])
    expect(out[0]?.cascadeChains[0]).toEqual(noId)
    expect(out[0]?.primaryImpact).toBe('p')
  })

  it('不改動輸入', () => {
    const input = [output([t1(0)]), output([t1(0)])]
    renumberChainsAcrossNews(input)
    expect(input[1]?.cascadeChains[0]?.chainId).toBe('t1-0')
  })
})
