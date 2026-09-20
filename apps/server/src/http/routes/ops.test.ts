import { afterEach, describe, expect, it, vi } from 'vitest'

const briefRows: Record<string, unknown[]> = {}
// newsItems24h 是「近 24 小時沒有新聞」檢查唯一的輸入，窗語意與「零值也要有欄位」兩件事都要守，
// 所以這個 mock 收下呼叫參數、也讓個別測試指定回傳值。
let newsCount = 42
let capturedNewsWindow: { from: Date, to: Date } | null = null
vi.mock('@suanomics/db/repos/news-repo', () => ({
  getDailyBriefsForDates: vi.fn(async (dates: string[]) =>
    dates.flatMap(d => (briefRows[d] ?? []))),
  countNewsFetchedBetween: vi.fn(async (from: Date, to: Date) => {
    capturedNewsWindow = { from, to }
    return newsCount
  }),
}))

// 日報來源的健康訊號。窗起點與 corpus 那組共用同一個值，這裡收下來斷言。
let capturedNewsActivityWindow: Date | null = null
let newsSourceActivity: Array<{ slug: string, articlesInWindow: number, totalArticles: number, usableInWindow: number, createdAt?: string }> = []

vi.mock('@suanomics/db/repos/news-source-activity', () => ({
  getNewsSourceActivity: vi.fn(async (windowStart: Date) => {
    capturedNewsActivityWindow = windowStart
    return newsSourceActivity
  }),
}))

// 敘事線子系統的健康訊號。route 一次撈全表、逐日分帳，這裡收下它問了哪些日期。
let capturedStorylineDates: readonly string[] | null = null
let storylineActivity = { open: 9, total: 20, byDate: {} as Record<string, { touched: number, usable: number }> }
vi.mock('@suanomics/db/repos/storyline-activity', () => ({
  getStorylineActivity: vi.fn(async (dates: readonly string[]) => {
    capturedStorylineDates = dates
    return {
      open: storylineActivity.open,
      total: storylineActivity.total,
      byDate: Object.fromEntries(dates.map(d => [d, storylineActivity.byDate[d] ?? { touched: 0, usable: 0 }])),
    }
  }),
}))

// 來源零產出。窗起點由 route 算、這裡收下來斷言，避免 off-by-one 只能靠讀 code 確認。
let capturedWindowStart: Date | null = null
let sourceActivity: Array<{ slug: string, articlesInWindow: number, totalArticles: number, usableInWindow?: number }> = []
vi.mock('@suanomics/db/repos/articles-repo', () => ({
  getSourceActivity: vi.fn(async (windowStart: Date) => {
    capturedWindowStart = windowStart
    return sourceActivity
  }),
}))

// vi.mock 必須先於 import 求值，所以這兩個 import 刻意留在下面（import/first 因此關掉）。
/* eslint-disable import/first */
import { ACCEPTED_ZERO_USABLE_NEWS_SLUGS } from '@suanomics/db/seed'
import { opsRoute } from './ops.js'
/* eslint-enable import/first */

const FRESHNESS_FIXTURE = [
  { seriesId: 'taiex-close', expectedAsOf: '2026-07-16', actualAsOf: '2026-07-16', lagCycles: 0, state: 'fresh' },
  { seriesId: 'us-sox', expectedAsOf: '2026-07-16', actualAsOf: '2026-07-15', lagCycles: 1, state: 'lagging' },
]

// 健康的 fixture 一定要**有內容**。舊版是 `{ some: 'prose' }`／`{ support: [] }`／
// `{ acts: [] }`——`!= null` 判定下它們全是「健康」，正是這裡要拆掉的形狀。
const NARRATIVE_OK = { intro: '導言'.repeat(30), outro: '結語'.repeat(30), sections: [{ heading: '主題', body: '正文'.repeat(80) }] }
const VIEWPOINTS_OK = { supportPoints: ['支持一', '支持二'], riskPoints: ['風險一', '風險二'], netRead: '淨讀'.repeat(40) }
const PODCAST_OK = { hook: { headline: 'h', body: '鉤子'.repeat(50) }, acts: [{ actTitle: 'a1', body: '段落'.repeat(80) }] }
const CLAIM_LEDGER_OK = [
  { id: 'c1', claim: '台股加權指數收在 24,000 點', evidenceRefs: [{ kind: 'series', seriesId: 'taiex-close', asOf: '2026-07-17' }] },
  { id: 'c2', claim: '外資期貨淨部位轉為淨多', evidenceRefs: [] },
]

