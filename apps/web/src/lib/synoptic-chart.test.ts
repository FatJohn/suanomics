import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildFront, buildIsobars, dateSeed, selectForces } from './synoptic-chart.js'

type Industry = MarketBrief['affectedIndustries'][number]

function industry(over: Partial<Industry>): Industry {
  return {
    name: '半導體',
    direction: 'positive',
    confidence: 'medium',
    reasoning: 'r',
    ...over,
  } as Industry
}

describe('dateSeed', () => {
  it('是決定性的：同一個日期永遠得到同一個值', () => {
    expect(dateSeed('2026-07-24')).toBe(dateSeed('2026-07-24'))
  })

  it('不同日期得到不同的值（否則每天的圖會長一樣）', () => {
    expect(dateSeed('2026-07-24')).not.toBe(dateSeed('2026-07-25'))
  })

  it('落在 0..1', () => {
    for (const d of ['2026-01-01', '2026-07-24', '2026-12-31', '']) {
      const s = dateSeed(d)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(1)
    }
  })
})

describe('selectForces', () => {
  it('推升取信心最高的 positive、壓抑取信心最高的 negative', () => {
    const forces = selectForces([
      industry({ name: '低信心多方', direction: 'positive', confidence: 'low' }),
      industry({ name: '高信心多方', direction: 'positive', confidence: 'high' }),
      industry({ name: '中信心空方', direction: 'negative', confidence: 'medium' }),
    ])
    expect(forces.push?.industry).toBe('高信心多方')
    expect(forces.damp?.industry).toBe('中信心空方')
  })

  it('同信心時保留 editor 的排序（取先出現的）', () => {
    const forces = selectForces([
      industry({ name: '先', direction: 'positive', confidence: 'high' }),
      industry({ name: '後', direction: 'positive', confidence: 'high' }),
    ])
    expect(forces.push?.industry).toBe('先')
  })

  it('mixed 與 uncertain 不會成為具名力場中心', () => {
    const forces = selectForces([
      industry({ name: '混合', direction: 'mixed', confidence: 'high' }),
      industry({ name: '不確定', direction: 'uncertain', confidence: 'high' }),
    ])
    expect(forces.push).toBeNull()
    expect(forces.damp).toBeNull()
  })

  it('缺一邊時另一邊仍然成立（版面必須承受單邊）', () => {
    const forces = selectForces([industry({ direction: 'negative', confidence: 'high' })])
    expect(forces.push).toBeNull()
    expect(forces.damp).not.toBeNull()
  })

  it('空陣列不炸', () => {
    expect(selectForces([])).toEqual({ push: null, damp: null })
  })

  it('信心轉成強度：high > medium > low，且都在 0..1', () => {
    const strengthOf = (confidence: Industry['confidence']): number => {
      const center = selectForces([industry({ confidence })]).push
      if (!center)
        throw new Error(`expected a push centre for confidence=${confidence}`)
      return center.strength
    }
    expect(strengthOf('high')).toBeGreaterThan(strengthOf('medium'))
    expect(strengthOf('medium')).toBeGreaterThan(strengthOf('low'))
    expect(strengthOf('low')).toBeGreaterThan(0)
    expect(strengthOf('high')).toBeLessThanOrEqual(1)
  })

  it('用白話標籤，不用氣象術語', () => {
    const forces = selectForces([
      industry({ direction: 'positive' }),
      industry({ direction: 'negative' }),
    ])
    expect(forces.push?.label).toBe('推升')
    expect(forces.damp?.label).toBe('壓抑')
  })
})

describe('buildFront', () => {
  const W = 1180
  const H = 600

  it('回傳可用的 SVG path 與記號點', () => {
    const { path, markers } = buildFront(dateSeed('2026-07-24'), W, H)
    expect(path.startsWith('M')).toBe(true)
    expect(markers.length).toBeGreaterThan(2)
  })

  it('同一個 seed 得到同一條線（每日重新整理不能變形）', () => {
    const a = buildFront(0.42, W, H)
    const b = buildFront(0.42, W, H)
    expect(a.path).toBe(b.path)
  })

  it('不同 seed 得到不同的線', () => {
    expect(buildFront(0.1, W, H).path).not.toBe(buildFront(0.9, W, H).path)
  })

  it('整條線留在畫布的中段，不會頂到上下緣', () => {
    for (const seed of [0, 0.13, 0.5, 0.77, 0.99]) {
      const { markers } = buildFront(seed, W, H)
      for (const m of markers) {
        expect(m.y).toBeGreaterThan(H * 0.2)
        expect(m.y).toBeLessThan(H * 0.8)
        expect(m.x).toBeGreaterThanOrEqual(0)
        expect(m.x).toBeLessThanOrEqual(W)
      }
    }
  })
})

describe('buildIsobars', () => {
  it('產生數條決定性的淡曲線', () => {
    const a = buildIsobars(0.33, 1180, 600)
    const b = buildIsobars(0.33, 1180, 600)
    expect(a.length).toBeGreaterThan(1)
    expect(a).toEqual(b)
    expect(a.every(d => d.startsWith('M'))).toBe(true)
  })
})
