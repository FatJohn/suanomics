import type { ParsedEntry } from './news-repo.js'
import { closeDb, getDb } from '@suanomics/db/client'
import { dailyBriefs, newsItems, newsSources } from '@suanomics/db/schema'
import { eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildUpsertRows, countNewsFetchedBetween, getDailyBriefsForDates, getRecentBriefSummaries, getStratifiedCandidates, listDailyBriefDates, saveDailyBrief, selectNewsForBrief } from './news-repo.js'

describe('buildUpsertRows', () => {
  it('shouldAttachSourceIdAndDefaultContentSourceToEveryEntry', () => {
    const entries: ParsedEntry[] = [
      { externalId: 'a', title: 't', url: 'u', publishedAt: null, excerpt: 'e' },
    ]
    const rows = buildUpsertRows(entries, 42)
    expect(rows[0]).toMatchObject({
      sourceId: 42,
      externalId: 'a',
      title: 't',
      url: 'u',
      contentText: 'e',
      contentSource: 'rss-excerpt',
    })
  })
})

// 用 2099 未來日期隔離測試資料：desc 排序必在最前、不會被真實近日 brief 擠出 top-n window
const TEST_DATES = ['2099-01-01', '2099-01-02', '2099-01-03']

async function cleanup() {
  await getDb().delete(dailyBriefs).where(inArray(dailyBriefs.briefDate, TEST_DATES))
}

beforeAll(cleanup)
beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await closeDb()
})

describe('getRecentBriefSummaries', () => {
  it('returns date desc, headline from briefJson, fallback to summary first line', async () => {
    await saveDailyBrief('2099-01-01', [], 'older summary line\nmore body', { headline: '1/1 標題' })
    await saveDailyBrief('2099-01-02', [], 'newer summary first line\nsecond body line')

    // 2099 日期 desc 必在最前、取 top-3 即穩定涵蓋兩筆測試資料
    const rows = await getRecentBriefSummaries(3)
    const mine = rows.filter(r => TEST_DATES.includes(r.briefDate))

    expect(mine.map(r => r.briefDate)).toEqual(['2099-01-02', '2099-01-01'])
    // 帶 briefJson.headline → 取 briefJson
    expect(mine.find(r => r.briefDate === '2099-01-01')?.headline).toBe('1/1 標題')
    // 無 briefJson → fallback summary 首行
    expect(mine.find(r => r.briefDate === '2099-01-02')?.headline).toBe('newer summary first line')
  })

  // ★ before 是**不含**的上界。補跑歷史報告時，editor 的「近三日 brief」不可以拿到報告日
  //   之後的報告——那會讓 09-02 的報告 prompt 裡逐字印著「2026-09-04：…」。
  //   不含當日還順手治好另一件事：重生同一天的報告時，它不該把自己上一版當「近三日」讀。
  it('before 是不含的上界：拿不到報告日當天與之後的報告', async () => {
    await saveDailyBrief('2099-01-01', [], 'day 1')
    await saveDailyBrief('2099-01-02', [], 'day 2')
    await saveDailyBrief('2099-01-03', [], 'day 3')

    const bounded = await getRecentBriefSummaries(3, '2099-01-03')
    expect(bounded.filter(r => TEST_DATES.includes(r.briefDate)).map(r => r.briefDate))
      .toEqual(['2099-01-02', '2099-01-01'])

    // ★ 負向對照：不帶 before 時無上界（不然「永遠砍掉最新一筆」也會讓上面那條綠）
    const unbounded = await getRecentBriefSummaries(3)
    expect(unbounded.filter(r => TEST_DATES.includes(r.briefDate)).map(r => r.briefDate))
      .toEqual(['2099-01-03', '2099-01-02', '2099-01-01'])
  })
})

