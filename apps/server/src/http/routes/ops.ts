import process from 'node:process'
import { getSourceActivity } from '@suanomics/db/repos/articles-repo'
import { countNewsFetchedBetween, getDailyBriefsForDates } from '@suanomics/db/repos/news-repo'
import { getNewsSourceActivity } from '@suanomics/db/repos/news-source-activity'
import { getStorylineActivity } from '@suanomics/db/repos/storyline-activity'
import { ACCEPTED_ZERO_USABLE_NEWS_SLUGS } from '@suanomics/db/seed'
import { ACCEPTED_ZERO_ENRICHMENT_SLUGS, ACCEPTED_ZERO_OUTPUT_SLUGS } from '@suanomics/db/seed-external-sources'
import { checkStartupConfig, classifyPublicationDay, SeriesFreshnessSchema, SOURCE_SILENCE_WINDOW_DAYS, summarizeBriefContent, summarizeSourceSilence, taipeiDateOf } from '@suanomics/shared'
import { Hono } from 'hono'
import { z } from 'zod'

// publication SLO 的 read-only signal：今日（或往回 N 日）報告存在/準時/完整/夠新。
// 全部現算自 DB、無新狀態。外部監控與人工核對應產日，都可以讀這個端點。
export const opsRoute = new Hono()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 31

// briefJson 只探測 freshness manifest。內容旗標改由 summarizeBriefContent 直接讀原始 jsonb：
// 健康訊號若要先通過 Zod 才算得出來，schema 沒守住的形狀就會變成「算不出來」
// 而不是「不健康」，而那正是要抓的那一類。
const BriefJsonProbeSchema = z.object({
  // 舊 brief 沒有這個欄位、catch 成 undefined 不讓整包 probe 失敗。
  dataFreshness: z.array(SeriesFreshnessSchema).nullish().catch(undefined),
})

function isoDateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

const MS_PER_DAY = 86_400_000