// ★ 每次都 structuredClone：底下有測試會就地改 `row.briefJson.narrative.sections`，
// 直接塞常數進去的話那次改動會污染同一個常數，**紅的是後面那支**。
function seedBrief(date: string, opts: { createdAt: string, narrative?: boolean, podcast?: boolean, audio?: boolean, thesis?: boolean, viewpoints?: boolean, freshness?: unknown, claimLedger?: unknown }) {
  briefRows[date] = [{
    briefDate: date,
    createdAt: new Date(opts.createdAt),
    briefJson: {
      narrative: opts.narrative === false ? null : structuredClone(NARRATIVE_OK),
      dailyThesis: opts.thesis === false ? null : '本日核心論點：資金輪動',
      viewpoints: opts.viewpoints === false ? null : structuredClone(VIEWPOINTS_OK),
      ...(opts.claimLedger === undefined ? { claimLedger: structuredClone(CLAIM_LEDGER_OK) } : { claimLedger: opts.claimLedger }),
      ...(opts.freshness === undefined ? { dataFreshness: FRESHNESS_FIXTURE } : { dataFreshness: opts.freshness }),
    },
    podcastJson: opts.podcast === false ? null : structuredClone(PODCAST_OK),
    podcastAudioPath: opts.audio === false ? null : 'podcast/x.mp3',
  }]
}

// 用明確的 shape type 取代 any，避開 eslint 的 no-explicit-any。
interface OpsStatusDay {
  date: string
  expected: string
  skipReason: string | null
  brief: {
    exists: boolean
    createdAt: string | null
    late: boolean | null
    narrative: boolean
    dailyThesis: boolean
    viewpoints: boolean
    podcast: boolean
    audio: boolean
  }
  claims: { total: number, grounded: number } | null
  storylines: { touched: number, usable: number }
  freshness: {
    newsItems24h: number
    series: { seriesId: string, state: string, lagCycles: number | null }[] | null
  }
  ok: boolean
}

describe('gET /ops/publication-status', () => {
  it('weekday 準時完整 → ok true、late false、旗標齊', async () => {
    seedBrief('2026-07-17', { createdAt: '2026-07-16T21:20:00Z' }) // = 台北 05:20、07:00 前
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-17')
    expect(res.status).toBe(200)
    const json = await res.json() as { days: OpsStatusDay[] }
    const d = json.days[0]
    expect(d.expected).toBe('weekday-brief')
    expect(d.brief).toMatchObject({ exists: true, late: false, narrative: true, dailyThesis: true, viewpoints: true, podcast: true, audio: true })
    expect(d.freshness.newsItems24h).toBe(42)
    // 逐序列 freshness 來自該日 brief 產出當下的 manifest、不是現在重算
    expect(d.freshness.series).toEqual(FRESHNESS_FIXTURE)
    expect(d.ok).toBe(true)
  })

  it('舊 brief（有 freshness manifest 之前）沒有 manifest → series 回 null、不影響 ok', async () => {
    seedBrief('2026-07-17', { createdAt: '2026-07-16T21:20:00Z', freshness: undefined })
    briefRows['2026-07-17'] = [{
      briefDate: '2026-07-17',
      createdAt: new Date('2026-07-16T21:20:00Z'),
      briefJson: { narrative: NARRATIVE_OK, dailyThesis: '本日核心論點', viewpoints: VIEWPOINTS_OK },
      podcastJson: PODCAST_OK,
      podcastAudioPath: 'podcast/x.mp3',
    }]
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-17')
    const json = await res.json() as { days: OpsStatusDay[] }
    expect(json.days[0]?.freshness.series).toBeNull()
    expect(json.days[0]?.ok).toBe(true)
  })

  it('weekday 缺報 → exists false、ok false', async () => {
    delete briefRows['2026-07-16']
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-16')
    const d = (await res.json() as { days: OpsStatusDay[] }).days[0]
    expect(d.brief.exists).toBe(false)
    expect(d.ok).toBe(false)
  })

  it('late（createdAt 過 07:00 台北）→ late true、ok false', async () => {
    seedBrief('2026-07-17', { createdAt: '2026-07-17T01:30:00Z' }) // = 台北 09:30
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-17')
    const d = (await res.json() as { days: OpsStatusDay[] }).days[0]
    expect(d.brief.late).toBe(true)
    expect(d.ok).toBe(false)
  })

  it('narrative null → ok false', async () => {
    seedBrief('2026-07-17', { createdAt: '2026-07-16T21:20:00Z', narrative: false })
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-17')
    const d = (await res.json() as { days: OpsStatusDay[] }).days[0]
    expect(d.brief.narrative).toBe(false)
    expect(d.ok).toBe(false)
  })

  it('週六 → expected skip、無報告仍 ok true', async () => {
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-18') // 週六
    const d = (await res.json() as { days: OpsStatusDay[] }).days[0]
    expect(d.expected).toBe('skip')
    expect(d.skipReason).toBe('saturday')
    expect(d.ok).toBe(true)
  })

  it('days 參數：往回展開、上限 31、無效值 fallback 1', async () => {
    const res = await opsRoute.request('/ops/publication-status?date=2026-07-17&days=3')
    const json = await res.json() as { days: OpsStatusDay[] }
    expect(json.days.map(d => d.date)).toEqual(['2026-07-17', '2026-07-16', '2026-07-15'])
    const res99 = await opsRoute.request('/ops/publication-status?date=2026-07-17&days=99')
    expect((await res99.json() as { days: OpsStatusDay[] }).days).toHaveLength(31)
    const resBad = await opsRoute.request('/ops/publication-status?date=2026-07-17&days=abc')
    expect((await resBad.json() as { days: OpsStatusDay[] }).days).toHaveLength(1)
  })

  it('無效 date → 400', async () => {
    const res = await opsRoute.request('/ops/publication-status?date=not-a-date')
    expect(res.status).toBe(400)
  })
})