describe('listDailyBriefDates', () => {
  it('returns briefDates in descending order', async () => {
    await saveDailyBrief('2099-01-01', [], 'older summary')
    await saveDailyBrief('2099-01-02', [], 'newer summary')

    // 2099 日期 desc 必在最前、過濾出測試資料驗排序
    const dates = await listDailyBriefDates()
    const mine = dates.filter(d => TEST_DATES.includes(d))

    expect(mine).toEqual(['2099-01-02', '2099-01-01'])
  })
})

const STRAT_PREFIX = 'r9-strat-'

// 用既有 SEED slug（categoryForSlug 認得）；存在則讀 id、不存在則插入（不 mutate 既有來源）
async function sourceIdForSlug(slug: string): Promise<number> {
  const db = getDb()
  await db.insert(newsSources)
    .values({ slug, displayName: slug, rssUrl: `https://example.com/${slug}.xml`, isActive: true })
    .onConflictDoNothing()
  const [row] = await db.select({ id: newsSources.id }).from(newsSources).where(eq(newsSources.slug, slug)).limit(1)
  if (!row)
    throw new Error(`sourceIdForSlug: ${slug} not found`)
  return row.id
}

// fetchedAt 省略＝用 DB 預設的 now()。要驗「候選窗吃不吃 briefDate」時才需要明確指定，
// 因為那個窗判定的是 fetchedAt、不是 publishedAt。
async function insertStratItems(sourceId: number, prefix: string, n: number, fetchedAt?: Date): Promise<void> {
  const db = getDb()
  const rows = Array.from({ length: n }, (_, i) => ({
    sourceId,
    externalId: `${prefix}-${i}`,
    title: `${prefix}-${i}`,
    url: `https://example.com/${prefix}-${i}`,
    // 2099 publishedAt → desc 排序必在最前、各類前 N 名穩定是測試資料
    publishedAt: new Date(`2099-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    contentText: `body ${prefix} ${i} long enough text`,
    contentSource: 'rss-excerpt' as const,
    ...(fetchedAt ? { fetchedAt } : {}),
  }))
  await db.insert(newsItems).values(rows).onConflictDoNothing()
}

// 下面幾條驗的是分層邏輯、不是候選窗，測試資料的 fetchedAt 走 DB 預設 now()，所以要傳今天。
// ★ 已知的窄失敗窗：todayIso() 取的是 **Node 程序**的時鐘，fetchedAt 取的是 **Postgres**
//   的 now()，兩者不同源。只要 DB 時鐘領先 Node 且兩者跨過同一個 UTC 換日點，fetchedAt 就
//   會大於上界 `${todayIso()}T23:59:59.999Z`、這幾條會偶發紅。CI 同主機 → 窗小於一秒；本機
//   Docker VM 休眠後時鐘漂移則窗等於漂移量。遇到 UTC 00:00 附近的偶發紅燈先查時鐘，別當真缺陷。
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

async function cleanupStrat(): Promise<void> {
  await getDb().delete(newsItems).where(like(newsItems.title, `${STRAT_PREFIX}%`))
}

describe('getStratifiedCandidates', () => {
  beforeEach(cleanupStrat)
  afterAll(cleanupStrat)

  it('每類取最近 N 則、高產量類別不灌爆另一類', async () => {
    const tweId = await sourceIdForSlug('cna') // tw-equity
    const macroId = await sourceIdForSlug('eia') // macro
    await insertStratItems(tweId, `${STRAT_PREFIX}twe`, 6) // 高產量、6 > cap 4
    await insertStratItems(macroId, `${STRAT_PREFIX}macro`, 2) // 稀疏

    const result = await getStratifiedCandidates(todayIso(), 2, 4)
    const ours = result.filter(c => c.title.startsWith(STRAT_PREFIX))

    expect(ours.filter(c => c.category === 'tw-equity-other').length).toBe(4) // 6 → capped 4（null category 退來源層→tw-equity-other）
    expect(ours.filter(c => c.category === 'macro').length).toBe(2) // 不足 4 取全部、沒被灌爆
    expect(ours[0]?.category).toMatch(/tw-equity-other|macro/)
    expect(ours[0]?.contentText).toContain('body')
  })
})

// 這條 fallback 路徑原本收下 date 卻整個丟掉（參數名是 `_date`），內部走的窗是相對
// Date.now() 算的。排程情境下 now() 與 briefDate 只差幾小時、兩個窗幾乎重疊，所以看不出來；
// 只有補產（手動觸發、帶明確 date 參數）才會現形——那時 fallback 會拿今天的新聞貼上舊日期，
// 而且**不影響 job 成敗**：只要 news.length > 0 就照常成稿，外部看到的是一份成功產出的報告。
describe('selectNewsForBrief 的候選窗吃 briefDate', () => {
  beforeEach(cleanupStrat)
  afterAll(cleanupStrat)

  const BRIEF_DATE = '2026-06-13'

  it('briefDate 之後才抓到的新聞不會被選進來', async () => {
    const tweId = await sourceIdForSlug('cna')
    await insertStratItems(tweId, `${STRAT_PREFIX}win-in`, 2, new Date('2026-06-12T00:00:00Z'))
    // 補產情境：這批是「執行補產的今天」才抓到的，對 BRIEF_DATE 那天而言是未來的新聞
    await insertStratItems(tweId, `${STRAT_PREFIX}win-late`, 2, new Date())

    const titles = (await selectNewsForBrief(BRIEF_DATE)).map(n => n.title)
    expect(titles.some(t => t.includes('win-in')), '窗內的應該被選到').toBe(true)
    expect(titles.some(t => t.includes('win-late')), 'briefDate 之後抓到的不該被選到').toBe(false)
  })

  it('briefDate 往前超過窗的新聞也不會被選進來', async () => {
    const tweId = await sourceIdForSlug('cna')
    await insertStratItems(tweId, `${STRAT_PREFIX}win-old`, 2, new Date('2026-06-01T00:00:00Z'))
    // ★ positive control 不能省：沒有這批的話，**任何回傳空陣列的實作**都能讓下面那條否定
    //   斷言通過——包括修這個 bug 之前的舊實作（它的窗是 now-7d，2026-06-01 一樣被濾掉）。
    //   這條測試原本就是這樣寫的，驗收時被指出對「下界有沒有吃 briefDate」零鑑別力。
    await insertStratItems(tweId, `${STRAT_PREFIX}win-near`, 2, new Date('2026-06-10T00:00:00Z'))

    const titles = (await selectNewsForBrief(BRIEF_DATE)).map(n => n.title)
    expect(titles.some(t => t.includes('win-near')), 'positive control：窗內的應該被選到').toBe(true)
    expect(titles.some(t => t.includes('win-old')), '超出下界的不該被選到').toBe(false)
  })

  it('briefDate 格式不合法就丟錯，不要靜默退回某個預設窗', async () => {
    await expect(selectNewsForBrief('2026/06/13')).rejects.toThrow(/invalid/i)
  })

  // 這兩種壞法的症狀不同：13 月是 Invalid Date（NaN 會炸），2 月 30 日卻被 Date 靜默
  // roll 成 3 月 2 日——不炸，只是窗差兩天。後者才是這條測試真正要擋的。
  it('不存在的日期也要擋，不能讓 Date 靜默 roll 過去', async () => {
    await expect(selectNewsForBrief('2026-02-30')).rejects.toThrow(/invalid/i)
    await expect(selectNewsForBrief('2026-13-01')).rejects.toThrow(/invalid/i)
  })
})

describe('selectNewsForBrief（fallback 分層）', () => {
  beforeEach(cleanupStrat)
  afterAll(cleanupStrat)

  it('高產量類別在 fallback 路徑被 cap 在 3、不灌爆', async () => {
    const tweId = await sourceIdForSlug('cna')
    const macroId = await sourceIdForSlug('eia')
    await insertStratItems(tweId, `${STRAT_PREFIX}fb-twe`, 7) // 高產量類別、7 > 4
    await insertStratItems(macroId, `${STRAT_PREFIX}fb-macro`, 2) // 稀疏類別

    const news = await selectNewsForBrief(todayIso())
    const ours = news.filter(n => n.title.startsWith(STRAT_PREFIX))

    // 純 recency(7,8) 會回 7 twe + 1 macro（twe=7 > 3）；分層(7,3) cap 在 3
    expect(ours.filter(n => n.title.includes('fb-twe')).length).toBe(3) // 7 → capped 3
    expect(ours.filter(n => n.title.includes('fb-macro')).length).toBe(2) // 不足 3 取全部
    expect(ours[0]?.text).toContain('body') // BriefNewsItem 形狀
  })
})

// publication status：用 2099 未來日期隔離（同上方 TEST_DATES 慣例）、與既有 2099-01-* 測試資料不重疊
const PUB_TEST_DATES = ['2099-02-01', '2099-02-02', '2099-02-03']

async function cleanupPub(): Promise<void> {
  await getDb().delete(dailyBriefs).where(inArray(dailyBriefs.briefDate, PUB_TEST_DATES))
}

describe('getDailyBriefsForDates', () => {
  beforeEach(cleanupPub)
  afterAll(cleanupPub)

  it('回傳指定日期的 publication 欄位、缺日不補列', async () => {
    await saveDailyBrief('2099-02-01', [], 'summary 1')
    await saveDailyBrief('2099-02-02', [], 'summary 2')
    // 2099-02-03 故意不 seed → 驗證缺日不補列

    const rows = await getDailyBriefsForDates(['2099-02-01', '2099-02-02', '2099-02-03'])

    expect(rows.map(r => r.briefDate).sort()).toEqual(['2099-02-01', '2099-02-02'])
    expect(rows[0]).toHaveProperty('createdAt')
    expect(rows[0]).toHaveProperty('podcastAudioPath')
  })

  it('空陣列直接回空、不打 DB', async () => {
    expect(await getDailyBriefsForDates([])).toEqual([])
  })
})

// freshness signal：window 測試用遠未來 fetchedAt（2099）隔離、不受真實資料影響
const NEWS_WINDOW_PREFIX = 'q1-window-'

async function cleanupNewsWindow(): Promise<void> {
  await getDb().delete(newsItems).where(like(newsItems.title, `${NEWS_WINDOW_PREFIX}%`))
}

describe('countNewsFetchedBetween', () => {
  beforeEach(cleanupNewsWindow)
  afterAll(cleanupNewsWindow)

  it('只計窗內 fetchedAt', async () => {
    const sourceId = await sourceIdForSlug('cna')
    await getDb().insert(newsItems).values([
      { sourceId, externalId: `${NEWS_WINDOW_PREFIX}before`, title: `${NEWS_WINDOW_PREFIX}before`, url: 'https://example.com/before', contentSource: 'rss-excerpt', fetchedAt: new Date('2099-01-16T22:00:00Z') }, // 窗前
      { sourceId, externalId: `${NEWS_WINDOW_PREFIX}inside`, title: `${NEWS_WINDOW_PREFIX}inside`, url: 'https://example.com/inside', contentSource: 'rss-excerpt', fetchedAt: new Date('2099-01-17T12:00:00Z') }, // 窗內
      { sourceId, externalId: `${NEWS_WINDOW_PREFIX}after`, title: `${NEWS_WINDOW_PREFIX}after`, url: 'https://example.com/after', contentSource: 'rss-excerpt', fetchedAt: new Date('2099-01-17T23:30:00Z') }, // 窗後
    ]).onConflictDoNothing()

    const n = await countNewsFetchedBetween(new Date('2099-01-16T23:00:00Z'), new Date('2099-01-17T23:00:00Z'))
    expect(n).toBe(1)
  })
})
