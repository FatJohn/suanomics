import type { MarketBrief } from '@suanomics/shared'
import type { ContinuityJudgeInput, StorylineView } from './continuity-judge.prompt.js'
import type { QualityFacts } from './quality-judge.prompt.js'
import { MarketBriefSchema } from '@suanomics/shared'
import { and, desc, eq, lt } from 'drizzle-orm'
import { getDb } from '../../src/db/client.js'
import { getNewsItemsByIds, getNewsItemsByUrls } from '../../src/db/repos/news-repo.js'
import { getStorylinesUpdatedInRange } from '../../src/db/repos/storylines-repo.js'
import { dailyBriefs } from '../../src/db/schema.js'
import { buildCalendarBlock } from '../../src/ingest/market-data/calendar.js'
import { loadMarketContext } from '../../src/ingest/market-data/context.js'
import { buildSeriesAsOf } from '../../src/ingest/market-data/historical-asof.js'

export interface StoredBrief { date: string, selectedNewsIds: number[], brief: MarketBrief }

const PRIOR_BRIEFS = 3

function parseBrief(date: string, raw: unknown): MarketBrief {
  const parsed = MarketBriefSchema.safeParse(raw)
  if (!parsed.success)
    throw new Error(`${date} 的 brief_json 不符 MarketBriefSchema：${parsed.error.message}`)
  return parsed.data
}

export async function loadStoredBrief(date: string): Promise<StoredBrief> {
  const rows = await getDb().select().from(dailyBriefs).where(and(eq(dailyBriefs.briefDate, date), eq(dailyBriefs.status, 'complete'))).limit(1)
  const row = rows[0]
  if (!row)
    throw new Error(`${date} 沒有 complete 的 daily_briefs`)
  return { date, selectedNewsIds: row.selectedNewsIds, brief: parseBrief(date, row.briefJson) }
}

// 底本要還原「產出當時 pipeline 看到的素材」：序列快照用 brief 自己記的逐序列 as-of，
// 行事曆直接用 brief 落地的 calendarEvents（除權息、法說會來源沒有歷史，事後重抓會不一樣）。
export async function loadQualityFacts(stored: StoredBrief): Promise<QualityFacts> {
  const { brief, date } = stored
  const [byId, byUrl, market] = await Promise.all([
    getNewsItemsByIds(stored.selectedNewsIds),
    getNewsItemsByUrls(brief.citations.map(c => c.url)),
    loadMarketContext({
      reportDate: date,
      now: new Date(`${date}T05:00:00+08:00`),
      seriesAsOf: buildSeriesAsOf(brief.dataFreshness ?? []),
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
    }),
  ])
  const news = new Map([...byId, ...byUrl].map(n => [n.id, { title: n.title, url: n.url, text: n.contentText ?? n.title }]))
  return {
    marketSnapshot: market.snapshotBlock,
    calendar: buildCalendarBlock(brief.calendarEvents ?? [], new Date(`${date}T00:00:00Z`), undefined, brief.calendarCoverage),
    official: market.officialBlock,
    news: [...news.values()],
  }
}

export async function loadContinuityInput(stored: StoredBrief): Promise<ContinuityJudgeInput> {
  const rows = await getDb().select({ briefDate: dailyBriefs.briefDate, briefJson: dailyBriefs.briefJson }).from(dailyBriefs).where(and(eq(dailyBriefs.status, 'complete'), lt(dailyBriefs.briefDate, stored.date))).orderBy(desc(dailyBriefs.briefDate)).limit(PRIOR_BRIEFS)
  const priors = rows.reverse().map(r => ({ date: r.briefDate, brief: parseBrief(r.briefDate, r.briefJson) }))
  const since = priors[0]?.date ?? stored.date
  // 只留窗內的進展：之後的進展是未來資訊，更早的進展前幾日報告也沒寫到。
  const storylines: StorylineView[] = (await getStorylinesUpdatedInRange(since, stored.date)).map(s => ({
    id: s.id,
    title: s.title,
    thesis: s.thesis,
    updates: s.updates.filter(u => u.briefDate >= since && u.briefDate <= stored.date),
  }))
  return { date: stored.date, brief: stored.brief, priors, storylines }
}
