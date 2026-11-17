// 本機單篇分析，不寫 DB（含 llm_calls 帳本）：
//   pnpm --filter @suanomics/pipeline run analyze --url <url>
//   pnpm --filter @suanomics/pipeline run analyze --text <內文> [--title <標題>]
// 需要 ANTHROPIC_API_KEY 與 DAILY_COST_LIMIT_USD（本次執行的花費上限）。
// 有 DATABASE_URL 時從 external_articles 檢索佐證來源（只讀），沒有時只能引用輸入的網址。
import type { AnalyzeArgs } from './args.js'
import type { SingleNewsInput } from './run.js'
import process from 'node:process'
import { taipeiDateOf } from '@suanomics/shared'
import { DailyCostGate, installDailyCostGate, parseDailyCostLimit } from '../agents/cost-gate.js'
import { closeDb } from '../db/client.js'
import { extractReadableText } from '../ingest/external/article-extract.js'
import { scrapeArticle } from '../ingest/external/scraper.js'
import { parseAnalyzeArgs } from './args.js'
import { findComplianceViolations, renderAnalysisMarkdown, sanitizeAnalysis, titleFromHtml, titleFromText } from './render.js'
import { analyzeSingleNews } from './run.js'

async function loadInput(args: AnalyzeArgs): Promise<SingleNewsInput> {
  if (args.source === 'text')
    return { title: args.title ?? titleFromText(args.text), text: args.text }
  let pageTitle: string | null = null
  const scraped = await scrapeArticle(args.url, {
    extract: (html) => {
      pageTitle = titleFromHtml(html)
      return extractReadableText(html)
    },
  })
  if (!scraped.ok)
    throw new Error(`抓取 ${args.url} 失敗：${scraped.reason}（${scraped.detail}）`)
  if (scraped.text === null)
    throw new Error(`${args.url} 抽不出正文，改用 --text 貼上內文`)
  return { title: args.title ?? pageTitle ?? titleFromText(scraped.text), text: scraped.text, url: args.url }
}

async function main(): Promise<void> {
  const args = parseAnalyzeArgs(process.argv.slice(2))
  const gate = new DailyCostGate(parseDailyCostLimit(process.env.DAILY_COST_LIMIT_USD))
  installDailyCostGate(gate)
  if (!process.env.DATABASE_URL)
    console.warn('[analyze] 未設定 DATABASE_URL，略過檢索，只能引用輸入的網址')
  const input = await loadInput(args)
  const date = taipeiDateOf(new Date())
  try {
    const analysis = sanitizeAnalysis(await analyzeSingleNews(input, date))
    const markdown = renderAnalysisMarkdown({ title: input.title, ...(input.url !== undefined ? { url: input.url } : {}), date, analysis, costUsd: gate.totalUsd, calls: gate.callCount })
    const violations = findComplianceViolations(markdown)
    if (violations.length > 0) {
      console.error(`[analyze] 合規檢查未通過，不輸出：\n${violations.join('\n')}`)
      process.exitCode = 1
      return
    }
    process.stdout.write(markdown)
  }
  catch (err) {
    console.error(`[analyze] 失敗，已花費 US$${gate.totalUsd.toFixed(4)}（${gate.callCount} 次 LLM 呼叫）`)
    throw err
  }
}

main()
  .catch((err: unknown) => {
    console.error('[analyze] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
