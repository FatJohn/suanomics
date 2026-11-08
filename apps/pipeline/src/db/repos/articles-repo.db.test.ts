import { randomUUID } from 'node:crypto'
import { closeDb, getDb } from '@suanomics/db/client'
import { externalArticles, externalSources } from '@suanomics/db/schema'
import { like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createArticlesRepo, getExternalArticlesByUrls, getSourceActivity } from './articles-repo.js'

// 真 DB 整合測試。articles-repo.test.ts 是 fake-DB 單元測試，兩者刻意分檔：
// 2026-08-21 那次實際運行時遇到的故障（/api/ops/publication-status 連續四天 500、日報停擺）
// 就是 fake-DB 測試全綠但查詢在真 driver 上炸——參數綁定的錯只有真的送到 Postgres 才看得見。

const DAY_MS = 86_400_000
const NOW = new Date('2026-08-21T04:00:00.000Z')

// test- 前綴隔離測試資料；external_articles 有 ON DELETE CASCADE、刪來源即可
async function cleanup() {
  await getDb().delete(externalSources).where(like(externalSources.slug, 'test-src-%'))
}

async function seedSource(slug: string, enabled = true): Promise<string> {
  const [row] = await getDb().insert(externalSources).values({
    slug,
    displayName: slug,
    kind: 'rss',
    tier: 1,
    config: { url: 'https://example.invalid/feed' },
    enabled,
  }).returning({ id: externalSources.id })
  if (!row)
    throw new Error(`seedSource failed: ${slug}`)
  return row.id
}

async function seedArticle(sourceId: string, fetchedAt: Date, contentSummary: string | null = null) {
  const uid = randomUUID()
  await getDb().insert(externalArticles).values({
    sourceId,
    externalId: uid,
    url: `https://example.invalid/${uid}`,
    urlHash: uid,
    title: `test-${uid}`,
    fetchedAt,
    contentSummary,
  })
}