// 「近 24 小時沒有新聞」這類檢查只需要 days[0].freshness.newsItems24h 這一個數字，
// 所以這一組守的是「那個數字算的是什麼、以及零值時欄位還在不在」。
// 這裡驗的是監控端會依賴的端點契約——與上面 sources 那組同一個理由。
describe('publication-status 的 newsItems24h（「近 24 小時沒有新聞」檢查的唯一輸入）', () => {
  const readDay = async (q: string) =>
    (await (await opsRoute.request(`/ops/publication-status${q}`)).json() as { days: OpsStatusDay[] }).days[0]

  afterEach(() => {
    newsCount = 42
  })

  it('★ 窗是 deadline 往回 24 小時、deadline = 該日台北 07:00', async () => {
    // 這條把「補產的日子幾乎一定是 0」這件事釘成可讀的事實而不是口耳相傳：
    // 窗是台北 D-1 07:00 → D 07:00，所以當天早上 07:00 之後才跑的 refresh 一律落在窗外。
    // 「近 24 小時沒有新聞」的檢查因此不能只看這一欄就叫，還要排除 late 的日子。
    capturedNewsWindow = null
    await readDay('?date=2026-07-17')
    expect(capturedNewsWindow?.to.toISOString()).toBe(new Date('2026-07-17T07:00:00+08:00').toISOString())
    expect(capturedNewsWindow?.from.toISOString()).toBe(new Date('2026-07-16T07:00:00+08:00').toISOString())
  })

  // ★ 同型契約，補在 2026-08-23：「市場序列過期」的檢查只吃 days[0].freshness.series，而監控端若用
  //   jq 的 `// []` 讀它（例如為了容忍有 freshness manifest 之前的舊報告），欄位改名時會靜靜回空陣列、
  //   告警從此永遠不叫。**鍵**一定要在，值可以是 null（該日無報告或舊報告）。
  it('freshness.series 這個鍵一定在，無報告時值為 null 而不是缺欄位', async () => {
    const withBrief = await readDay('?date=2026-07-17')
    expect(Object.hasOwn(withBrief.freshness, 'series')).toBe(true)
    expect(Array.isArray(withBrief.freshness.series)).toBe(true)
    const noBrief = await readDay('?date=2026-07-20') // 未 seed brief 的 weekday
    expect(Object.hasOwn(noBrief.freshness, 'series')).toBe(true)
    expect(noBrief.freshness.series).toBeNull()
  })

  it('零產出時欄位仍是數字 0，不是 null 也不是缺欄位（監控端常直接用 jq 讀）', async () => {
    newsCount = 0
    const d = await readDay('?date=2026-07-17')
    expect(d.freshness.newsItems24h).toBe(0)
    expect(typeof d.freshness.newsItems24h).toBe('number')
  })

  it('該日無 brief 時照樣算得出來（「近 24 小時沒有新聞」與缺報是兩個獨立訊號）', async () => {
    newsCount = 0
    const d = await readDay('?date=2026-07-20') // 未 seed brief 的 weekday
    expect(d.brief.exists).toBe(false)
    expect(d.freshness.newsItems24h).toBe(0)
  })

  it('skip 日也算（週六仍跑 refresh 餵週日週報，只是「近 24 小時沒有新聞」的檢查不叫）', async () => {
    newsCount = 7
    const d = await readDay('?date=2026-07-18') // 週六
    expect(d.expected).toBe('skip')
    expect(d.freshness.newsItems24h).toBe(7)
  })

  // ★ 這兩條守的是「近 24 小時沒有新聞」檢查的**靜默失效路徑**——它們一旦破了，告警會無聲關掉而上面
  // 四條照樣全綠。獨立複查指出來的缺口。
  it('★ 無 brief 時 brief.late 必須是 null，不能是 true', async () => {
    // 「近 24 小時沒有新聞」的檢查用 `late == true` 當「跳過不檢」的條件。若哪天有人把
    // 「沒有 brief」也算成 late=true，這項檢查會在每一個缺報日被靜默跳過。
    const d = await readDay('?date=2026-07-20') // 未 seed brief 的 weekday
    expect(d.brief.exists).toBe(false)
    expect(d.brief.late).toBeNull()
  })

  it('★ expected 的取值集合只有三個——加新 kind 要同步改外部監控的判斷邏輯', async () => {
    // 「近 24 小時沒有新聞」的檢查用 `expected == "skip"` 當唯一的排除條件、其餘一律視為應產日。
    // 多一個 kind 而外部監控沒跟上，那類日子會落進「應產」分支。
    const kinds = new Set<string>()
    for (const date of ['2026-07-17', '2026-07-18', '2026-07-19']) // 五 / 六 / 日
      kinds.add((await readDay(`?date=${date}`)).expected)
    expect([...kinds].sort()).toEqual(['skip', 'weekday-brief', 'weekly-recap'])
  })
})

