import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

// topic 詞彙對照。
//
// 2026-08-21 線上實測的根因：2026-08-04 那次把 corpus enricher 的
// prompt 改成「topicTags 一律英文小寫 kebab-case」，external_articles.topic_tags
// 的 CJK 佔比因此從 7 月各週的 48% 掉到 8/10 當週的 0.1%；decomposer 那邊沒有
// 對應改動，仍照著中文新聞吐中文 topic（實跑三則真新聞：32 個 distinct topic
// 只有 3 個對得上 corpus）。字面比對的 `topic_tags @>` 於是幾乎全空。
//
// 與 entity-aliases 的關鍵差異（不要照抄那邊的語意）：
// - entity 的 canonical 是純內部 slug、expandEntity 回傳的是 aliases **取代**輸入。
// - topic 的 canonical 就是 corpus 實際在用的 tag，而且展開是**加法**——原字串
//   永遠留著。corpus 存在字面大寫的 tag（實測 AI:55 筆），把原字串換成正規化
//   形式會讓現在命中的查詢反而歸零。
export interface TopicAliasGroup {
  canonical: string
  aliases: string[]
}

export interface TopicAliasMap {
  // 任一 form 過 normalizeTopicForm 後 → 該組的所有 form，[0] 固定是 canonical
  formToGroup: Map<string, string[]>
}

// corpus tag 的實際格式是英文小寫 kebab-case，所以正規化＝小寫 + 空白轉 hyphen。
// 中文不受影響（沒有大小寫、也不含空白）。
export function normalizeTopicForm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '-')
}

export function buildTopicAliasMap(groups: TopicAliasGroup[]): TopicAliasMap {
  const formToGroup = new Map<string, string[]>()
  for (const g of groups) {
    const canonical = g.canonical.trim()
    if (!canonical)
      continue
    const forms = [canonical]
    for (const a of g.aliases) {
      const t = a.trim()
      if (t && !forms.includes(t))
        forms.push(t)
    }
    for (const f of forms)
      formToGroup.set(normalizeTopicForm(f), forms)
  }
  return { formToGroup }
}

export function expandTopic(topic: string, map: TopicAliasMap): string[] {
  const trimmed = topic.trim()
  if (!trimmed)
    return []
  const out = [trimmed]
  const normalized = normalizeTopicForm(trimmed)
  if (normalized !== trimmed)
    out.push(normalized)
  for (const f of map.formToGroup.get(normalized) ?? []) {
    if (!out.includes(f))
      out.push(f)
  }
  return out
}

export function expandTopics(topics: string[], map: TopicAliasMap): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of topics) {
    for (const f of expandTopic(t, map)) {
      if (seen.has(f))
        continue
      seen.add(f)
      out.push(f)
    }
  }
  return out
}

// 檔案不存在 / 解析錯誤 → 空 map。展開仍會回「原字串 + 正規化形式」，
// 也就是退回這次改動之前的行為加一點正規化，不會讓檢索整條斷掉。
export function loadTopicAliasMap(yamlPath?: string): TopicAliasMap {
  const path = yamlPath ?? defaultYamlPath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  }
  catch {
    return buildTopicAliasMap([])
  }
  try {
    const doc = loadYaml(raw) as { groups?: unknown } | null
    if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { groups?: unknown }).groups))
      return buildTopicAliasMap([])
    const groups = ((doc as { groups: unknown[] }).groups).filter((g): g is TopicAliasGroup =>
      typeof g === 'object' && g !== null
      && typeof (g as TopicAliasGroup).canonical === 'string'
      && Array.isArray((g as TopicAliasGroup).aliases)
      && (g as TopicAliasGroup).aliases.every(a => typeof a === 'string'),
    )
    return buildTopicAliasMap(groups)
  }
  catch {
    return buildTopicAliasMap([])
  }
}

function defaultYamlPath(): string {
  // dev:   apps/server/src/agents/topic-aliases.ts → up 2 → apps/server/data/topic-aliases.yml
  // build: apps/server/dist/agents/topic-aliases.js → up 2 → apps/server/data/topic-aliases.yml
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../data/topic-aliases.yml')
}

// 空 map 的後果是靜默的：展開退化成「原字串＋小寫化」，檢索行為看起來跟上線前
// 一樣，沒有任何東西會紅。出貨的 yml 不可能是空的，所以載到空就是打包路徑或解析
// 出事了——這裡是唯一叫得出來的地方。抽成獨立函式是為了讓兩條分支都驗得到。
export function warnIfTopicAliasMapEmpty(map: TopicAliasMap): TopicAliasMap {
  if (map.formToGroup.size === 0)
    console.warn('[topic-aliases] 對照表載入為空，topic 展開已退化成只做正規化；檢查 apps/server/data/topic-aliases.yml 是否有進映像')
  return map
}

let _defaultMap: TopicAliasMap | null = null
export function getDefaultTopicAliasMap(): TopicAliasMap {
  if (_defaultMap === null)
    _defaultMap = warnIfTopicAliasMapEmpty(loadTopicAliasMap())
  return _defaultMap
}
