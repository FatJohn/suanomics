import type { CascadeChain } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildDetail, buildMatrix, cascadeSummaryCounts, defaultSelectedIndex, toDirKey } from './cascade-matrix.js'

function chain(p: Partial<CascadeChain> & { industry: string, direction: CascadeChain['direction'] }): CascadeChain {
  return { mechanism: 'm', affectedTickers: [], citations: [], ...p }
}

const CHAINS: CascadeChain[] = [
  chain({ industry: '半導體', direction: 'positive', chainId: 't1-1', tier: 1, affectedTickers: ['2330'], citations: [{ url: 'u', title: 't', quote: 'q' }] }),
  chain({ industry: '半導體', direction: 'negative', chainId: 't1-2', tier: 1 }),
  chain({ industry: '金融', direction: 'neutral', chainId: 't1-3', tier: 1 }),
  chain({ industry: 'ASIC', direction: 'positive', chainId: 't2-1', tier: 2, parentChainId: 't1-1' }),
]

describe('toDirKey', () => {
  it('shouldMapPositiveNegativeNeutralToUpDownNeutral', () => {
    expect(toDirKey('positive')).toBe('up')
    expect(toDirKey('negative')).toBe('down')
    expect(toDirKey('neutral')).toBe('neutral')
  })
})

describe('buildMatrix', () => {
  it('shouldGroupTier1ByDirectionAndDropEmptyGroups', () => {
    const groups = buildMatrix(CHAINS, 0)
    expect(groups.map(g => g.dir)).toEqual(['up', 'down', 'neutral'])
    expect(groups[0]?.label).toBe('正向影響 · 1')
    expect(groups[1]?.label).toBe('負向影響 · 1')
    expect(groups[2]?.label).toBe('中性 / 訊號分歧 · 1')
  })
  it('shouldExcludeTier2FromMatrix', () => {
    const all = buildMatrix(CHAINS, 0).flatMap(g => g.items)
    expect(all.every(i => i.industry !== 'ASIC')).toBe(true)
    expect(all).toHaveLength(3)
  })
  it('shouldFlagDualWhenIndustryAppearsMoreThanOnce', () => {
    const items = buildMatrix(CHAINS, 0).flatMap(g => g.items)
    expect(items.filter(i => i.industry === '半導體').every(i => i.dual)).toBe(true)
    expect(items.find(i => i.industry === '金融')?.dual).toBe(false)
  })
  it('shouldMarkSelectedByTier1Index', () => {
    const items = buildMatrix(CHAINS, 1).flatMap(g => g.items)
    expect(items.find(i => i.selected)?.index).toBe(1)
  })
})

describe('buildMatrix（力場分組模式）', () => {
  const GROUPED: CascadeChain[] = [
    chain({ industry: '先進晶圓代工', direction: 'positive', chainId: 't1-1', tier: 1, forceGroup: '半導體與先進代工' }),
    chain({ industry: 'Semiconductors', direction: 'negative', chainId: 't1-2', tier: 1, forceGroup: '半導體與先進代工' }),
    chain({ industry: '銀行業', direction: 'negative', chainId: 't1-3', tier: 1, forceGroup: '金融與證券業' }),
    chain({ industry: '生技製藥CDMO', direction: 'positive', chainId: 't1-4', tier: 1, forceGroup: null }),
  ]

  it('只要有任何一條標了 forceGroup 就改用力場分組', () => {
    const groups = buildMatrix(GROUPED, 0)
    expect(groups.map(g => g.label)).toEqual(['半導體與先進代工 · 2', '金融與證券業 · 1', '其他連動 · 1'])
  })

  it('歸不進去的那組永遠排最後，即使它在 chains 裡排在前面', () => {
    const nullFirst = GROUPED.filter(c => c.chainId === 't1-4' || c.chainId === 't1-1')
      .sort(a => (a.chainId === 't1-4' ? -1 : 1))
    expect(buildMatrix(nullFirst, 0).map(g => g.key)).toEqual(['半導體與先進代工', '__ungrouped__'])
  })

  it('給了 forceOrder 就照力場圖的順序排，不照 chains 的出現順序', () => {
    const groups = buildMatrix(GROUPED, 0, ['金融與證券業', '半導體與先進代工'])
    expect(groups.map(g => g.key)).toEqual(['金融與證券業', '半導體與先進代工', '__ungrouped__'])
  })

  it('forceOrder 裡當天沒有連動的力場不會生出空組', () => {
    const groups = buildMatrix(GROUPED, 0, ['再生能源與電力基礎建設', '半導體與先進代工'])
    expect(groups.map(g => g.key)).toEqual(['半導體與先進代工', '金融與證券業', '__ungrouped__'])
  })

  it('分組換了、每個 chip 自己的方向不變', () => {
    const items = buildMatrix(GROUPED, 0).flatMap(g => g.items)
    expect(items.find(i => i.industry === 'Semiconductors')?.dir).toBe('down')
    expect(items.find(i => i.industry === '先進晶圓代工')?.dir).toBe('up')
  })

  it('力場分組時組本身沒有方向——一組裡本來就正負並存', () => {
    expect(buildMatrix(GROUPED, 0).every(g => g.dir === null)).toBe(true)
  })

  it('全部都是 undefined（grouper 之前的舊 brief）退回依方向分組', () => {
    const groups = buildMatrix(CHAINS, 0)
    expect(groups.map(g => g.dir)).toEqual(['up', 'down', 'neutral'])
  })

  it('方向計數不受分組模式影響——節標題那三個數字要一直是方向', () => {
    expect(cascadeSummaryCounts(GROUPED)).toEqual({ up: 2, down: 2, neutral: 0 })
  })
})

