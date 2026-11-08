import { closeDb, getDb } from '@suanomics/db/client'
import { externalArticles, externalSources } from '@suanomics/db/schema'
import { AGGREGATOR_PROXY_SLUGS } from '@suanomics/db/seed-external-sources'
import { taipeiDateOf } from '@suanomics/shared'
import { eq, like } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { retrieveArticles } from './retriever.js'

// 既有測試用 `daysAgo`（相對 now）鋪資料，所以報告日就是今天的台北日——上界落在
// 今天日終、涵蓋 now，行為與加上界之前一致。錨在固定報告日的那組在檔案下方另外寫。
const TODAY = taipeiDateOf(new Date())

const TEST_SOURCE_SLUG = 'test-retriever-src'
let sourceId: string

// helper: insert test article
async function insertArticle(opts: {
  title: string
  entities: Array<{ kind: string, name: string }>
  topicTags: string[]
  daysAgo: number
}) {
  const fetchedAt = new Date(Date.now() - opts.daysAgo * 86_400_000)
  await getDb().insert(externalArticles).values({
    sourceId,
    url: `https://test.example.com/${opts.title}`,
    urlHash: `h-${opts.title}`,
    title: opts.title,
    fetchedAt,
    entities: opts.entities,
    topicTags: opts.topicTags,
    externalId: null,
    publishedAt: null,
    rawExcerpt: null,
    fullText: null,
    contentHash: null,
    contentSummary: null,
    llmModel: null,
    llmCostUsd: null,
  })
}

// helper: insert test article at an absolute fetchedAt（`daysAgo` 那支錨在 now，
// 錨不到某個固定的報告日）
async function insertArticleAt(opts: {
  title: string
  entities: Array<{ kind: string, name: string }>
  topicTags: string[]
  fetchedAt: Date
}) {
  await getDb().insert(externalArticles).values({
    sourceId,
    url: `https://test.example.com/${opts.title}`,
    urlHash: `h-${opts.title}`,
    title: opts.title,
    fetchedAt: opts.fetchedAt,
    entities: opts.entities,
    topicTags: opts.topicTags,
    externalId: null,
    publishedAt: null,
    rawExcerpt: null,
    fullText: null,
    contentHash: null,
    contentSummary: null,
    llmModel: null,
    llmCostUsd: null,
  })
}

beforeAll(async () => {
  // remove any leftover test source (cascade deletes its articles)
  await getDb().delete(externalSources).where(eq(externalSources.slug, TEST_SOURCE_SLUG))
  const [s] = await getDb().insert(externalSources).values({
    slug: TEST_SOURCE_SLUG,
    displayName: 'Test (retriever)',
    kind: 'rss',
    tier: 1,
    config: {},
  }).returning()
  if (!s)
    throw new Error('failed to insert test source')
  sourceId = s.id
})

beforeEach(async () => {
  await getDb().delete(externalArticles).where(eq(externalArticles.sourceId, sourceId))
})

afterAll(async () => {
  await getDb().delete(externalSources).where(eq(externalSources.slug, TEST_SOURCE_SLUG))
  await closeDb()
})

