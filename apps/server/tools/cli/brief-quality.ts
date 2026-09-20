#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging */
import type { MarketBrief } from '@suanomics/shared'
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { DimWinner } from '../eval/pairwise.js'
import type { QualitySourceArticle } from '../eval/quality-input.js'
import type { CompareReportMeta } from '../eval/quality-report.js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process, { exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { getExternalArticlesByUrls } from '@suanomics/db/repos/articles-repo'
import { getDailyBriefByDate, getNewsItemsByIds, getNewsItemsByUrls } from '@suanomics/db/repos/news-repo'
import { Command } from 'commander'
import { resolveAgentModel } from '../../src/agents/providers/resolve.js'
import { loadMarketContext } from '../../src/market-data/context.js'
import { formatAsOfNotice, loadHistoricalSeriesAsOf } from '../../src/market-data/historical-asof.js'
import { isValidEvalDate } from '../eval/date.js'
import { loadBrief } from '../eval/load-brief.js'
import { normalizeSourceItems } from '../eval/quality-input.js'
import { runQualityCompare } from '../eval/quality-judge.js'
import { buildCompareReport } from '../eval/quality-report.js'
import { collectBriefNewsRefs, snapshotSourceArticle } from '../eval/quality-source-base.js'
import { appendTrendRow } from '../eval/trend-log.js'

const OUT_DIR = '.eval-out'

interface CompareOpts { a: string, b: string, date?: string, sources?: string, labelA: string, labelB: string, trend?: string }

export interface SourceBaseResult { sources: QualitySourceArticle[], summary: string }

interface DateSourceBase { newsSources: QualitySourceArticle[], newsSummary: string }

// `--date` 分支抽成獨立函式：兩臂引用新聞（news_items ∪ corpus fallback，見下方
// buildSourceBase 頭部「底本組成規則」）∪ 當日選稿。獨立出來單純是把 buildSourceBase
// 本身壓回 eslint 的 80 行警告門檻內，邏輯未變。
async function resolveDateSourceBase(briefA: MarketBrief, briefB: MarketBrief, date: string): Promise<DateSourceBase> {
  const refs = collectBriefNewsRefs([briefA, briefB])
  const [byId, newsByUrl] = await Promise.all([
    getNewsItemsByIds(refs.ids),
    getNewsItemsByUrls(refs.urls),
  ])

  // citation URL 沒命中 news_items 的，去 corpus（external_articles）撈——Cascade
  // 檢索用的來源不在 news_items，原本落空的引用會讓 judge 誤判虛構。
  const newsUrlSet = new Set(newsByUrl.map(n => n.url))
  const missingUrls = refs.urls.filter(u => !newsUrlSet.has(u))
  const corpusByUrl = await getExternalArticlesByUrls(missingUrls)
  const corpusUrlSet = new Set(corpusByUrl.map(c => c.url))
  const unmatchedUrls = missingUrls.filter(u => !corpusUrlSet.has(u))

  const seenIds = new Set<number>()
  const seenUrls = new Set<string>()
  const armArticles: QualitySourceArticle[] = []
  for (const n of [...byId, ...newsByUrl]) {
    if (seenIds.has(n.id))
      continue
    seenIds.add(n.id)
    seenUrls.add(n.url)
    armArticles.push({ title: n.title, text: n.contentText ?? n.title })
  }
  // corpus 側的 id 是 uuid，跟 news_items 的數字 id 不同 namespace，不能拿 id 互比，
  // 一律用 url 去重（同一篇有可能已經被 news_items 那側收過）。
  for (const c of corpusByUrl) {
    if (seenUrls.has(c.url))
      continue
    seenUrls.add(c.url)
    armArticles.push({ title: c.title, text: c.text })
  }

  const row = await getDailyBriefByDate(date)
  let dailyOnly: QualitySourceArticle[] = []
  if (row) {
    const dailyRows = await getNewsItemsByIds(row.selectedNewsIds)
    dailyOnly = dailyRows
      .filter(n => !seenIds.has(n.id))
      .map((n) => {
        seenIds.add(n.id)
        return { title: n.title, text: n.contentText ?? n.title }
      })
  }
  else {
    console.warn(`[brief-quality] 找不到 ${date} 的 brief、僅用兩臂引用的新聞當事實底本`)
  }

  if (unmatchedUrls.length > 0) {
    console.warn(`[brief-quality] citation URL 有 ${unmatchedUrls.length} 筆在 news_items 與 external_articles 都查不到、judge 看不到這些引用（前 3 筆）：`, unmatchedUrls.slice(0, 3))
  }

  const newsSources = [...armArticles, ...dailyOnly]
  const newsSummary = `新聞 ${newsSources.length} 則（brief 引用 ${armArticles.length}：id 命中 ${byId.length} ＋ citation URL ${refs.urls.length} 之中 news ${newsByUrl.length}／corpus ${corpusByUrl.length}、未命中 ${unmatchedUrls.length}；當日選稿 ${dailyOnly.length}）`

  return { newsSources, newsSummary }
}

