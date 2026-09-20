import type { MarketBrief } from '@suanomics/shared'
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
import type { MarketContext } from '../market-data/context.js'
import { getDb } from '@suanomics/db/client'
import { getStorylinesTouchedOn } from '@suanomics/db/repos/storylines-repo'
import { dailyBriefs } from '@suanomics/db/schema'
import { MarketBriefSchema } from '@suanomics/shared'
import { eq } from 'drizzle-orm'
import { buildMarketCloseFraming } from '../agents/market-close-framing.js'
import { callPodcastWriter } from '../agents/podcast-writer.js'
import { buildStorylineBlock } from '../agents/storyline-block.js'
import { EMPTY_MARKET_CONTEXT, loadMarketContext } from '../market-data/context.js'

export interface RunPodcastGenerateArgs {
  date: string
  force?: boolean
}

export interface RunPodcastGenerateResult {
  briefDate: string
  totalChars: number
  acts: number
  forbiddenSanitized: number
  hookHeadline: string
  elapsedMs: number
  skipped: boolean // true 表 podcast 已存在、未重跑
}

export async function runPodcastGenerate(args: RunPodcastGenerateArgs): Promise<RunPodcastGenerateResult> {
  const { date, force = false } = args
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`runPodcastGenerate: invalid date format ${date}`)

  const db = getDb()
  const rows = await db
    .select({ briefDate: dailyBriefs.briefDate, briefJson: dailyBriefs.briefJson, podcastJson: dailyBriefs.podcastJson })
    .from(dailyBriefs)
    .where(eq(dailyBriefs.briefDate, date))
    .limit(1)

  const row = rows[0]
  if (!row)
    throw new Error(`runPodcastGenerate: no brief found for ${date}. Run brief:generate first.`)
  if (!row.briefJson)
    throw new Error(`runPodcastGenerate: brief ${date} has no briefJson stored.`)
  if (row.podcastJson && !force) {
    console.log(`[runPodcastGenerate] skip ${date}: podcast already exists`)
    const existing = row.podcastJson as { acts?: unknown[], meta?: { totalChars?: number }, hook?: { headline?: string } }
    const acts = Array.isArray(existing.acts) ? existing.acts.length : 0
    const totalChars = typeof existing.meta?.totalChars === 'number' ? existing.meta.totalChars : 0
    const hookHeadline = typeof existing.hook?.headline === 'string' ? existing.hook.headline : ''
    return {
      briefDate: date,
      totalChars,
      acts,
      forbiddenSanitized: 0,
      hookHeadline,
      elapsedMs: 0,
      skipped: true,
    }
  }

  let brief: MarketBrief
  try {
    brief = MarketBriefSchema.parse(row.briefJson)
  }
  catch (e) {
    throw new Error(`runPodcastGenerate: brief ${date}.briefJson failed schema validation: ${String(e)}`)
  }
  if (!brief.narrative)
    throw new Error(`runPodcastGenerate: brief ${date}.narrative is null — regenerate this brief before generating the podcast.`)

  console.log(`[runPodcastGenerate] generating podcast for ${date}...`)
  const t0 = Date.now()
  // podcast job 與 brief job 為獨立 queue job、進程時序不同、此處自行載入市場 context
  // （snapshotBlock 供具名數字、calendarBlock 供前瞻）；任何失敗 graceful degrade、不擋 podcast 生成。
  const marketCtx = await loadMarketContext({ reportDate: date }).catch((): MarketContext => EMPTY_MARKET_CONTEXT)
  // 台股收盤時間框架（taiex-close 真實收盤日錨定今/昨）、與 brief 三 agent 一致、避免 podcast 誤標台股收盤時序。
  const marketCloseFraming = buildMarketCloseFraming(marketCtx.taiexCloseDate, date)
  // podcast 是獨立 queue job、不能共用 brief job 的記憶體 editor 結果、
  // 從 DB 還原當日 touch 的敘事線重組 storylineBlock；任何失敗 graceful degrade、不擋 podcast。
  const touched = await getStorylinesTouchedOn(date).catch(() => [])
  const entries = touched.flatMap((s) => {
    const u = s.updates.find(x => x.briefDate === date)
    return u ? [{ title: s.title, thesis: s.thesis, valence: u.valence, note: u.note }] : []
  })
  const storylineBlock = buildStorylineBlock(entries)
  // ★ 刻意不傳 marketCtx.officialBlock：podcast writer 改寫的是**已完成的 brief**，
  // 一手公告該影響的是 brief 怎麼寫，不是稿子怎麼念。再餵一次只會讓它引用 brief 裡
  // 沒有的東西——那正是 citation 對不上的來源。
  const result = await callPodcastWriter({ briefDate: date, brief, calendarBlock: marketCtx.calendarBlock, storylineBlock, marketSnapshot: marketCtx.snapshotBlock, marketCloseFraming })
  const elapsedMs = Date.now() - t0

  if (!result.podcast || result.audit.failed)
    throw new Error(`runPodcastGenerate: FAILED in ${elapsedMs}ms. retryReason=${result.audit.retryReason}`)

  await db.update(dailyBriefs)
    .set({ podcastJson: result.podcast as unknown })
    .where(eq(dailyBriefs.briefDate, date))

  console.log(`[runPodcastGenerate] DONE in ${elapsedMs}ms`)
  return {
    briefDate: date,
    totalChars: result.podcast.meta.totalChars,
    acts: result.podcast.acts.length,
    forbiddenSanitized: result.audit.forbiddenSanitized,
    hookHeadline: result.podcast.hook.headline,
    elapsedMs,
    skipped: false,
  }
}