describe('retrieveArticles', () => {
  // ★★ 檢索窗原本只有下界（`new Date(Date.now() - days * 86_400_000)`）、沒有上界，
  //    所以補產舊報告日時會撈到**報告日之後**才抓進來的文章——citation 會引用「當時還不
  //    存在」的來源，而且四處都不影響 job 成敗（報告照常產出、沒有任何訊號說素材窗是錯的）。
  //    上界錨在 `reportDate` 的**台北日界**，與序列快照、官方公告、行事曆同一條紀律
  //    （`market-data/context.ts:245-249`）。台灣沒有日光節約，+08:00 是常數。
  describe('reportDate 上界', () => {
    const REPORT_DATE = '2026-06-12' // 台北 06-12 23:59:59.999 ＝ 06-12T15:59:59.999Z
    const E = '__retriever_test_ASOF__'
    const ent = [{ kind: 'company', name: E }]

    it('★ 報告日之後才抓到的不進窗、窗內的照樣回得來（正反都釘）', async () => {
      // 台北 06-12 23:00——窗內，**這是 positive control**：只斷言「窗外拿不到」的話，
      // 任何回傳空結果的實作都會綠（曾經的驗收踩過這個坑）。
      await insertArticleAt({ title: 'asof-in-window', entities: ent, topicTags: [], fetchedAt: new Date('2026-06-12T15:00:00.000Z') })
      // 台北 06-13 00:00——只差一毫秒級的日界，用 UTC 日界會誤放行
      await insertArticleAt({ title: 'asof-after-window', entities: ent, topicTags: [], fetchedAt: new Date('2026-06-12T16:00:00.000Z') })

      const titles = (await retrieveArticles({ entities: [E], days: 7, reportDate: REPORT_DATE })).map(r => r.title)
      expect(titles).toContain('asof-in-window')
      expect(titles).not.toContain('asof-after-window')
    })

    it('下界仍在、而且是從報告日往回算不是從今天', async () => {
      // 窗 ＝ (報告日台北日終 − 7 天, 報告日台北日終]
      await insertArticleAt({ title: 'asof-6d-before', entities: ent, topicTags: [], fetchedAt: new Date('2026-06-06T12:00:00.000Z') })
      await insertArticleAt({ title: 'asof-8d-before', entities: ent, topicTags: [], fetchedAt: new Date('2026-06-04T12:00:00.000Z') })

      const titles = (await retrieveArticles({ entities: [E], days: 7, reportDate: REPORT_DATE })).map(r => r.title)
      expect(titles).toContain('asof-6d-before')
      expect(titles).not.toContain('asof-8d-before')
    })
  })

  it('should match by entity name (GIN)', async () => {
    await insertArticle({
      title: 'TSMC Q1 strong',
      entities: [{ kind: 'company', name: '__retriever_test_TSMC__' }],
      topicTags: [],
      daysAgo: 1,
    })
    const results = await retrieveArticles({ entities: ['__retriever_test_TSMC__'], days: 7, reportDate: TODAY })
    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe('TSMC Q1 strong')
  })

  it('should match by topic tag (GIN)', async () => {
    await insertArticle({
      title: '半導體 outlook',
      entities: [],
      topicTags: ['__retriever_test_半導體__'],
      daysAgo: 1,
    })
    const results = await retrieveArticles({ topics: ['__retriever_test_半導體__'], days: 7, reportDate: TODAY })
    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe('半導體 outlook')
  })

  it('should OR entities + topics', async () => {
    await insertArticle({
      title: 'entity article',
      entities: [{ kind: 'company', name: '__retriever_test_NVDA__' }],
      topicTags: [],
      daysAgo: 1,
    })
    await insertArticle({
      title: 'topic article',
      entities: [],
      topicTags: ['__retriever_test_AI__'],
      daysAgo: 2,
    })
    await insertArticle({
      title: 'unrelated article',
      entities: [{ kind: 'company', name: 'AAPL' }],
      topicTags: ['手機'],
      daysAgo: 1,
    })
    const results = await retrieveArticles({ entities: ['__retriever_test_NVDA__'], topics: ['__retriever_test_AI__'], days: 7, reportDate: TODAY })
    const titles = results.map(r => r.title).sort()
    expect(titles).toContain('entity article')
    expect(titles).toContain('topic article')
    expect(titles).not.toContain('unrelated article')
  })

  it('should respect days window', async () => {
    await insertArticle({
      title: 'recent article',
      entities: [{ kind: 'company', name: '__retriever_test_TSM__' }],
      topicTags: [],
      daysAgo: 3,
    })
    await insertArticle({
      title: 'old article',
      entities: [{ kind: 'company', name: '__retriever_test_TSM__' }],
      topicTags: [],
      daysAgo: 30,
    })
    const results = await retrieveArticles({ entities: ['__retriever_test_TSM__'], days: 7, reportDate: TODAY })
    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe('recent article')
  })

  it('should return empty when no match', async () => {
    await insertArticle({
      title: 'irrelevant',
      entities: [{ kind: 'company', name: 'GOOGL' }],
      topicTags: ['廣告'],
      daysAgo: 1,
    })
    const results = await retrieveArticles({ entities: ['NONEXISTENT_ENTITY_XYZ'], days: 7, reportDate: TODAY })
    expect(results).toHaveLength(0)
  })

  it('should cap result at 5 by default', async () => {
    for (let i = 0; i < 10; i++) {
      await insertArticle({
        title: `article-${i}`,
        entities: [{ kind: 'company', name: 'LIMIT_TEST' }],
        topicTags: [],
        daysAgo: i,
      })
    }
    const results = await retrieveArticles({ entities: ['LIMIT_TEST'], days: 30, reportDate: TODAY })
    expect(results).toHaveLength(5)
  })

  it('should OR within entities (article tagged with ANY of the requested entities matches)', async () => {
    // alias 展開後一個 hypothesis 會帶多個同義 entity（Fed / 聯準會 / FOMC）、
    // retriever 要 ANY-match 才有意義（AND 語意會打死命中）
    await insertArticle({
      title: '__retriever_test_fed_only__',
      entities: [{ kind: 'event', name: '__retriever_test_FED_ALIAS_A__' }],
      topicTags: [],
      daysAgo: 1,
    })
    await insertArticle({
      title: '__retriever_test_zh_only__',
      entities: [{ kind: 'event', name: '__retriever_test_FED_ALIAS_B__' }],
      topicTags: [],
      daysAgo: 1,
    })
    const results = await retrieveArticles({
      entities: ['__retriever_test_FED_ALIAS_A__', '__retriever_test_FED_ALIAS_B__'],
      days: 7,
      reportDate: TODAY,
    })
    const titles = results.map(r => r.title).sort()
    expect(titles).toContain('__retriever_test_fed_only__')
    expect(titles).toContain('__retriever_test_zh_only__')
  })

  it('should OR within topics (article tagged with ANY of the requested topics matches)', async () => {
    // decomposer 一個 hypothesis 常帶多個 topic，AND 語意要求同一篇文章同時
    // 帶齊全部 tag——只要其中一個 tag 在 corpus 裡不存在，整條查詢就歸零
    // （2026-08-21 prod 實測：geopolitics+policy 近 7 天 AND 20 筆、OR 313 筆；
    //  geopolitics+半導體 AND 0 筆、OR 253 筆）。
    await insertArticle({
      title: '__retriever_test_topic_a_only__',
      entities: [],
      topicTags: ['__retriever_test_TOPIC_A__'],
      daysAgo: 1,
    })
    await insertArticle({
      title: '__retriever_test_topic_b_only__',
      entities: [],
      topicTags: ['__retriever_test_TOPIC_B__'],
      daysAgo: 1,
    })
    const results = await retrieveArticles({
      topics: ['__retriever_test_TOPIC_A__', '__retriever_test_TOPIC_B__'],
      days: 7,
      reportDate: TODAY,
    })
    const titles = results.map(r => r.title).sort()
    expect(titles).toContain('__retriever_test_topic_a_only__')
    expect(titles).toContain('__retriever_test_topic_b_only__')
  })

  it('should not crash with neither entities nor topics (return [])', async () => {
    await insertArticle({
      title: 'some article',
      entities: [{ kind: 'company', name: 'ANY' }],
      topicTags: ['任何'],
      daysAgo: 1,
    })
    const results = await retrieveArticles({ days: 7, reportDate: TODAY })
    expect(results).toHaveLength(0)
  })
})