describe('getSourceActivity (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('counts in-window and lifetime articles per enabled source', async () => {
    const active = await seedSource('test-src-active')
    const silent = await seedSource('test-src-silent')
    await seedSource('test-src-never')
    const disabled = await seedSource('test-src-disabled', false)

    await seedArticle(active, new Date(NOW.getTime() - 1 * DAY_MS))
    await seedArticle(active, new Date(NOW.getTime() - 30 * DAY_MS))
    await seedArticle(silent, new Date(NOW.getTime() - 30 * DAY_MS))
    await seedArticle(disabled, new Date(NOW.getTime() - 1 * DAY_MS))

    const windowStart = new Date(NOW.getTime() - 6 * DAY_MS)
    const rows = await getSourceActivity(windowStart)
    const mine = new Map(rows.filter(r => r.slug.startsWith('test-src-')).map(r => [r.slug, r]))

    expect(mine.get('test-src-active')).toMatchObject({ slug: 'test-src-active', articlesInWindow: 1, totalArticles: 2 })
    // silent = 曾經產出、窗內掛零。這一列是告警訊號的來源，數字錯了告警就錯
    expect(mine.get('test-src-silent')).toMatchObject({ slug: 'test-src-silent', articlesInWindow: 0, totalArticles: 1 })
    // never = 從未產出。LEFT JOIN 才留得住這一列，改成 INNER 這條斷言會紅
    expect(mine.get('test-src-never')).toMatchObject({ slug: 'test-src-never', articlesInWindow: 0, totalArticles: 0 })
    // createdAt 餵 summarizeSourceSilence 的寬限期判定：型別錯了寬限期會整個失效，
    // 而失效的方向是「剛加的來源立刻告警」，所以這裡釘住它是可解析的 ISO 字串
    for (const slug of ['test-src-active', 'test-src-silent', 'test-src-never']) {
      const since = mine.get(slug)?.createdAt
      expect(typeof since, slug).toBe('string')
      expect(Number.isNaN(new Date(String(since)).getTime()), slug).toBe(false)
    }
    // 停用來源零產出是預期行為、不該進告警視野
    expect(mine.has('test-src-disabled')).toBe(false)
  })

  // 窗起點在 ops.ts 是用 `T00:00:00+08:00` 構造的，走 gte() 之後以 UTC ISO 字串送出。
  // 兩者是同一個瞬間，但「台北午夜」這條邊界只有拿相差一秒的資料才驗得出來——
  // 前面那兩支用的是 NOW-6 天，離邊界太遠，午夜差一小時也照樣綠。
  it('treats the Taipei-midnight window start as inclusive, to the second', async () => {
    const id = await seedSource('test-src-boundary')
    const windowStart = new Date('2026-08-15T00:00:00+08:00')
    await seedArticle(id, new Date(windowStart.getTime() - 1000))
    await seedArticle(id, windowStart)

    const row = (await getSourceActivity(windowStart)).find(r => r.slug === 'test-src-boundary')
    expect(row).toMatchObject({ slug: 'test-src-boundary', articlesInWindow: 1, totalArticles: 2 })
  })

  // articlesInWindow 問的是「有沒有列」，這條問的是「有沒有可檢索的內容」。
  // 兩者 2026-08-22 第一次分岔（fsc-news 有 15 列、0 篇有摘要）。
  it('counts in-window enriched articles separately from the row count', async () => {
    const mixed = await seedSource('test-src-mixed')
    const unusable = await seedSource('test-src-unusable')

    const inWindow = new Date(NOW.getTime() - 1 * DAY_MS)
    await seedArticle(mixed, inWindow, '一段摘要')
    await seedArticle(mixed, inWindow, null)
    // 空字串也不算 enrich：enrich 失敗與刻意不 enrich 都會留下沒有摘要的列。
    await seedArticle(mixed, inWindow, '')
    // 窗外那篇有摘要，不該讓窗內的判定變綠
    await seedArticle(unusable, new Date(NOW.getTime() - 30 * DAY_MS), '舊摘要')
    await seedArticle(unusable, inWindow, null)

    const rows = await getSourceActivity(new Date(NOW.getTime() - 6 * DAY_MS))
    const mine = new Map(rows.filter(r => r.slug.startsWith('test-src-')).map(r => [r.slug, r]))

    expect(mine.get('test-src-mixed')).toMatchObject({ articlesInWindow: 3, usableInWindow: 1 })
    expect(mine.get('test-src-unusable')).toMatchObject({ articlesInWindow: 1, usableInWindow: 0, totalArticles: 2 })
  })

  it('returns numbers, not the bigint strings Postgres count() sends back', async () => {
    const id = await seedSource('test-src-typed')
    await seedArticle(id, new Date(NOW.getTime() - 1 * DAY_MS))

    const rows = await getSourceActivity(new Date(NOW.getTime() - 6 * DAY_MS))
    const row = rows.find(r => r.slug === 'test-src-typed')
    expect(typeof row?.articlesInWindow).toBe('number')
    expect(typeof row?.totalArticles).toBe('number')
    expect(typeof row?.usableInWindow).toBe('number')
  })
})

