import { readdir, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface PruneParams {
  candidatesBase: string
  maxRuns: number
}

export interface PruneResult {
  kept: string[]
  removed: string[]
}

export async function pruneOldCandidates(p: PruneParams): Promise<PruneResult> {
  const entries = await readdir(p.candidatesBase)
  const dirEntries: { name: string, mtimeMs: number }[] = []

  for (const name of entries) {
    const full = resolve(p.candidatesBase, name)
    const s = await stat(full)
    if (!s.isDirectory())
      continue
    dirEntries.push({ name, mtimeMs: s.mtimeMs })
  }

  if (dirEntries.length <= p.maxRuns) {
    return { kept: dirEntries.map(e => e.name), removed: [] }
  }

  dirEntries.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const kept = dirEntries.slice(0, p.maxRuns).map(e => e.name)
  const toRemove = dirEntries.slice(p.maxRuns)

  for (const e of toRemove) {
    await rm(resolve(p.candidatesBase, e.name), { recursive: true, force: true })
  }

  return { kept, removed: toRemove.map(e => e.name) }
}