describe('publication-status 的 sources 區塊', () => {
  interface OpsSources {
    windowDays: number
    silent: string[]
    never: string[]
    neverUnexpected: string[]
    zeroUsable: string[]
    usability: Array<{ slug: string, articlesInWindow: number, usableInWindow: number }>
  }
  const read = async (q: string) =>
    (await (await opsRoute.request(`/ops/publication-status${q}`)).json() as { sources: OpsSources }).sources

  it('silent 與 never 分開回報', async () => {
    sourceActivity = [
      { slug: 'anue', articlesInWindow: 12, totalArticles: 450 },
      { slug: 'eia', articlesInWindow: 0, totalArticles: 41 },
      { slug: 'fomc-statements', articlesInWindow: 0, totalArticles: 0 },
    ]
    const s = await read('?date=2026-08-17')
    expect(s.silent).toEqual(['eia'])
    expect(s.never).toEqual(['fomc-statements'])
    expect(s.windowDays).toBe(7)
  })

  it('★ 判定窗含當日往回 7 個日曆日、以台北時間起算', async () => {
    // 這條是在守 off-by-one：窗是 [D-6, D] 共 7 天，不是 D-7。
    // 寫成 D-7 的話，來源會多活一天才被判 silent，而告警的意義就是早一天知道。
    sourceActivity = []
    await read('?date=2026-08-17')
    expect(capturedWindowStart?.toISOString()).toBe(new Date('2026-08-11T00:00:00+08:00').toISOString())
  })

  it('全部正常時三組皆為空陣列（不是 undefined，監控端常直接用 jq 讀）', async () => {
    sourceActivity = [{ slug: 'anue', articlesInWindow: 5, totalArticles: 450 }]
    const s = await read('?date=2026-08-17')
    expect(s.silent).toEqual([])
    expect(s.never).toEqual([])
    expect(s.neverUnexpected).toEqual([])
    expect(s.zeroUsable).toEqual([])
  })

  // 2026-08-21：never 一律不告警，會讓「換過 feed 卻仍抓不到」永遠沒人知道。
  // 端點要把「明示接受的」與「預期外的」分開，外部監控才有東西可以判斷失敗。
  it('neverUnexpected 只收不在接受清單裡的零產出來源', async () => {
    sourceActivity = [
      // twse-mops-news 在 ACCEPTED_ZERO_OUTPUT_SLUGS 裡（替代端點沒有 citation URL）。
      // ★ 這裡需要的只是「一個仍在接受清單裡的 slug」——清單被清空或這一筆被移走時，換成
      //   當時清單裡的任一個即可。上一輪用的是 twse-announcements，它已於 2026-08-22 改走
      //   TWSE OpenAPI 而離開清單，所以換成這個。
      { slug: 'twse-mops-news', articlesInWindow: 0, totalArticles: 0 },
      // cbc-press 是換過 feed、我們相信它會動的那一組，刻意不在接受清單裡
      { slug: 'cbc-press', articlesInWindow: 0, totalArticles: 0 },
    ]
    const s = await read('?date=2026-08-17')
    expect(s.never).toEqual(['cbc-press', 'twse-mops-news'])
    expect(s.neverUnexpected).toEqual(['cbc-press'])
  })

  it('sources 在 top level、不在 days[] 裡——它是現況不是某日的歷史', async () => {
    sourceActivity = [{ slug: 'eia', articlesInWindow: 0, totalArticles: 41 }]
    const json = await (await opsRoute.request('/ops/publication-status?date=2026-08-17&days=3')).json() as {
      days: Array<Record<string, unknown>>
      sources: OpsSources
    }
    expect(json.sources.silent).toEqual(['eia'])
    for (const d of json.days)
      expect(d).not.toHaveProperty('sources')
  })
})