// 2026-08-21 Google News 代理來源整批排除在檢索與 citation 之外
// （analyst-tier1 的 allowedUrls 來自這裡的回傳）。這是處理既有假摘要的可逆手段——
// 不刪資料，只是不再讓它們進 prompt。
describe('代理來源排除', () => {
  const PROXY_SLUG = AGGREGATOR_PROXY_SLUGS[0] ?? 'reuters-biz'
  const ENTITY = '__retriever_proxy_test_entity__'
  // ★ 刻意用**非** news.google.com 的網址：這一組要驗的是規則二（來源層級），
  // 用 google 網址的話規則三（網址層級）會先擋住，這三條斷言就變成在驗規則三——
  // 反向對照過：第一版用 google 網址時，把規則二整條拿掉測試仍然全綠。
  const URL_PREFIX = 'https://example.invalid/__retriever_proxy_test__'
  let proxySourceId: string
  // 這個 slug 在本機 dev DB 通常已經 seed 過、而且底下掛著上千篇真語料。
  // ★ 絕對不能 delete 那一列——external_articles 是 ON DELETE CASCADE，刪來源會把該來源
  //   的文章全部帶走，而重新 insert 回去的是新 UUID、文章救不回來。
  //   （第一版就是這樣寫的，獨立複查實測跑一次 pnpm -r test 之後
  //     reuters-biz 從 100 列變 0 列。）
  //   所以：存在就沿用、只清自己插的那幾列；不存在（CI 的乾淨 DB）才自己建、跑完刪掉。
  let createdByThisSuite = false

  beforeAll(async () => {
    const [existing] = await getDb().select({ id: externalSources.id }).from(externalSources).where(eq(externalSources.slug, PROXY_SLUG))
    if (existing) {
      proxySourceId = existing.id
      return
    }
    const [created] = await getDb().insert(externalSources).values({
      slug: PROXY_SLUG,
      displayName: 'Proxy (test)',
      kind: 'rss',
      tier: 1,
      config: { feedUrl: 'https://news.google.com/rss/search?q=x' },
    }).returning()
    if (!created)
      throw new Error('failed to insert proxy test source')
    proxySourceId = created.id
    createdByThisSuite = true
  })

  beforeEach(async () => {
    await getDb().delete(externalArticles).where(like(externalArticles.url, `${URL_PREFIX}%`))
  })

  afterAll(async () => {
    await getDb().delete(externalArticles).where(like(externalArticles.url, `${URL_PREFIX}%`))
    if (createdByThisSuite)
      await getDb().delete(externalSources).where(eq(externalSources.slug, PROXY_SLUG))
  })

  async function insertProxyArticle(title: string): Promise<void> {
    await getDb().insert(externalArticles).values({
      sourceId: proxySourceId,
      url: `${URL_PREFIX}/${title}`,
      urlHash: `ph-${title}`,
      title,
      fetchedAt: new Date(),
      entities: [{ kind: 'company', name: ENTITY }],
      topicTags: [ENTITY],
      externalId: null,
      publishedAt: null,
      rawExcerpt: null,
      fullText: null,
      contentHash: null,
      contentSummary: '這段摘要是模型看標題編出來的',
      llmModel: null,
      llmCostUsd: null,
    })
  }

  it('★ 代理來源的文章不會被檢索到，即使 entity 完全命中', async () => {
    await insertProxyArticle('proxy-only')
    expect(await retrieveArticles({ entities: [ENTITY], days: 7, reportDate: TODAY })).toHaveLength(0)
  })

  it('★ topic 命中也一樣擋住（兩條檢索路徑都要擋，不能只擋一條）', async () => {
    await insertProxyArticle('proxy-topic')
    expect(await retrieveArticles({ topics: [ENTITY], days: 7, reportDate: TODAY })).toHaveLength(0)
  })

  it('★ 同一個 entity 下的非代理來源照常回傳——排除的是來源不是關鍵字', async () => {
    await insertProxyArticle('proxy-mixed')
    await insertArticle({ title: 'direct-source-hit', entities: [{ kind: 'company', name: ENTITY }], topicTags: [], daysAgo: 1 })
    const r = await retrieveArticles({ entities: [ENTITY], days: 7, reportDate: TODAY })
    expect(r.map(x => x.title)).toEqual(['direct-source-hit'])
  })
})

