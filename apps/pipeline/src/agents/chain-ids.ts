import type { AnalystOutput } from './types.js'

// stampTier1 與 tier2 fanout 是每則新聞各自從 0 編號，合併進同一份 brief 就撞號。
// 改號要逐則做：parentChainId 只在同一則新聞內有意義，先合併再改就分不出父鏈是哪一條。
export function renumberChainsAcrossNews(outputs: readonly AnalystOutput[]): AnalystOutput[] {
  const nextByPrefix = new Map<string, number>()
  const allocate = (oldId: string): string => {
    const prefix = oldId.slice(0, oldId.indexOf('-'))
    const n = nextByPrefix.get(prefix) ?? 0
    nextByPrefix.set(prefix, n + 1)
    return `${prefix}-${n}`
  }

  return outputs.map((output) => {
    const newIdByOld = new Map<string, string>()
    for (const c of output.cascadeChains) {
      if (c.chainId !== undefined)
        newIdByOld.set(c.chainId, allocate(c.chainId))
    }
    return {
      ...output,
      cascadeChains: output.cascadeChains.map(c => ({
        ...c,
        ...(c.chainId !== undefined ? { chainId: newIdByOld.get(c.chainId) } : {}),
        ...(c.parentChainId !== undefined ? { parentChainId: newIdByOld.get(c.parentChainId) ?? c.parentChainId } : {}),
      })),
    }
  })
}
