import type { AnalystOutput } from './types.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

// entity normalization map。
//
// decomposer 出英文 entity（Fed / FOMC / TSMC）、
// external_articles 用中文 tag（聯準會 / 台積電）、字面比對的 retriever GIN
// `entities @>` 命中 0 → 全 placeholder。此 module 提供 alias
// expansion + canonicalization、retriever 用來擴查、routing 用來
// 算 entity 60% 交集。
//
// 不對 LLM 曝露 canonical 字串、那是純內部識別（合理 slug 化即可）。

export interface AliasGroup {
  canonical: string
  aliases: string[]
}

export interface AliasMap {
  // 任一 form 過 normalize（trim + toLowerCase）後 → canonical key
  formToCanonical: Map<string, string>
  // canonical → 該 group 所有原始 form（保留 case、給 retriever 直接餵 GIN）
  canonicalToAliases: Map<string, string[]>
}

function normalizeForm(s: string): string {
  return s.trim().toLowerCase()
}

export function buildAliasMap(groups: AliasGroup[]): AliasMap {
  const formToCanonical = new Map<string, string>()
  const canonicalToAliases = new Map<string, string[]>()
  for (const g of groups) {
    const canonical = g.canonical.trim().toLowerCase()
    if (!canonical)
      continue
    const aliasForms = Array.from(new Set(g.aliases.map(a => a.trim()).filter(a => a.length > 0)))
    canonicalToAliases.set(canonical, aliasForms)
    // canonical 也要進 form→canonical map、讓 canonicalize('fed') → 'fed' round-trip
    formToCanonical.set(normalizeForm(canonical), canonical)
    for (const f of aliasForms)
      formToCanonical.set(normalizeForm(f), canonical)
  }
  return { formToCanonical, canonicalToAliases }
}

export function expandEntity(name: string, map: AliasMap): string[] {
  const trimmed = name.trim()
  if (!trimmed)
    return []
  const canonical = map.formToCanonical.get(normalizeForm(trimmed))
  if (canonical === undefined)
    return [trimmed]
  // Defensive：若 group 註冊了 canonical 但 aliases 列空、不要回空陣列拖死
  // retriever 查詢；fallback 回輸入字串、跟 unknown-name 路徑語意一致。
  const aliases = map.canonicalToAliases.get(canonical)
  if (aliases === undefined || aliases.length === 0)
    return [trimmed]
  return aliases
}

export function expandEntities(names: string[], map: AliasMap): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    for (const e of expandEntity(n, map)) {
      if (seen.has(e))
        continue
      seen.add(e)
      out.push(e)
    }
  }
  return out
}

export function canonicalizeEntity(name: string, map: AliasMap): string {
  const trimmed = name.trim()
  if (!trimmed)
    return ''
  const lower = normalizeForm(trimmed)
  return map.formToCanonical.get(lower) ?? lower
}

export function canonicalizeEntities(names: string[], map: AliasMap): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const c = canonicalizeEntity(n, map)
    if (!c || seen.has(c))
      continue
    seen.add(c)
    out.push(c)
  }
  return out
}

// 從 yml 讀 alias 設定。檔案不存在 / 解析錯誤 → 回空 map（安全降級、不要拖垮 retrieval）
export function loadAliasMap(yamlPath?: string): AliasMap {
  const path = yamlPath ?? defaultYamlPath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  }
  catch {
    return buildAliasMap([])
  }
  try {
    const doc = loadYaml(raw) as { groups?: unknown } | null
    if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { groups?: unknown }).groups))
      return buildAliasMap([])
    const groups = ((doc as { groups: unknown[] }).groups).filter((g): g is AliasGroup =>
      typeof g === 'object' && g !== null
      && typeof (g as AliasGroup).canonical === 'string'
      && Array.isArray((g as AliasGroup).aliases)
      && (g as AliasGroup).aliases.every(a => typeof a === 'string'),
    )
    return buildAliasMap(groups)
  }
  catch {
    return buildAliasMap([])
  }
}

function defaultYamlPath(): string {
  // dev:   apps/server/src/agents/entity-aliases.ts → up 2 → apps/server/data/entity-aliases.yml
  // build: apps/server/dist/agents/entity-aliases.js → up 2 → apps/server/data/entity-aliases.yml
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../data/entity-aliases.yml')
}

// 模組層 cache：第一次呼叫 lazy load、後續呼叫直接重用、避免 retrieve 每次都讀檔。
// 測試需要重 load 時用 `loadAliasMap(path)` 直接拿一份新的。
let _defaultMap: AliasMap | null = null
export function getDefaultAliasMap(): AliasMap {
  if (_defaultMap === null)
    _defaultMap = loadAliasMap()
  return _defaultMap
}

// input title+content 過 alias dict 掃 token、
// 命中即收錄該 group 的 canonical。給 routing.ts 的 db-related 模式比對用、
// 不打 LLM 直接抽 entity 的 heuristic 路徑。
export function extractCanonicalEntities(text: string, map: AliasMap): string[] {
  const haystack = text.toLowerCase()
  const found = new Set<string>()
  for (const [canonical, aliases] of map.canonicalToAliases) {
    const forms = [canonical, ...aliases]
    for (const form of forms) {
      const needle = form.trim().toLowerCase()
      if (!needle)
        continue
      if (haystack.includes(needle)) {
        found.add(canonical)
        break
      }
    }
  }
  return [...found]
}

// 從 analyst output 的 industries + tickers 抽 canonical、給 worker saveAnalysis
// 寫進 analyses.entities 欄。Decomposer 的 entity 不直接走這、因為 decomposer 在
// db-related / gap-scrape mode 是被跳過的；用 analyst output 一致性高。
export function extractCanonicalEntitiesFromAnalyst(analyst: AnalystOutput, map: AliasMap): string[] {
  const candidates: string[] = []
  for (const c of analyst.cascadeChains) {
    candidates.push(c.industry)
    candidates.push(...c.affectedTickers)
  }
  return canonicalizeEntities(candidates, map)
}