// 有列 ≠ 可用。html-selector 的 excerpt 曾經寫死 null，fsc-news 修好 selector 之後
// 真的抓到 15 篇、卻一篇都沒 enrich——那些列在 retriever 的 jsonb containment 底下不可達，
// 而它因為「有列」離開了 never 類，SLO 顯示健康，比修之前更難發現。
describe('publication-status 的 enrich 可見性', () => {
  interface OpsSources {
    zeroUsable: string[]
    usability: Array<{ slug: string, articlesInWindow: number, usableInWindow: number }>
  }
  const read = async (q: string) =>
    (await (await opsRoute.request(`/ops/publication-status${q}`)).json() as { sources: OpsSources }).sources

  // ★ 這條釘的是外部監控「端點欄位缺失或型別不符」那類檢查對得上什麼。少了它，端點把某個欄位
  //   改名或拿掉時，用 jq `// []` 讀的監控會靜靜回空陣列——依賴這些欄位的來源告警一起永遠不叫，
  //   而輸出與健康日一模一樣。newsItems24h 已經有同型的契約測試（見上面那組）。
  it('sources 一定帶齊外部監控讀的五個欄位', async () => {
    sourceActivity = []
    const s = await read('?date=2026-08-23') as unknown as Record<string, unknown>
    for (const key of ['silent', 'never', 'neverUnexpected', 'zeroUsable', 'usability'])
      expect(Array.isArray(s[key]), `sources.${key} 應為陣列`).toBe(true)
  })

  it('窗內有列、零篇 enrich 的來源進 zeroUsable', async () => {
    sourceActivity = [
      { slug: 'fsc-news', articlesInWindow: 15, totalArticles: 15, usableInWindow: 0 },
      { slug: 'anue', articlesInWindow: 90, totalArticles: 1026, usableInWindow: 90 },
    ]
    const s = await read('?date=2026-08-23')
    expect(s.zeroUsable).toEqual(['fsc-news'])
  })

  // Google News 代理不被 enrich 是規則一刻意擋的（description 剝完等於標題），
  // 而且它們早就被 AGGREGATOR_PROXY_SLUGS 排除在檢索之外。不接受它們的話，
  // 這條告警上線第一天就 8/26 在叫。
  it('明示接受清單裡的代理來源不進 zeroUsable', async () => {
    sourceActivity = [
      { slug: 'reuters-biz', articlesInWindow: 216, totalArticles: 715, usableInWindow: 0 },
      { slug: 'wsj-markets', articlesInWindow: 197, totalArticles: 2336, usableInWindow: 0 },
    ]
    const s = await read('?date=2026-08-23')
    expect(s.zeroUsable).toEqual([])
  })

  // 只有分類的話，值班的人看到告警還得自己撈 DB 才知道嚴重到什麼程度。
  it('回逐來源的窗內 enrich 明細，slug 升冪', async () => {
    sourceActivity = [
      { slug: 'fsc-news', articlesInWindow: 15, totalArticles: 15, usableInWindow: 0 },
      { slug: 'anue', articlesInWindow: 90, totalArticles: 1026, usableInWindow: 88 },
      // 窗內零列的來源不列——它的問題是 silent／never，不是 enrich 率
      { slug: 'cbc-press', articlesInWindow: 0, totalArticles: 0, usableInWindow: 0 },
    ]
    const s = await read('?date=2026-08-23')
    expect(s.usability).toEqual([
      { slug: 'anue', articlesInWindow: 90, usableInWindow: 88 },
      { slug: 'fsc-news', articlesInWindow: 15, usableInWindow: 0 },
    ])
  })
})