// 把 bloomberg-markets / whitehouse-statements 從 Google News 代理改成直連之後，
// 它們就不在 AGGREGATOR_PROXY_SLUGS 裡了——但**舊文章**的 url 仍是 google 轉址。
// 2026-08-21 prod 實測：全庫 9,793 篇 google 轉址 url，其中 2,946 篇屬這兩個已改直連的
// 來源（bloomberg 2,439／whitehouse 507），只靠來源層級的規則會整批漏掉。
//
// 這一條判的是「這個 url 讀者點不點得到」，是 url 自己的性質，不是拿 host 做**來源歸屬**
// （9 個代理共用同一個 host、按 host 分類會把半個語料庫歸零），兩件事不同。
describe('google 轉址網址排除（不分來源）', () => {
  const ENTITY = '__retriever_gnews_url_test__'

  it('★ 非代理來源、但 url 是 google 轉址 → 一樣不可引用', async () => {
    await getDb().insert(externalArticles).values({
      sourceId,
      url: 'https://news.google.com/rss/articles/CBMiOLD_ARTICLE',
      urlHash: 'gh-legacy-1',
      title: 'legacy-proxy-url',
      fetchedAt: new Date(),
      entities: [{ kind: 'company', name: ENTITY }],
      topicTags: [ENTITY],
      externalId: null,
      publishedAt: null,
      rawExcerpt: null,
      fullText: null,
      contentHash: null,
      contentSummary: '舊資料留下的、看標題編出來的摘要',
      llmModel: null,
      llmCostUsd: null,
    })
    expect(await retrieveArticles({ entities: [ENTITY], days: 7, reportDate: TODAY })).toHaveLength(0)
    expect(await retrieveArticles({ topics: [ENTITY], days: 7, reportDate: TODAY })).toHaveLength(0)
  })

  it('同來源的正常 url 照常回傳——擋的是轉址不是這個來源', async () => {
    await insertArticle({ title: 'normal-url-hit', entities: [{ kind: 'company', name: ENTITY }], topicTags: [], daysAgo: 1 })
    const r = await retrieveArticles({ entities: [ENTITY], days: 7, reportDate: TODAY })
    expect(r.map(x => x.title)).toEqual(['normal-url-hit'])
  })
})
