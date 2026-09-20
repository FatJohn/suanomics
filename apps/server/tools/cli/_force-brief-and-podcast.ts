#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
// Cold-start drill：一鍵重跑指定日期的 brief + podcast、繞過 job runner 與 audit cache。
// 用於早晨 cold-start drill、或 audit cache 撞 stale resultRef 卡死時。
//
// 用法（位置參數、不用 --date flag、避開 pnpm `--` separator 問題）：
//   pnpm --filter server exec tsx --env-file-if-exists=.env tools/cli/_force-brief-and-podcast.ts 2026-04-30
//   pnpm --filter server exec tsx --env-file-if-exists=.env tools/cli/_force-brief-and-podcast.ts 2026-04-30 --wipe
//
// --wipe（optional）：先 truncate background_jobs（audit cache bust）+ DELETE daily_briefs 整表
//   不加 --wipe：只清 background_jobs（保留歷史 daily_briefs row、目標 date 走 upsert）

import type { MarketBrief } from '@suanomics/shared'
import type { RunMetadata } from '../../src/agents/orchestrator.js'
import process from 'node:process'
import { getDb } from '@suanomics/db/client'
import { getRecentNewsItems, saveDailyBrief } from '@suanomics/db/repos/news-repo'
import { backgroundJobs, dailyBriefs } from '@suanomics/db/schema'
import { MarketBriefSchema } from '@suanomics/shared'
import { eq, sql } from 'drizzle-orm'
import { runDailyBrief } from '../../src/agents/orchestrator.js'
import { callPodcastWriter } from '../../src/agents/podcast-writer.js'

interface CliArgs {
  date: string
  wipe: boolean
}

function parseArgs(argv: readonly string[]): CliArgs {
  let date: string | null = null
  let wipe = false
  for (const a of argv) {
    if (a === '--wipe')
      wipe = true
    else if (/^\d{4}-\d{2}-\d{2}$/.test(a))
      date = a
  }
  if (!date) {
    console.error('Usage: tsx tools/cli/_force-brief-and-podcast.ts YYYY-MM-DD [--wipe]')
    process.exit(2)
  }
  return { date, wipe }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const db = getDb()

  console.log(`[force] target date: ${args.date}, wipe: ${args.wipe}`)

  // 清掉 background_jobs（audit cache bust）
  // Producer 的 findRecentCompleted 24h short-circuit 會撞到 stale resultRef、導致 brief:generate 直接 already-completed 不跑
  console.log('[force] truncating background_jobs (audit cache bust)...')
  await db.execute(sql`TRUNCATE TABLE background_jobs`)

  if (args.wipe) {
    console.log('[force] --wipe: deleting all daily_briefs rows...')
    await db.execute(sql`DELETE FROM daily_briefs`)
  }
  else {
    console.log(`[force] preserving existing daily_briefs (target ${args.date} will upsert)`)
  }

  // load recent news + run multi-agent pipeline
  console.log('[force] loading 8 recent news items...')
  const news = await getRecentNewsItems(7, 8)
  console.log(`[force] news count: ${news.length}`)
  if (news.length < 2) {
    console.error('[force] not enough news in DB (need ≥ 2)')
    process.exit(1)
  }

  const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
  const briefStart = Date.now()
  const brief = await runDailyBrief({
    news: news.map(n => ({ id: String(n.id), title: n.title, url: n.url, text: n.contentText ?? n.title, publishedAt: null })),
    date: args.date,
    metadata,
  })
  const briefMs = Date.now() - briefStart
  console.log(`[force] runDailyBrief done in ${briefMs}ms cost=$${metadata.totalCostUsd.toFixed(4)}`)
  console.log(`[force] headline: ${brief.headline}`)
  console.log(`[force] narrative.sections: ${brief.narrative?.sections?.length ?? 0}`)
  console.log(`[force] cascadeChains: ${brief.cascadeChains?.length ?? 0}`)

  // persist brief
  const id = await saveDailyBrief(
    args.date,
    news.map(n => n.id),
    `${brief.headline}. ${brief.summary.slice(0, 200)}`,
    brief,
  )
  console.log(`[force] saved daily_briefs row id: ${id}`)

  // podcast generate（讀 row、validate、call writer、UPDATE podcast_json）
  // 不能直接用 brief object — 需要從 DB 讀回確保 schema-validated 的 narrative shape
  const rows = await db
    .select({ briefJson: dailyBriefs.briefJson })
    .from(dailyBriefs)
    .where(eq(dailyBriefs.briefDate, args.date))
    .limit(1)
  const row = rows[0]
  if (!row?.briefJson) {
    console.error('[force] saved brief but cannot re-read briefJson from DB')
    process.exit(1)
  }
  const validatedBrief = MarketBriefSchema.parse(row.briefJson) as MarketBrief
  if (!validatedBrief.narrative) {
    console.error('[force] briefJson.narrative is null after save')
    process.exit(1)
  }

  console.log('[force] generating podcast...')
  const podcastStart = Date.now()
  const podcastResult = await callPodcastWriter({ briefDate: args.date, brief: validatedBrief })
  const podcastMs = Date.now() - podcastStart

  if (!podcastResult.podcast || podcastResult.audit.failed) {
    console.error(`[force] podcast FAIL in ${podcastMs}ms retryReason=${podcastResult.audit.retryReason}`)
    process.exit(1)
  }

  await db
    .update(dailyBriefs)
    .set({ podcastJson: podcastResult.podcast as unknown })
    .where(eq(dailyBriefs.briefDate, args.date))

  console.log(`[force] podcast saved in ${podcastMs}ms`)
  console.log(`[force]   totalChars: ${podcastResult.podcast.meta.totalChars}`)
  console.log(`[force]   acts: ${podcastResult.podcast.acts.length}`)
  console.log(`[force]   storylines: ${podcastResult.podcast.acts.map(a => a.storyline).join(', ')}`)
  console.log(`[force]   forbiddenSanitized: ${podcastResult.audit.forbiddenSanitized}`)
  console.log(`[force]   hook: ${podcastResult.podcast.hook.headline}`)

  console.log(`\n[force] DONE — total ${(briefMs + podcastMs) / 1000}s, cost ~$${(metadata.totalCostUsd + 0.005).toFixed(4)}`)
  console.log(`[force] verify: GET {your API host}/api/brief/by-date/${args.date}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[force] uncaught error:', err)
  process.exit(1)
})

// suppress unused-import warning under noUnusedLocals
void backgroundJobs