describe('buildDetail', () => {
  it('shouldReturnNullWhenIndexOutOfRange', () => {
    expect(buildDetail(CHAINS, 99)).toBeNull()
    expect(buildDetail([], 0)).toBeNull()
  })
  it('shouldBuildDetailWithCiteLabelTickersAndChildren', () => {
    const d = buildDetail(CHAINS, 0)
    expect(d).not.toBeNull()
    expect(d?.industry).toBe('半導體')
    expect(d?.dir).toBe('up')
    expect(d?.citeLabel).toBe('引用 1 筆')
    expect(d?.tickers).toEqual(['2330'])
    expect(d?.children.map(c => c.industry)).toEqual(['ASIC'])
  })
  it('shouldUseNoCitationLabelWhenEmpty', () => {
    expect(buildDetail(CHAINS, 1)?.citeLabel).toBe('無外部佐證')
  })
  it('shouldListSameIndustrySiblingsExcludingSelf', () => {
    const d = buildDetail(CHAINS, 0)
    expect(d).not.toBeNull()
    expect(d?.siblings).toHaveLength(1)
    expect(d?.siblings[0]?.index).toBe(1)
    expect(d?.siblings[0]?.dir).toBe('down')
  })
  it('shouldNotMatchParentlessChildrenWhenSelectedHasNoChainId', () => {
    // schema allows a tier-1 chain without chainId; it must not vacuously
    // adopt parentless tier-2 chains as children
    const noId: CascadeChain[] = [
      chain({ industry: '能源', direction: 'positive' }),
      chain({ industry: '塑化', direction: 'positive', tier: 2 }),
    ]
    const d = buildDetail(noId, 0)
    expect(d).not.toBeNull()
    expect(d?.children).toEqual([])
  })
})

describe('defaultSelectedIndex', () => {
  it('shouldReturnZeroWhenTier1ExistsElseMinusOne', () => {
    expect(defaultSelectedIndex(CHAINS)).toBe(0)
    expect(defaultSelectedIndex([])).toBe(-1)
  })
})

describe('cascadeSummaryCounts', () => {
  it('shouldCountTier1ChainsPerDirection', () => {
    const chains: CascadeChain[] = [
      chain({ industry: 'A', direction: 'positive', tier: 1 }),
      chain({ industry: 'B', direction: 'negative', tier: 1 }),
      chain({ industry: 'C', direction: 'negative', tier: 1 }),
      chain({ industry: 'D', direction: 'neutral', tier: 1 }),
    ]
    expect(cascadeSummaryCounts(chains)).toEqual({ up: 1, down: 2, neutral: 1 })
  })
  it('shouldReturnZerosForEmptyChains', () => {
    expect(cascadeSummaryCounts([])).toEqual({ up: 0, down: 0, neutral: 0 })
  })
})
