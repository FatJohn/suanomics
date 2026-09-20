/* eslint-disable no-console -- worker progress logging, structured logger TBD */
import type { RunMetadata } from '../../src/agents/orchestrator.js'
import process from 'node:process'
import { getDb } from '@suanomics/db/client'
import { getRecentNewsItems } from '@suanomics/db/repos/news-repo'
import { taipeiDateOf } from '@suanomics/shared'
import { sql } from 'drizzle-orm'
// local smoke: directly call runDailyBrief with local DB news (skip the job runner)
// 用法: pnpm --filter server exec tsx --env-file=.env tools/cli/_brief-local-smoke.ts
// 不寫 DB、純 in-memory 印 narrative + cascadeChains 結果
import { runDailyBrief } from '../../src/agents/orchestrator.js'

// ★ 報告日必須是**真實的今天**（台北），不能是哨兵值。這支上面把 news_items 的
//   fetched_at 撞成 NOW，而報告日現在是承載值：retriever 的檢索窗上界錨在它、
//   序列快照與行事曆也是。用 '2099-01-01' 這種哨兵時窗會落在 2098-12-25 ~ 2099-01-01，
//   external_articles 一筆都撈不到——brief 照樣成稿、citations 永遠 0，而底下
//   「unknown citations」與「forbidden hits」兩個檢查跟著變成空話、不會失敗。
//   （2026-09-07 實測：那個窗 0 筆，全表 21,534 筆、近 7 天 743 筆。）
const REPORT_DATE = taipeiDateOf(new Date())

async function main() {
  const db = getDb()
  // 暫時把所有 news_items 的 fetched_at 更新成 NOW、讓 getRecentNewsItems(7, 8) 抓得到
  // 不會永久動 DB（事後 reset 可以從 publishedAt 回填）
  console.log('[smoke] bumping news_items.fetched_at to NOW for 8 most-recently-published items...')
  const updated = await db.execute(sql`
    UPDATE news_items
    SET fetched_at = NOW()
    WHERE id IN (
      SELECT id FROM news_items ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 8
    )
    RETURNING id, title
  `)
  console.log(`[smoke] bumped ${(updated as { rows?: unknown[] }).rows?.length ?? 0} news_items`)

  const news = await getRecentNewsItems(7, 8)
  console.log(`[smoke] selected ${news.length} news items:`)
  for (const n of news) console.log(`  - id=${n.id}: ${n.title.slice(0, 50)}`)
  console.log('')

  if (news.length < 2) {
    console.error('[smoke] not enough news to run brief')
    process.exit(1)
  }

  const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
  const start = Date.now()
  const brief = await runDailyBrief({
    news: news.map(n => ({ id: String(n.id), title: n.title, url: n.url, text: n.contentText ?? n.title, publishedAt: null })),
    date: REPORT_DATE,
    metadata,
  })
  const elapsed = Date.now() - start
  console.log(`\n[smoke] runDailyBrief completed in ${elapsed}ms`)
  console.log(`[smoke] llmCalls: ${metadata.llmCalls.length}, totalCost: $${metadata.totalCostUsd.toFixed(4)}`)
  console.log('')
  console.log(`headline: ${brief.headline}`)
  console.log(`summary: ${brief.summary.slice(0, 100)}...`)
  console.log(`citations: ${brief.citations.length}`)
  console.log(`cascadeChains: ${brief.cascadeChains?.length ?? 0}`)
  console.log(`newsTitlesById entries: ${Object.keys(brief.newsTitlesById ?? {}).length}`)
  console.log('')

  if (brief.narrative) {
    const n = brief.narrative
    const total = n.intro.length + n.sections.reduce((a, s) => a + s.body.length, 0) + n.outro.length
    console.log(`narrative: PRESENT (${total} chars)`)
    console.log(`  intro: ${n.intro.length}, outro: ${n.outro.length}, sections: ${n.sections.length}`)
    console.log(`  body chars: ${n.sections.map(s => s.body.length).join(',')}`)
    const validUrls = new Set(brief.citations.map(c => c.url))
    const unknown = n.sections.flatMap(s => s.citationUrls).filter(u => !validUrls.has(u))
    console.log(`  unknown citations: ${unknown.length} ${unknown.length > 0 ? unknown : ''}`)
    const FORBIDDEN = ['看多', '看空', '加碼時機', '報明牌', '飆漲', '強勢突破', '強烈買進', '強烈賣出']
    const fullText = [n.intro, ...n.sections.map(s => s.body), n.outro].join('\n')
    const forbiddenHits = FORBIDDEN.filter(p => fullText.includes(p))
    console.log(`  forbidden hits: ${forbiddenHits.length} ${forbiddenHits}`)
    // 閾值與 narrative-smoke.ts 的三態（1500-2500 PASS／1200-3000 WARN）刻意不同：
    // 這裡跑的是全 pipeline 產出、段數與長度變異更大，故上限放寬到 3500。兩邊都不是硬
    // gate——真正的把關是 NarrativeSchema（intro/outro ≤320、body ≤800、≤4 段）。
    console.log(`  N1 字數 ${total >= 1500 && total <= 3500 ? 'PASS' : 'FAIL'} (${total})`)
  }
  else {
    console.log(`narrative: NULL (graceful degrade)`)
    // 看 metadata 找 narrativeFailed audit
    const narrativeAudits = metadata.llmCalls.filter(r => r.agentName === 'narrative-writer')
    console.log(`narrative llmCalls: ${narrativeAudits.length}`)
    for (const r of narrativeAudits) {
      console.log(`  agent=${r.agentName} attempts=${r.attempts} tokens=${r.tokensIn}/${r.tokensOut} failed=${r.narrativeFailed} reason=${r.narrativeRetryReason}`)
    }
  }

  process.exit(0)
}

main().catch((e) => {
  // 避免 Node inspect 撞 drizzle error 的 weird property descriptor
  const err = e as Error
  console.error('[smoke] error message:', err?.message ?? String(e))
  console.error('[smoke] error name:', err?.name ?? '(no name)')
  if (err?.stack)
    console.error(`[smoke] stack:\n${err.stack}`)
  // 嘗試印 cause / 其他常見 props
  const cause = (err as { cause?: unknown })?.cause
  if (cause)
    console.error('[smoke] cause:', String(cause))
  process.exit(1)
})