// 事實底本組裝抽成獨立、可單獨呼叫的函式——CLI 只是它的呼叫端，煙霧測試/未來
// 想從別的入口重跑底本組裝時不必經過 commander。
//
// 底本組成規則：
// - `date` 給了：新聞底本＝兩臂各自引用過的新聞（newsTitlesById＋citations，見
//   collectBriefNewsRefs）∪ 當日 daily_briefs.selectedNewsIds 撈到的新聞，三者去重；
//   citations 的 URL 若不在 news_items（Cascade 的 corpus 來源），改查
//   external_articles；市場快照另外附加在底本最後一則。
// - `sourcesPath` 同時給：新聞底本改用檔案內容（取代上面 DB 撈到的），市場快照仍附加。
// - 只有 `sourcesPath`：維持舊行為，純檔案、不查 DB、不附加快照。
// - 都沒給：空底本。
export async function buildSourceBase(opts: {
  briefA: MarketBrief
  briefB: MarketBrief
  date?: string | undefined
  sourcesPath?: string | undefined
}): Promise<SourceBaseResult> {
  let newsSources: QualitySourceArticle[] = []
  let newsSummary = ''

  if (opts.sourcesPath !== undefined) {
    const fileSources = normalizeSourceItems(JSON.parse(readFileSync(opts.sourcesPath, 'utf8')) as unknown)
    if (fileSources.length === 0)
      console.warn(`[brief-quality] --sources ${opts.sourcesPath} 解析不到任何新聞、grounding 將無新聞事實底本可比對`)
    newsSources = fileSources
    newsSummary = `新聞 ${fileSources.length} 則（--sources 檔案）`
  }
  else if (opts.date !== undefined) {
    const result = await resolveDateSourceBase(opts.briefA, opts.briefB, opts.date)
    newsSources = result.newsSources
    newsSummary = result.newsSummary
  }

  let sources = newsSources
  let snapshotSummary = ''
  if (opts.date !== undefined) {
    try {
      // --date 補跑歷史日期時，快照的 as-of 要重建自原版 brief 的 dataFreshness——
      // 沒有底本就照舊繼續（不硬失敗），但摘要那行要老實說快照可能含報告日之後才抓到的資料，
      // 讓看報告的人知道這次 grounding 比較有多可信。
      //
      // ★ 這段要在 try 內：它會打 DB，而 `--date` ＋ `--sources` 這條路的新聞底本來自檔案、
      //   本來不查 DB。放在 try 外時 DB 一掛就讓整個 buildSourceBase 拋、比較全部作廢，而
      //   同樣情況下舊版只是把快照降級成「0 則（載入失敗）」、照常比完（2026-09-08 驗收實跑）。
      const historicalAsOf = await loadHistoricalSeriesAsOf(opts.date)
      const notice = formatAsOfNotice(opts.date, historicalAsOf)
      if (historicalAsOf)
        console.log(notice)
      else
        console.warn(notice)
      const asOfLabel = historicalAsOf
        ? `as-of 重建自原版 brief、${historicalAsOf.covered.length}/${historicalAsOf.covered.length + historicalAsOf.missing.length} 序列、僅日期`
        : 'as-of 未重建、可能含報告日之後的資料'

      const ctx = await loadMarketContext({
        reportDate: opts.date,
        ...(historicalAsOf ? { seriesAsOf: historicalAsOf.seriesAsOf } : {}),
      })
      const snapshot = snapshotSourceArticle(opts.date, ctx.snapshotBlock)
      if (snapshot) {
        sources = [...sources, snapshot]
        snapshotSummary = `＋ 市場快照 1 則（${asOfLabel}）`
      }
      else {
        snapshotSummary = `＋ 市場快照 0 則（${asOfLabel}）`
      }
    }
    catch (err) {
      console.warn('[brief-quality] 市場數據快照載入失敗、grounding 底本不含市場數字：', err)
      snapshotSummary = '＋ 市場快照 0 則（載入失敗）'
    }
  }

  const isEmpty = newsSummary === '' && snapshotSummary === ''
  if (isEmpty) {
    // --date 與 --sources 都沒給時，grounding 這一維完全沒有底本可比對——
    // 舊版只用 console.log 印「無」，容易被一片正常輸出淹沒、沒人注意到 grounding
    // 判定其實不可信。
    console.warn('[brief-quality] 事實底本為空（--date 與 --sources 皆未提供）：grounding 維度沒有底本可比對、其判定不可信')
  }
  const summary = isEmpty ? '無' : `${newsSummary}${snapshotSummary}`

  return { sources, summary: `[brief-quality] 事實底本：${summary}` }
}

