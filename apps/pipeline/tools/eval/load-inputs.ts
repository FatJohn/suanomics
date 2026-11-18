import type { MarketBrief } from '@suanomics/shared'
import type { ContinuityJudgeInput, StorylineView } from './continuity-judge.prompt.js'
import type { QualityFacts } from './quality-judge.prompt.js'
import { MarketBriefSchema } from '@suanomics/shared'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { getDb } from '../../src/db/client.js'
import { getExternalArticlesByUrls } from '../../src/db/repos/articles-repo.js'
import { getNewsItemsByIds, getNewsItemsByUrls } from '../../src/db/repos/news-repo.js'
import { getStorylinesUpdatedInRange } from '../../src/db/repos/storylines-repo.js'
import { dailyBriefs, llmCalls } from '../../src/db/schema.js'
import { buildCalendarBlock } from '../../src/ingest/market-data/calendar.js'
import { loadMarketContext } from '../../src/ingest/market-data/context.js'
import { buildSeriesAsOf } from '../../src/ingest/market-data/historical-asof.js'
import { JUDGE_AGENT } from './judge-plan.js'
import { mergeQualitySources } from './quality-facts.js'

export interface StoredBrief { date: string, selectedNewsIds: number[], brief: MarketBrief }

const PRIOR_BRIEFS = 3

function parseBrief(date: string, raw: unknown): MarketBrief {
  const parsed = MarketBriefSchema.safeParse(raw)
  if (!parsed.success)
    throw new Error(`${date} 的 brief_json 不符 MarketBriefSchema：${parsed.error.message}`)
  return parsed.data
}

/** 沒有 complete 的 brief 回 null，由呼叫端決定失敗或跳過。 */
export async function loadStoredBrief(date: string): Promise<StoredBrief | null> {
  const rows = await getDb().select().from(dailyBriefs).where(and(eq(dailyBriefs.briefDate, date), eq(dailyBriefs.status, 'complete'))).limit(1)
  const row = rows[0]
  if (!row)
    return null
  return { date, selectedNewsIds: row.selectedNewsIds, brief: parseBrief(date, row.briefJson) }
}

// 底本要還原「產出當時 pipeline 看到的素材」：序列快照用 brief 自己記的逐序列 as-of，
// 行事曆直接用 brief 落地的 calendarEvents（除權息、法說會來源沒有歷史，事後重抓會不一樣）。
export async function loadQualityFacts(stored: StoredBrief): Promise<QualityFacts> {
  const { brief, date } = stored
  const citedUrls = brief.citations.map(c => c.url)
  const [byId, byUrl, corpus, market] = await Promise.all([
    getNewsItemsByIds(stored.selectedNewsIds),
    getNewsItemsByUrls(citedUrls),
    getExternalArticlesByUrls(citedUrls),
    loadMarketContext({
      reportDate: date,
      now: new Date(`${date}T05:00:00+08:00`),
      seriesAsOf: buildSeriesAsOf(brief.dataFreshness ?? []),
      fetchExDividend: async () => [],
      fetchInvestorConference: async () => [],
    }),
  ])
  return {
    marketSnapshot: market.snapshotBlock,
    calendar: buildCalendarBlock(brief.calendarEvents ?? [], new Date(`${date}T00:00:00Z`), undefined, brief.calendarCoverage),
    official: market.officialBlock,
    news: mergeQualitySources([...byId, ...byUrl], corpus),
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

/** 帳本裡該報告日已有 ok 紀錄的 judge agent。 */
export async function loadJudgedAgents(date: string): Promise<string[]> {
  const rows = await getDb().selectDistinct({ agent: llmCalls.agent }).from(llmCalls).where(and(
    eq(llmCalls.reportDate, date),
    eq(llmCalls.status, 'ok'),
    inArray(llmCalls.agent, Object.values(JUDGE_AGENT)),
  ))
  return rows.map(r => r.agent)
}