// 2026-08-21 規則一的連帶修正。規則一之後「有 content_hash 但沒有摘要」的列會大量
// 增加（代理來源與 Fed 那類 title-only 全部落在這一類），而快取查詢原本只比 content_hash、
// 不看有沒有摘要——命中一列空的就會被當成 cache hit，把後面那篇真的該 enrich 的文章
// 靜默標成 reused。既有的 enrich 失敗列本來就有同樣的洞，只是數量少。
describe('findEnrichmentByContentHash 只認有摘要的列 (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  async function seedWithEnrichment(sourceId: string, hash: string, contentSummary: string | null) {
    const uid = randomUUID()
    await getDb().insert(externalArticles).values({
      sourceId,
      externalId: uid,
      url: `https://example.invalid/${uid}`,
      urlHash: uid,
      title: `test-${uid}`,
      fetchedAt: NOW,
      contentHash: hash,
      contentSummary,
      entities: contentSummary ? [{ kind: 'company', name: 'X', confidence: 0.9 }] : [],
      topicTags: contentSummary ? ['T'] : [],
    })
  }

  it('★ 只有沒摘要的列命中 hash → 回 null（cache miss），不是回一筆空的', async () => {
    const src = await seedSource('test-src-cache-a')
    const hash = `h-${randomUUID()}`
    await seedWithEnrichment(src, hash, null)
    expect(await createArticlesRepo().findEnrichmentByContentHash(hash)).toBeNull()
  })

  it('★ 空字串摘要也算沒摘要——isNotNull 對 \'\' 是 true，只擋 NULL 會留一個洞', async () => {
    // 獨立複查抓到的：enrichEntitySummary 的 schema 是 z.string() 沒有
    // min()，'' 到得了；而 fake 分支用 truthiness 判斷、對 '' 的結論與真 DB 相反。
    const src = await seedSource('test-src-cache-empty')
    const hash = `h-${randomUUID()}`
    await seedWithEnrichment(src, hash, '')
    expect(await createArticlesRepo().findEnrichmentByContentHash(hash)).toBeNull()
  })

  it('★ 同一個 hash 同時有空列與有摘要的列 → 回有摘要的那一筆', async () => {
    const src = await seedSource('test-src-cache-b')
    const hash = `h-${randomUUID()}`
    await seedWithEnrichment(src, hash, null)
    await seedWithEnrichment(src, hash, '真的摘要')
    const r = await createArticlesRepo().findEnrichmentByContentHash(hash)
    expect(r?.contentSummary).toBe('真的摘要')
    expect(r?.topicTags).toEqual(['T'])
  })
})

// pairwise judge 的事實底本要能撈到 corpus（external_articles）側的引用，
// text 優先序 content_summary → raw_excerpt → title 是這支的核心行為。
describe('getExternalArticlesByUrls (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('text 取用順序 content_summary → raw_excerpt → title，且空字串視同沒有內容', async () => {
    const src = await seedSource('test-src-url-priority')
    const urlSummary = `https://example.invalid/${randomUUID()}`
    const urlExcerptOnly = `https://example.invalid/${randomUUID()}`
    const urlEmptySummary = `https://example.invalid/${randomUUID()}`
    const urlTitleOnly = `https://example.invalid/${randomUUID()}`

    await getDb().insert(externalArticles).values([
      { sourceId: src, externalId: randomUUID(), url: urlSummary, urlHash: randomUUID(), title: 'title-summary', contentSummary: '摘要文字', rawExcerpt: '節錄文字' },
      { sourceId: src, externalId: randomUUID(), url: urlExcerptOnly, urlHash: randomUUID(), title: 'title-excerpt', contentSummary: null, rawExcerpt: '節錄文字2' },
      { sourceId: src, externalId: randomUUID(), url: urlEmptySummary, urlHash: randomUUID(), title: 'title-empty-summary', contentSummary: '', rawExcerpt: '節錄文字3' },
      { sourceId: src, externalId: randomUUID(), url: urlTitleOnly, urlHash: randomUUID(), title: 'title-only', contentSummary: null, rawExcerpt: null },
    ])

    const rows = await getExternalArticlesByUrls([urlSummary, urlExcerptOnly, urlEmptySummary, urlTitleOnly])
    const byUrl = new Map(rows.map(r => [r.url, r]))

    expect(byUrl.get(urlSummary)).toMatchObject({ title: 'title-summary', text: '摘要文字' })
    expect(byUrl.get(urlExcerptOnly)).toMatchObject({ title: 'title-excerpt', text: '節錄文字2' })
    expect(byUrl.get(urlEmptySummary)).toMatchObject({ title: 'title-empty-summary', text: '節錄文字3' })
    expect(byUrl.get(urlTitleOnly)).toMatchObject({ title: 'title-only', text: 'title-only' })
  })

  it('查不到的 url 不出現在結果裡（不是回 null 佔位）', async () => {
    const rows = await getExternalArticlesByUrls([`https://example.invalid/${randomUUID()}`])
    expect(rows).toEqual([])
  })
})