// 日報管線是另一張表、另一條 pipeline。corpus 那組訊號完全照不到它，而「近 24 小時沒有新聞」
// 的檢查讀的是全表純 count（18 個來源死掉 17 個也不會叫）。這一組守的是 newsSources 的契約。
describe('publication-status 的 newsSources 區塊', () => {
  interface OpsNewsSources {
    windowDays: number
    silent: string[]
    never: string[]
    neverUnexpected: string[]
    zeroUsable: string[]
    usability: Array<{ slug: string, articlesInWindow: number, usableInWindow: number }>
  }
  const read = async (q: string) =>
    (await (await opsRoute.request(`/ops/publication-status${q}`)).json() as { newsSources: OpsNewsSources }).newsSources

  afterEach(() => {
    newsSourceActivity = []
  })

  it('窗內有則數、零則可用的來源進 zeroUsable', async () => {
    newsSourceActivity = [
      { slug: 'ltn-business', articlesInWindow: 160, totalArticles: 1818, usableInWindow: 160, createdAt: '2026-01-01T00:00:00Z' },
      { slug: 'cna', articlesInWindow: 67, totalArticles: 841, usableInWindow: 0, createdAt: '2026-01-01T00:00:00Z' },
    ]
    const s = await read('?date=2026-08-23')
    expect(s.zeroUsable).toEqual(['cna'])
  })

  // Google News 代理的 content_text 是錨點 markup、非空但資訊量為零。不接受它們的話，
  // 這條告警上線第一天就 13/18 在叫（2026-08-23 對 prod 實測；修正後是 10/18）。
  //
  // ★ slug 從 ACCEPTED_ZERO_USABLE_NEWS_SLUGS **取**、一個都不寫死：那份清單是從
  // `isGoogleNewsProxySeed` 推導的，來源換掉 feed 就會離開它。2026-08-28 把
  // google-news-udn 換成 money.udn.com 直連時，這條測試原本寫死的正是那個 slug——
  // 它從「被豁免」變成「該告警」，測試才紅。整份清單餵進去就不會再腐爛，而且順帶
  // 把「清單裡每一個都不該進 zeroUsable」驗滿，比抽兩個當樣本強。
  it('明示接受清單裡的 Google News 代理不進 zeroUsable', async () => {
    expect(ACCEPTED_ZERO_USABLE_NEWS_SLUGS.length, '豁免清單是空的，這條測試就沒有在驗東西').toBeGreaterThan(0)
    newsSourceActivity = ACCEPTED_ZERO_USABLE_NEWS_SLUGS.map(slug => (
      { slug, articlesInWindow: 343, totalArticles: 4099, usableInWindow: 0, createdAt: '2026-01-01T00:00:00Z' }
    ))
    const s = await read('?date=2026-08-23')
    expect(s.zeroUsable).toEqual([])
  })

  it('與 corpus 那組共用同一個判定窗起點', async () => {
    capturedNewsActivityWindow = null
    await read('?date=2026-08-17')
    expect(capturedNewsActivityWindow?.toISOString()).toBe(new Date('2026-08-11T00:00:00+08:00').toISOString())
  })

  it('一定帶齊外部監控讀的六個欄位（缺欄位時 jq 會靜靜回空陣列）', async () => {
    const s = await read('?date=2026-08-23') as unknown as Record<string, unknown>
    for (const key of ['silent', 'never', 'neverUnexpected', 'zeroUsable', 'usability'])
      expect(Array.isArray(s[key]), `newsSources.${key} 應為陣列`).toBe(true)
    expect(typeof s.windowDays).toBe('number')
  })

  // ★ 這兩條釘的是 silent／never 那條接線。少了它們，把 acceptedZeroOutput 從 []
  //   改成代理清單的突變可以全綠存活——而那個版本的意思是「整批代理從此永久零產出
  //   也不會有人知道」。獨立複查實測那個突變原本是存活的。
  it('零產出的日報來源進 never 與 neverUnexpected（代理不因為可用率清單而被豁免）', async () => {
    // 這條要證明的是「**豁免清單裡的**來源零產出仍然會叫」，所以 slug 必須真的在那份
    // 清單裡——寫死一個哪天離開清單的 slug，這條會變成證明不了自己標題的空測試。
    const [proxy] = ACCEPTED_ZERO_USABLE_NEWS_SLUGS
    expect(proxy, '豁免清單是空的，這條測試就沒有在驗東西').toBeDefined()
    newsSourceActivity = [
      { slug: proxy as string, articlesInWindow: 0, totalArticles: 0, usableInWindow: 0, createdAt: '2026-01-01T00:00:00Z' },
    ]
    const s = await read('?date=2026-08-23')
    expect(s.never).toEqual([proxy])
    expect(s.neverUnexpected).toEqual([proxy])
  })

  it('曾經產出、窗內掛零的來源進 silent', async () => {
    newsSourceActivity = [
      { slug: 'eia', articlesInWindow: 0, totalArticles: 43, usableInWindow: 0, createdAt: '2026-01-01T00:00:00Z' },
    ]
    const s = await read('?date=2026-08-23')
    expect(s.silent).toEqual(['eia'])
    // 窗內零則的來源不進 zeroUsable——那是 silent 的事，不該重複叫
    expect(s.zeroUsable).toEqual([])
  })

  it('回逐來源可用率明細、slug 升冪，窗內零則的來源不列', async () => {
    newsSourceActivity = [
      { slug: 'ltn-business', articlesInWindow: 160, totalArticles: 1818, usableInWindow: 160, createdAt: '2026-01-01T00:00:00Z' },
      { slug: 'cna', articlesInWindow: 67, totalArticles: 841, usableInWindow: 67, createdAt: '2026-01-01T00:00:00Z' },
      { slug: 'tvbs', articlesInWindow: 0, totalArticles: 12, usableInWindow: 0, createdAt: '2026-01-01T00:00:00Z' },
    ]
    const s = await read('?date=2026-08-23')
    expect(s.usability).toEqual([
      { slug: 'cna', articlesInWindow: 67, usableInWindow: 67 },
      { slug: 'ltn-business', articlesInWindow: 160, usableInWindow: 160 },
    ])
  })
})