opsRoute.get('/ops/publication-status', async (c) => {
  const anchor = c.req.query('date') ?? taipeiDateOf(new Date())
  if (!DATE_RE.test(anchor))
    return c.json({ error: 'invalid_date' }, 400)
  const daysRaw = Number(c.req.query('days') ?? '1')
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), MAX_DAYS) : 1

  const dates = Array.from({ length: days }, (_, i) => isoDateMinusDays(anchor, i))
  const rows = await getDailyBriefsForDates(dates)
  const rowByDate = new Map(rows.map(r => [r.briefDate, r]))
  // 敘事線是**全表**掃一次、逐日分帳，不是每天各查一次：storylines 至 2026-08-23 是
  // 20 列（open 硬上限 10、其餘轉 dormant 後留著），逐日查只是把同一張小表掃 N 次。
  const storylineActivity = await getStorylineActivity(dates)

  const daysOut = await Promise.all(dates.map(async (date) => {
    const expected = classifyPublicationDay(date)
    const row = rowByDate.get(date)
    const deadline = new Date(`${date}T07:00:00+08:00`)
    const newsItems24h = await countNewsFetchedBetween(new Date(deadline.getTime() - MS_PER_DAY), deadline)

    const probe = row ? BriefJsonProbeSchema.safeParse(row.briefJson) : null
    // 五個旗標從 `!= null` 改成「有沒有內容」。舊版對「narrative 是零段落」、
    // 「viewpoints 降級成空陣列」、「dailyThesis 是空字串」一律回 true——與 corpus 那組、
    // 日報來源那組同一個形狀的第三個現場。判定本身在 @suanomics/shared/brief-health（純函式、有測試），
    // 欄位名字也關在那裡。
    const content = summarizeBriefContent({
      briefJson: row?.briefJson,
      podcastJson: row?.podcastJson,
      podcastAudioPath: row?.podcastAudioPath,
    })
    const brief = {
      exists: row != null,
      createdAt: row?.createdAt.toISOString() ?? null,
      late: row ? row.createdAt.getTime() > deadline.getTime() : null,
      narrative: content.narrative,
      dailyThesis: content.dailyThesis,
      viewpoints: content.viewpoints,
      podcast: content.podcast,
      audio: content.audio,
    }
    // ok 的組成刻意不動（exists + narrative + podcast + 準時）。claims 與 storylines
    // 是各自獨立的訊號、各自有告警，塞進 ok 會讓「缺報」與「ledger 空掉」擠成同一個布林、
    // 值班的人反而看不出是哪一件事——sources 那組當初也是這樣分開的。
    const ok = expected.kind === 'skip'
      ? true
      : brief.exists && brief.narrative && brief.podcast && brief.late === false
    return {
      date,
      expected: expected.kind,
      skipReason: expected.reason ?? null,
      brief,
      // evidence 追溯的當日產出。null = 該日無報告、或欄位新增前的舊報告
      // （prod 實測 2026-08-07 以前皆為 absent）。**0 與 null 是兩件事**：0 是今天
      // 產不出 claim，null 是這份報告的形狀裡沒有這個欄位。
      claims: content.claims,
      // 該日被寫進 updates 的敘事線數（不分 status）。usable = note 有內容的筆數，
      // note 是唯一會進 storylineBlock 餵給 narrative 的欄位。
      storylines: storylineActivity.byDate[date] ?? { touched: 0, usable: 0 },
      // 逐序列 freshness 讀該日 brief 產出當下記下的 manifest、不是現在重算：
      // 要問的是「那份報告當時看到的資料有多新」。現在重算會被報告產出後才補上的資料
      // 洗成假綠（market_data_points.fetched_at 每輪 refresh 都被推新、還原不了當時狀態）。
      // null = 該日無 brief 或有 freshness manifest 之前的舊 brief。落後只呈現、不進 ok 判定。
      freshness: { newsItems24h, series: probe?.success === true ? probe.data.dataFreshness ?? null : null },
      ok,
    }
  }))

  // 來源零產出**刻意放在 top level、不放進 days[]**：它是「現在」的狀態，不是某一天的歷史。
  // days[].freshness.series 讀的是該日 brief 存下的 manifest，因為那個問題要問「那份報告當時
  // 看到的資料多新」；來源死掉則沒有等價的歷史快照，硬塞進 days[] 會讓每一天都印出同一份
  // 現況、看起來像是那天就這樣。
  const windowStart = new Date(`${isoDateMinusDays(anchor, SOURCE_SILENCE_WINDOW_DAYS - 1)}T00:00:00+08:00`)
  // acceptedZeroOutput 從 seed 檔帶進來（清單與來源設定放在一起，改 feed 的 diff 才看得到）。
  // 不傳的話 summarizeSourceSilence 會退回原本「never 一律只註記」的保守行為。
  const activity = await getSourceActivity(windowStart)
  const sources = summarizeSourceSilence(activity, {
    acceptedZeroOutput: ACCEPTED_ZERO_OUTPUT_SLUGS,
    // 沒有這一份，zeroUsable 上線第一天就會對著 Google News 代理群開火——它們不被
    // enrich 是規則一刻意擋的（2026-08-23 拿 prod 真資料量過：8/26 vs 1/26）。理由與
    // 「不要為了閉嘴往裡面加 slug」的界線寫在該常數的註解裡。
    acceptedZeroUsable: ACCEPTED_ZERO_ENRICHMENT_SLUGS,
  })

  // 逐來源的窗內可用率明細。只有分類的話，值班的人看到 zeroUsable 還得自己撈 DB
  // 才知道嚴重到什麼程度（15 篇全掛，還是 300 篇裡掛了 300 篇）。
  // 窗內零列的來源不列：它的問題是 silent／never，不是可用率，列進來只會混淆。
  const usability = activity
    .filter(a => a.articlesInWindow > 0)
    .map(a => ({ slug: a.slug, articlesInWindow: a.articlesInWindow, usableInWindow: a.usableInWindow }))
    .sort((a, b) => a.slug.localeCompare(b.slug))

  // 日報管線（news_sources／news_items）是另一張表、另一條 pipeline，corpus 那組
  // 訊號完全照不到它——「來源零產出」與「來源可用率掛零」那兩類檢查查的是 external_articles，
  // 而「近 24 小時沒有新聞」的檢查讀的 countNewsFetchedBetween 是**全表純 count**
  // （18 個來源死掉 17 個也不會叫）。
  // 判定邏輯共用 summarizeSourceSilence，只是「能用」的定義不同（見 getNewsSourceActivity）。
  const newsActivity = await getNewsSourceActivity(windowStart)
  const newsSilence = summarizeSourceSilence(newsActivity, {
    // 空陣列＝日報端沒有「已知零產出、明示接受」的來源。18 個啟用來源全部有歷史產出
    // （2026-08-23 實測），所以 never 類目前是空的；真的有來源從此不產出時就該叫。
    // 停用的來源不進這個判定（getNewsSourceActivity 只看 is_active）。
    acceptedZeroOutput: [],
    acceptedZeroUsable: ACCEPTED_ZERO_USABLE_NEWS_SLUGS,
  })
  const newsUsability = newsActivity
    .filter(a => a.articlesInWindow > 0)
    .map(a => ({ slug: a.slug, articlesInWindow: a.articlesInWindow, usableInWindow: a.usableInWindow }))
    .sort((a, b) => a.slug.localeCompare(b.slug))

  // 敘事線的池子狀態與 sources 同理，放 top level：status 只有「現在」這一個版本，
  // 塞進 days[] 會讓每一天都印出同一份現況、看起來像那天就這樣。
  // open 是「能不能用」：editor 下一輪只看得到 open 線，池子歸零時 storylineBlock 是
  // 空字串、跨日連續性靜默斷掉，而全表照樣有一堆 dormant 列讓「有沒有」說健康。
  return c.json({
    generatedAt: new Date().toISOString(),
    days: daysOut,
    sources: { ...sources, usability },
    newsSources: { ...newsSilence, usability: newsUsability },
    storylines: { open: storylineActivity.open, total: storylineActivity.total },
  })
})

// 啟動時設定檢查的可讀介面。env 在 process 生命週期內不變，所以現算的結果就是啟動時
// 那一份；把它掛成端點是為了讓「某個次要依賴其實沒設」這件事有地方可查，而不是只躺在
// 容器 log 裡等人捲到。
//
// ★ HTTP 與 job 消費 2026-09-04 起在同一個 process，所以這裡回的就是整個 server 那份，
//   不再有「另一個 service 的檢查只在它自己的 log」這回事。
// ★ 回應只含 key 名與影響描述，永遠不含任何設定值。
opsRoute.get('/ops/config-health', (c) => {
  const result = checkStartupConfig('server', process.env)
  return c.json({
    service: result.service,
    ok: result.ok,
    degraded: result.degraded.length > 0,
    issues: result.issues,
  })
})
