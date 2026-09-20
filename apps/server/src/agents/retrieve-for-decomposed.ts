import type { AliasMap } from './entity-aliases.js'
import type { TopicAliasMap } from './topic-aliases.js'
import type { DecomposerOutput, RetrievedArticle } from './types.js'
import { expandEntities, getDefaultAliasMap } from './entity-aliases.js'
import { retrieveArticles } from './retriever.js'
import { expandTopics, getDefaultTopicAliasMap } from './topic-aliases.js'

//
// retriever 之前先把每個 hypothesis 的 entity 過 alias map、
// 展開成同義 form 集合（Fed → [Fed, FOMC, 聯準會, ...]）、餵進 retriever 的
// OR-within-entities 查詢。aliases 參數用於 unit test 注入；正常路徑用模組
// 預載的 default map（apps/server/data/entity-aliases.yml）。
//
// topics 也過一層展開，理由與 entity 那層同構——decomposer 吐中文
// topic，而 corpus 的 topic_tags 自 2026-08-04（改掉 enricher prompt 的那次）
// 起一律英文小寫 kebab-case，字面比對必然落空。展開是加法（原字串永遠留著），
// 所以不可能弄丟現在命中的查詢。topicAliases 參數同樣只給 unit test 注入。
// `reportDate` 必填：檢索窗的上界錨在報告日，補產舊報告時才不會撈到那天之後
// 才抓進來的文章。放在第二個位置而不是塞進選填尾巴，是為了讓 tsc 逐個抓出呼叫端。
export async function retrieveForDecomposed(
  decomposed: DecomposerOutput,
  reportDate: string,
  aliases?: AliasMap,
  topicAliases?: TopicAliasMap,
): Promise<RetrievedArticle[]> {
  if (decomposed.cascadeHypotheses.length === 0)
    return []
  const aliasMap = aliases ?? getDefaultAliasMap()
  const topicMap = topicAliases ?? getDefaultTopicAliasMap()
  const all = await Promise.all(
    decomposed.cascadeHypotheses.map((h) => {
      const expandedEntities = h.retrieveQuery.entities !== undefined
        ? expandEntities(h.retrieveQuery.entities, aliasMap)
        : undefined
      const expandedTopics = h.retrieveQuery.topics !== undefined
        ? expandTopics(h.retrieveQuery.topics, topicMap)
        : undefined
      return retrieveArticles({
        days: h.retrieveQuery.days ?? 7,
        reportDate,
        ...(expandedEntities !== undefined ? { entities: expandedEntities } : {}),
        ...(expandedTopics !== undefined ? { topics: expandedTopics } : {}),
      }).catch(() => [] as RetrievedArticle[])
    }),
  )
  const seen = new Set<string>()
  return all.flat().filter((a) => {
    if (seen.has(a.url))
      return false
    seen.add(a.url)
    return true
  })
}