// DEGRADED 的五個旗標從「有沒有」改成「能不能用」。上面 enrich 可見性那組治 corpus、
// newsSources 那組治日報來源，這是同一個形狀的第三個現場——`!= null` 對「narrative 零段落」
// 「viewpoints 空陣列」「thesis 空字串」一律說健康，而讀者面是空的。
describe('publication-status 的內容旗標', () => {
  const readDay = async (q = '?date=2026-07-17') =>
    (await (await opsRoute.request(`/ops/publication-status${q}`)).json() as { days: OpsStatusDay[] }).days[0]

  const ON_TIME = '2026-07-16T21:20:00Z'

  it('★ 全部欄位「非 null 但沒有內容」時五個旗標都是 false、ok false', async () => {
    briefRows['2026-07-17'] = [{
      briefDate: '2026-07-17',
      createdAt: new Date(ON_TIME),
      briefJson: {
        narrative: { intro: '', outro: '', sections: [] },
        dailyThesis: '   ',
        viewpoints: [],
        claimLedger: [],
        dataFreshness: FRESHNESS_FIXTURE,
      },
      podcastJson: { acts: [] },
      podcastAudioPath: '',
    }]
    const d = await readDay()
    expect(d?.brief).toMatchObject({ exists: true, narrative: false, dailyThesis: false, viewpoints: false, podcast: false, audio: false })
    expect(d?.ok).toBe(false)
  })

  it('narrative 有段落但其中一段是空白 → narrative false', async () => {
    seedBrief('2026-07-17', { createdAt: ON_TIME })
    const row = briefRows['2026-07-17']?.[0] as { briefJson: { narrative: { sections: unknown[] } } }
    row.briefJson.narrative.sections = [{ heading: 'a', body: '正文'.repeat(80) }, { heading: 'b', body: ' ' }]
    expect((await readDay())?.brief.narrative).toBe(false)
  })

  it('viewpoints 降級成空陣列 → viewpoints false（舊判定會說 true）', async () => {
    seedBrief('2026-07-17', { createdAt: ON_TIME })
    const row = briefRows['2026-07-17']?.[0] as { briefJson: Record<string, unknown> }
    row.briefJson.viewpoints = []
    expect((await readDay())?.brief.viewpoints).toBe(false)
  })

  it('podcast 文稿的 acts 是空陣列 → podcast false、ok false', async () => {
    seedBrief('2026-07-17', { createdAt: ON_TIME })
    const row = briefRows['2026-07-17']?.[0] as { podcastJson: Record<string, unknown> }
    row.podcastJson.acts = []
    const d = await readDay()
    expect(d?.brief.podcast).toBe(false)
    expect(d?.ok).toBe(false)
  })

  it('健康的報告五個旗標都是 true', async () => {
    seedBrief('2026-07-17', { createdAt: ON_TIME })
    expect((await readDay())?.brief).toMatchObject({ narrative: true, dailyThesis: true, viewpoints: true, podcast: true, audio: true })
  })
})

