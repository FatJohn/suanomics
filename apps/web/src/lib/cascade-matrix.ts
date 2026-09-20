import type { CascadeChain } from '@suanomics/shared'

export type DirKey = 'up' | 'down' | 'neutral'

const DIR_ORDER: DirKey[] = ['up', 'down', 'neutral']
const GROUP_LABEL: Record<DirKey, string> = { up: '正向影響', down: '負向影響', neutral: '中性 / 訊號分歧' }
const DIR_LABEL: Record<DirKey, string> = { up: '↑ 正向', down: '↓ 負向', neutral: '— 中性' }
const DIR_ARROW: Record<DirKey, string> = { up: '↑', down: '↓', neutral: '—' }

export function toDirKey(direction: CascadeChain['direction']): DirKey {
  if (direction === 'positive')
    return 'up'
  if (direction === 'negative')
    return 'down'
  return 'neutral'
}

export function dirArrow(key: DirKey): string {
  return DIR_ARROW[key]
}
export function dirText(key: DirKey): string {
  return DIR_LABEL[key]
}

export interface MatrixItem { index: number, industry: string, dir: DirKey, arrow: string, dual: boolean, selected: boolean }
/**
 * `dir` 只有在依方向分組時有值。依力場分組時是 `null`——一股力裡本來就正負並存，
 * 給整組一個方向會騙人。
 */
export interface MatrixGroup { key: string, dir: DirKey | null, label: string, items: MatrixItem[] }

/** 歸不進任何一股力的那組。用一個不可能與力場名撞名的 key。 */
export const UNGROUPED_KEY = '__ungrouped__'
const UNGROUPED_LABEL = '其他連動'

export function tier1Chains(chains: CascadeChain[]): CascadeChain[] {
  return chains.filter(c => (c.tier ?? 1) === 1)
}

export function defaultSelectedIndex(chains: CascadeChain[]): number {
  return tier1Chains(chains).length > 0 ? 0 : -1
}

/**
 * 連動矩陣的分組。
 *
 * 兩種模式，由資料自己決定：**只要有任何一條 chain 標了 `forceGroup` 就依力場分組**，
 * 否則退回依方向分組。理由是 `industry` 是 analyst 每條 chain 各自命名的自由字串
 * （2026-07-31 的報告 51 條有 49 個不同名字），拿它當分類軸會碎成一條一格；力場分組
 * 讓連動結構與力場圖、長文節標題共用同一套產業語彙。grouper 之前產的 brief 沒有這個
 * 欄位，那時依方向分組仍然是唯一能用的軸。
 *
 * `forceOrder` 傳 `affectedIndustries` 的名稱順序，讓組序與力場圖一致；不傳就照
 * chains 裡首次出現的順序。歸不進去的那組永遠最後。
 */
export function buildMatrix(chains: CascadeChain[], selectedIndex: number, forceOrder?: string[]): MatrixGroup[] {
  const t1 = tier1Chains(chains)
  const counts = new Map<string, number>()
  for (const c of t1)
    counts.set(c.industry, (counts.get(c.industry) ?? 0) + 1)

  const toItem = ({ c, index }: { c: CascadeChain, index: number }): MatrixItem => {
    const dir = toDirKey(c.direction)
    return {
      index,
      industry: c.industry,
      dir,
      arrow: DIR_ARROW[dir],
      dual: (counts.get(c.industry) ?? 0) > 1,
      selected: index === selectedIndex,
    }
  }
  const indexed = t1.map((c, index) => ({ c, index }))

  if (chains.some(c => c.forceGroup !== undefined)) {
    const seen: string[] = []
    for (const { c } of indexed) {
      const k = c.forceGroup ?? UNGROUPED_KEY
      if (!seen.includes(k))
        seen.push(k)
    }
    // forceOrder 先排（只留當天真的有連動的），沒被點名的接在後面，未歸類永遠殿後
    const ordered = [
      ...(forceOrder ?? []).filter(k => seen.includes(k)),
      ...seen.filter(k => k !== UNGROUPED_KEY && !(forceOrder ?? []).includes(k)),
      ...(seen.includes(UNGROUPED_KEY) ? [UNGROUPED_KEY] : []),
    ]
    return ordered.map((key) => {
      const items = indexed.filter(({ c }) => (c.forceGroup ?? UNGROUPED_KEY) === key).map(toItem)
      const name = key === UNGROUPED_KEY ? UNGROUPED_LABEL : key
      return { key, dir: null, label: `${name} · ${items.length}`, items }
    }).filter(g => g.items.length > 0)
  }

  return DIR_ORDER.map((dir) => {
    const items = indexed.filter(({ c }) => toDirKey(c.direction) === dir).map(toItem)
    return { key: dir, dir, label: `${GROUP_LABEL[dir]} · ${items.length}`, items }
  }).filter(g => g.items.length > 0)
}

/**
 * 節標題那三個數字。**永遠是方向計數**，不隨分組模式改變——讀者在標題看到的
 * 「正向 9 負向 16 中性 6」問的是今天的力，不是它們被分成幾組。
 */
export function cascadeSummaryCounts(chains: CascadeChain[]): Record<DirKey, number> {
  const counts: Record<DirKey, number> = { up: 0, down: 0, neutral: 0 }
  for (const c of tier1Chains(chains))
    counts[toDirKey(c.direction)] += 1
  return counts
}

export interface CascadeChild { industry: string, dir: DirKey, dirLabel: string, mechanism: string }
export interface CascadeSibling { index: number, dir: DirKey, dirLabel: string, preview: string }
export interface CascadeDetail {
  industry: string
  dir: DirKey
  dirLabel: string
  citeLabel: string
  mechanism: string
  tickers: string[]
  children: CascadeChild[]
  siblings: CascadeSibling[]
}

export function buildDetail(chains: CascadeChain[], selectedIndex: number): CascadeDetail | null {
  const t1 = tier1Chains(chains)
  const sel = t1[selectedIndex]
  if (!sel)
    return null
  const dir = toDirKey(sel.direction)

  // guard: 選中的 chain 若無 chainId、不可讓「無 parentChainId 的 tier-2」誤判為其子鏈
  const children: CascadeChild[] = chains
    .filter(c => c.tier === 2 && sel.chainId !== undefined && c.parentChainId === sel.chainId)
    .map((c) => {
      const k = toDirKey(c.direction)
      return { industry: c.industry, dir: k, dirLabel: DIR_LABEL[k], mechanism: c.mechanism }
    })

  const siblings: CascadeSibling[] = t1
    .map((c, index) => ({ c, index }))
    .filter(({ c, index }) => c.industry === sel.industry && index !== selectedIndex)
    .map(({ c, index }) => {
      const k = toDirKey(c.direction)
      return { index, dir: k, dirLabel: DIR_LABEL[k], preview: c.mechanism }
    })

  return {
    industry: sel.industry,
    dir,
    dirLabel: DIR_LABEL[dir],
    citeLabel: sel.citations.length > 0 ? `引用 ${sel.citations.length} 筆` : '無外部佐證',
    mechanism: sel.mechanism,
    tickers: sel.affectedTickers,
    children,
    siblings,
  }
}
