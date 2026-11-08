import type { DecomposerOutput } from './types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAliasMap } from './entity-aliases.js'
import { retrieveForDecomposed } from './retrieve-for-decomposed.js'
import * as retrieverMod from './retriever.js'
import { buildTopicAliasMap } from './topic-aliases.js'

vi.mock('./retriever.js')

const EMPTY_ALIASES = buildAliasMap([])
// 報告日：這一層只負責把它原樣傳下去，窗的算法由 retriever 自己顧
const REPORT_DATE = '2026-06-12'

function decomposed(topics: string[]): DecomposerOutput {
  return {
    primaryEntity: { name: 'X', kind: 'company' },
    topicTags: [],
    cascadeHypotheses: [{
      industry: 'semiconductor',
      mechanism: 'm',
      retrieveQuery: { topics, days: 7 },
    }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(retrieverMod.retrieveArticles).mockResolvedValue([])
})

// decomposer 吐中文 topic、corpus 從 2026-08-04 起
// 一律英文 kebab-case，字面比對必然落空。展開在這一層做，與 entity 的
// expandEntities 同一個位置。
describe('retrieveForDecomposed 的 topic 展開', () => {
  // ★ 這一層的唯一責任是把 reportDate 原樣交給 retriever。少了這條，
  //   把 `reportDate` 從呼叫裡拿掉只會讓 retriever 收到 undefined，而上面那些
  //   斷言只看 entities／topics，一條都不會紅。
  it('★ 報告日原樣傳給 retriever', async () => {
    await retrieveForDecomposed(decomposed(['半導體']), REPORT_DATE, EMPTY_ALIASES, buildTopicAliasMap([]))
    expect(vi.mocked(retrieverMod.retrieveArticles).mock.calls[0]?.[0]?.reportDate).toBe(REPORT_DATE)
  })

  it('中文 topic 會帶上對應的英文 corpus tag 一起查', async () => {
    const topicAliases = buildTopicAliasMap([{ canonical: 'semiconductor', aliases: ['半導體'] }])
    await retrieveForDecomposed(decomposed(['半導體']), REPORT_DATE, EMPTY_ALIASES, topicAliases)
    const arg = vi.mocked(retrieverMod.retrieveArticles).mock.calls[0]?.[0]
    expect(arg?.topics).toContain('semiconductor')
  })

  // map 只放小寫的 'ai'，原字串 'AI' 不在 group 裡——這樣「命中即取代」才會被抓到。
  it('原字串一定留著（corpus 有大小寫不規則的 tag）', async () => {
    const topicAliases = buildTopicAliasMap([{ canonical: 'artificial-intelligence', aliases: ['ai'] }])
    await retrieveForDecomposed(decomposed(['AI']), REPORT_DATE, EMPTY_ALIASES, topicAliases)
    const arg = vi.mocked(retrieverMod.retrieveArticles).mock.calls[0]?.[0]
    expect(arg?.topics).toContain('AI')
  })

  it('未收錄的 topic 也會補上正規化形式（Supply Chain → supply-chain）', async () => {
    await retrieveForDecomposed(decomposed(['Supply Chain']), REPORT_DATE, EMPTY_ALIASES, buildTopicAliasMap([]))
    const arg = vi.mocked(retrieverMod.retrieveArticles).mock.calls[0]?.[0]
    expect(arg?.topics).toEqual(['Supply Chain', 'supply-chain'])
  })

  it('沒有 topics 的 hypothesis 不會被塞進 topics 欄', async () => {
    const d = decomposed([])
    d.cascadeHypotheses = [{ industry: 'semiconductor', mechanism: 'm', retrieveQuery: { entities: ['TSMC'], days: 7 } }]
    await retrieveForDecomposed(d, REPORT_DATE, EMPTY_ALIASES, buildTopicAliasMap([]))
    const arg = vi.mocked(retrieverMod.retrieveArticles).mock.calls[0]?.[0]
    expect(arg && 'topics' in arg).toBe(false)
  })
})