async function runCompare(opts: CompareOpts): Promise<void> {
  const briefA = loadBrief(opts.a)
  const briefB = loadBrief(opts.b)

  if (opts.date !== undefined && !isValidEvalDate(opts.date)) {
    console.error(`--date 格式錯誤（需 YYYY-MM-DD）：${opts.date}`)
    exit(1)
  }

  const { sources, summary } = await buildSourceBase({ briefA, briefB, date: opts.date, sourcesPath: opts.sources })
  console.log(summary)

  const { model } = resolveAgentModel('brief-quality-judge')

  let tokensIn = 0
  let tokensOut = 0
  let costUsd = 0
  const onCallRecord = (r: LlmCallRecord): void => {
    tokensIn += r.tokensIn
    tokensOut += r.tokensOut
    costUsd += r.costUsd
  }

  const result = await runQualityCompare({ briefA, briefB, sources, onCallRecord })

  const meta: CompareReportMeta = {
    labelA: opts.labelA,
    labelB: opts.labelB,
    model,
    tokensIn,
    tokensOut,
    costUsd,
    sourceCount: sources.length,
  }
  const markdown = buildCompareReport(result, meta)

  const outDir = resolve(OUT_DIR)
  mkdirSync(outDir, { recursive: true })
  const outPath = resolve(outDir, `compare-${opts.labelA}-vs-${opts.labelB}.md`)
  writeFileSync(outPath, markdown, 'utf8')

  console.log(outPath)
  console.log(`深度勝方=${result.depth.winner} 可讀=${result.readability.winner} grounding=${result.grounding.winner}`)
  console.log(`judge cost：$${costUsd.toFixed(4)}（in ${tokensIn} / out ${tokensOut}）`)

  if (opts.trend !== undefined) {
    const w = (x: DimWinner): string => (x === 'A' ? opts.labelA : x === 'B' ? opts.labelB : 'tie')
    await appendTrendRow(opts.trend, {
      date: new Date().toISOString().slice(0, 10),
      tool: 'quality',
      label: `${opts.labelA} vs ${opts.labelB}`,
      verdict: `深度:${w(result.depth.winner)} 可讀:${w(result.readability.winner)} grounding:${w(result.grounding.winner)}`,
      cost: costUsd,
    })
    console.log(`已記趨勢：${opts.trend}`)
  }
}

// buildSourceBase 是可單獨 import 的純呼叫端（見上）；下面的 commander 設定與
// parseAsync 只在「這支檔案被直接執行」時才跑，否則單純 import（例如煙霧測試腳本
// 想重用 buildSourceBase）也會因為 process.argv 缺 -a/-b 而在 import 當下就噴錯退出。
const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  const program = new Command()
  program
    .name('brief-quality')
    .description('Pairwise-compare two brief versions on depth / readability / grounding')
    .requiredOption('-a, --a <path>', 'brief A JSON 檔路徑')
    .requiredOption('-b, --b <path>', 'brief B JSON 檔路徑')
    .option('-d, --date <YYYY-MM-DD>', '事實底本（grounding）：撈本機 DB 該日兩臂各自引用過的新聞＋當日選稿＋市場數據快照')
    .option('-s, --sources <path>', '新聞事實底本改餵原始新聞 JSON（news-item 陣列或 { items:[...] }）、取代 --date 撈到的新聞（市場快照仍照 --date 附加，若有給）')
    .option('--labelA <label>', 'A 的標籤', 'A')
    .option('--labelB <label>', 'B 的標籤', 'B')
    .option('--trend <path>', '將本次三維勝負摘要 append 到趨勢日誌（如品質趨勢日誌）')
    .action((opts: CompareOpts) => runCompare(opts).then(() => exit(0)).catch((err: Error) => {
      console.error(err.stack ?? err.message)
      exit(1)
    }))

  program.parseAsync(process.argv).catch((err: Error) => {
    console.error(err.stack ?? err.message)
    exit(1)
  })
}
