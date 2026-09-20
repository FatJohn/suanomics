import type { CascadeChain } from '@suanomics/shared'
import { tier1Chains } from './cascade-matrix.js'

/**
 * 一節長文連到哪幾條連動鏈。
 * brief 沒有 section→chain 的顯式外鍵，共用的 citation url 是唯一可靠的接點：
 * narrative section 的 citationUrls 與 chain 的 citations[].url 都指向同一批真實來源。
 * 只取第一層——展開層是預覽、完整結構在頁面下方的連動區。
 */
export function chainsForSection(chains: CascadeChain[], citationUrls: readonly string[]): CascadeChain[] {
  if (chains.length === 0 || citationUrls.length === 0)
    return []
  const urls = new Set(citationUrls)
  return tier1Chains(chains).filter(c => c.citations.some(x => urls.has(x.url)))
}

export interface SectionForce { kind: 'push' | 'damp', label: string }

/**
 * 這一節屬於圖上的哪一股力。這是長文接回力場圖的唯一一條線。
 * 判準是該節連到的第一層連動鏈的方向多數決——正向多＝推升、負向多＝壓抑。
 * 平手、全中性或沒連到任何鏈時回 null：分不出方向就不要硬標，硬標是逼讀者猜。
 */
export function sectionForce(chains: readonly CascadeChain[]): SectionForce | null {
  let push = 0
  let damp = 0
  for (const c of chains) {
    if (c.direction === 'positive')
      push++
    else if (c.direction === 'negative')
      damp++
  }
  if (push === damp)
    return null
  return push > damp ? { kind: 'push', label: '推升' } : { kind: 'damp', label: '壓抑' }
}

/** 展開層那一行的文案。兩邊都是 0 就回 null——沒有深度可展開時整條不該出現。 */
export function sectionDepthSummary(citationCount: number, linkCount: number): string | null {
  const parts: string[] = []
  if (citationCount > 0)
    parts.push(`${citationCount} 則引用`)
  if (linkCount > 0)
    parts.push(`${linkCount} 條連動`)
  if (parts.length === 0)
    return null
  return `展開這一節的 ${parts.join('與 ')}`
}