describe('publication-status 的 claim ledger 訊號', () => {
  const readDay = async (q = '?date=2026-07-17') =>
    (await (await opsRoute.request(`/ops/publication-status${q}`)).json() as { days: OpsStatusDay[] }).days[0]

  it('回總筆數與可追溯筆數', async () => {
    seedBrief('2026-07-17', { createdAt: '2026-07-16T21:20:00Z' })
    expect((await readDay())?.claims).toEqual({ total: 2, grounded: 1 })
  })

  it('★ 空 ledger 回 total 0——這是「今天產不出 claim」，外部監控要叫', async () => {
    seedBrief('2026-07-17', { createdAt: '2026-07-16T21:20:00Z', claimLedger: [] })
    expect((await readDay())?.claims).toEqual({ total: 0, grounded: 0 })
  })

  it('★ 舊報告沒有 claimLedger 欄位時回 null，不是 0——兩者要分得開', async () => {
    seedBrief('2026-07-17', { createdAt: '2026-07-16T21:20:00Z', claimLedger: null })
    briefRows['2026-07-17'] = [{
      briefDate: '2026-07-17',
      createdAt: new Date('2026-07-16T21:20:00Z'),
      briefJson: { narrative: NARRATIVE_OK, dailyThesis: 't', viewpoints: VIEWPOINTS_OK },
      podcastJson: PODCAST_OK,
      podcastAudioPath: 'podcast/x.mp3',
    }]
    expect((await readDay())?.claims).toBeNull()
  })

  it('該日無報告時 claims 是 null，而 claims 這個鍵一定在', async () => {
    delete briefRows['2026-07-16']
    const d = await readDay('?date=2026-07-16')
    expect(d).toHaveProperty('claims')
    expect(d?.claims).toBeNull()
  })

  it('claims 不進 ok（獨立訊號、獨立告警）', async () => {
    seedBrief('2026-07-17', { createdAt: '2026-07-16T21:20:00Z', claimLedger: [] })
    expect((await readDay())?.ok).toBe(true)
  })
})

describe('publication-status 的敘事線訊號', () => {
  afterEach(() => {
    storylineActivity = { open: 9, total: 20, byDate: {} }
  })

  const readBody = async (q: string) =>
    await (await opsRoute.request(`/ops/publication-status${q}`)).json() as {
      days: OpsStatusDay[]
      storylines: { open: number, total: number }
    }

  it('逐日 touched／usable 進 days[]', async () => {
    storylineActivity = { open: 9, total: 20, byDate: { '2026-07-17': { touched: 4, usable: 4 } } }
    const body = await readBody('?date=2026-07-17')
    expect(body.days[0]?.storylines).toEqual({ touched: 4, usable: 4 })
  })

  it('沒有任何敘事線被觸及的日子回 0，鍵不可以消失', async () => {
    const body = await readBody('?date=2026-07-17')
    expect(body.days[0]?.storylines).toEqual({ touched: 0, usable: 0 })
  })

  // ★ 曾有一次驗收設計了一個突變（`byDate[date]` 換成 `byDate[dates[0]]`）並存活下來：
  // 逐日錯位時每一天都會印第 0 天的數字，而當時所有測試的每一天都是同一組值。
  it('★ 逐日對應不可以錯位——days[1] 拿的必須是 days[1] 那天的數字', async () => {
    storylineActivity = {
      open: 9,
      total: 20,
      byDate: {
        '2026-07-17': { touched: 4, usable: 4 },
        '2026-07-16': { touched: 2, usable: 1 },
        '2026-07-15': { touched: 0, usable: 0 },
      },
    }
    const body = await readBody('?date=2026-07-17&days=3')
    expect(body.days.map(d => d.storylines)).toEqual([
      { touched: 4, usable: 4 },
      { touched: 2, usable: 1 },
      { touched: 0, usable: 0 },
    ])
  })

  it('★ open／total 在 top level、不在 days[] 裡——status 只有「現在」一個版本', async () => {
    const body = await readBody('?date=2026-07-17&days=3')
    expect(body.storylines).toEqual({ open: 9, total: 20 })
    for (const d of body.days)
      expect(d).not.toHaveProperty('open')
  })

  it('★ open 歸零而 total 不為零＝池子整批退場，是這裡要抓的「有列但不能用」', async () => {
    storylineActivity = { open: 0, total: 20, byDate: {} }
    expect((await readBody('?date=2026-07-17')).storylines).toEqual({ open: 0, total: 20 })
  })

  it('問到的日期就是 days[] 的日期，一次撈全表不逐日查', async () => {
    capturedStorylineDates = null
    await readBody('?date=2026-07-17&days=3')
    expect(capturedStorylineDates).toEqual(['2026-07-17', '2026-07-16', '2026-07-15'])
  })
})

// 直接列出完整的頂層鍵集合：回應形狀是對外契約，多一個或少一個鍵都要讓這條紅，
// 不留「沒被斷言到、哪天默默多出一個鍵也不會紅」的縫。
describe('publication-status 的頂層鍵集合', () => {
  it('恰好五個鍵', async () => {
    const body = await (await opsRoute.request('/ops/publication-status')).json() as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['days', 'generatedAt', 'newsSources', 'sources', 'storylines'])
  })
})
