/* eslint-disable no-console -- smoke script：輸出就是產物，判讀由人做 */
/**
 * analyst-tier1 claim 產出率的量測。
 *
 *   cd apps/server && pnpm claim:yield                    # 兩臂全跑（34 則真新聞）
 *   cd apps/server && pnpm claim:yield --limit 2          # 每個日期只取 2 則（先試水溫）
 *   cd apps/server && pnpm claim:yield --dates 2026-07-26
 *
 * **這次的產物不是功能，是數字。** 有一題刻意沒決定：`fact` claim 缺
 * evidence 時那句話怎麼處置（降級／刪句／整份 gate）——而三個選項哪個對完全取決於實際
 * grounding 率：95% 的話選哪個都無所謂，60% 的話「降級」會讓報告變成一片「可能」。
 *
 * 兩臂的意義不同，別混為一談：
 * - 臂 A（flag 開）給六項數字。
 * - 臂 B（flag 關）＝今日 prod 行為，只作為 mechanism／primaryImpact 的**回退對照**。
 *   兩臂輸入完全相同、只差 flag，所以 prose 的差異才歸因得到這次改動。
 *   臂 B 不產 claim，拿它算任何 claim 指標都是錯的。
 *
 * decomposer 每則只跑一次、兩臂共用：它的 prompt 這次沒動，各跑一次只會多花錢並
 * 引入一個與 flag 無關的變異來源。
 */
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { AnalystOutput, DecomposerOutput, RetrievedArticle } from '../../src/agents/types.js'
import type { CanarySource } from '../eval/canary-fixtures.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { claimsAutoAttachStats, claimsRejectedTotal, resetClaimsAutoAttachStats, resetClaimsRejectedTotal } from '../../src/agents/analyst-claims.js'
import { callAnalystTier1 } from '../../src/agents/analyst-tier1.js'
import { callDecomposer } from '../../src/agents/decomposer.js'
import { resolveAgentModel } from '../../src/agents/providers/resolve.js'
import { buildSnapshotBlock, selectCitableSeries, selectSeriesAnchors } from '../../src/market-data/snapshot.js'
import { canaryExampleBanner, canaryExampleNotice, listCanaryDates, loadCanarySources } from '../eval/canary-fixtures.js'
import { emptyMetrics, LATEST, measure, NOW, renderMetrics, SNAPSHOT_REPORT_DATE } from '../eval/claim-metrics.js'
import { freeOutPath, outPathFor, warnIfOutPathTaken } from './lib/claim-yield-output-path.js'
import { enforceLlmRunBudget, hasYesFlag } from './lib/llm-run-budget.js'
import { estimateClaimYieldSmoke } from './lib/llm-run-estimates.js'
import { argValue, parseDateList, parseLimitOrExit, requireGeminiKeyOrExit } from './lib/smoke-args.js'

const HERE = dirname(fileURLToPath(import.meta.url))
// 量測輸出落在 .eval-out/（已 gitignore、與其他 eval CLI 同一個落地點）。
const OUT_DIR = resolve(HERE, '../../.eval-out')

function toRetrieved(s: CanarySource): RetrievedArticle {
  return {
    id: String(s.id),
    url: s.url,
    title: s.title,
    // pipeline 餵的是 contentSummary（另一個 agent 產的摘要）；這批 fixture 沒有該欄位，
    // 用截斷內文近似。差異只影響 prompt 長度，不影響 url 的真假（D2 量的是那個）。
    contentSummary: s.contentText.slice(0, 600),
    entities: [],
    topicTags: s.topicTags ?? [],
    fetchedAt: s.publishedAt,
  }
}

const limit = parseLimitOrExit(argValue('--limit'))
const onlyDates = parseDateList(argValue('--dates'))

let costUsd = 0
let tokensIn = 0
let tokensOut = 0
let calls = 0
/** 逐則失敗清單。**一定要進報告**——靜默跳過會讓「34 則」被讀成全樣本實測。 */
const failures: string[] = []
function onCall(r: LlmCallRecord): void {
  costUsd += r.costUsd
  tokensIn += r.tokensIn
  tokensOut += r.tokensOut
  calls++
}

async function runTier1(
  source: CanarySource,
  decomposed: DecomposerOutput,
  siblings: CanarySource[],
  marketSnapshot: string | null,
  briefDate: string,
): Promise<AnalystOutput> {
  return callAnalystTier1({
    newsTitle: source.title,
    newsText: source.contentText,
    newsId: String(source.id),
    newsUrl: source.url,
    publishedAt: source.publishedAt,
    briefDate,
    decomposed,
    retrieved: siblings.filter(s => s.id !== source.id).map(toRetrieved),
    marketSnapshot,
    citableSeries: selectCitableSeries(LATEST, NOW, SNAPSHOT_REPORT_DATE),
    seriesAnchors: selectSeriesAnchors(LATEST, NOW, SNAPSHOT_REPORT_DATE),
    onCallRecord: onCall,
  })
}

function buildReport(started: string, dates: string[], metrics: ReturnType<typeof emptyMetrics>, prose: string[]): string {
  const tier1Model = resolveAgentModel('analyst-tier1')
  return [
    'analyst-tier1 claim 產出率量測',
    '='.repeat(64),
    `執行時間：${started} → ${new Date().toISOString()}`,
    `analyst-tier1 model：${tier1Model.provider}/${tier1Model.model}`,
    `decomposer model：${resolveAgentModel('decomposer').model}`,
    `樣本：canary fixtures ${dates.join('、')}｜實測 ${metrics.news} 則${limit > 0 ? `（--limit ${limit}）` : ''}`,
    `失敗跳過：${failures.length} 則${failures.length > 0 ? `\n${failures.map(f => `  - ${f}`).join('\n')}` : '（無）'}`,
    `LLM call 筆數：${calls}｜tokens in/out：${tokensIn}/${tokensOut}｜cost：$${costUsd.toFixed(4)}`,
    `claim safeParse 淘汰數：${claimsRejectedTotal()}`,
    `auto-attach：補上 ${claimsAutoAttachStats().refs} 個 series ref、`
    + `其中讓 ${claimsAutoAttachStats().groundedFactClaims} 條原本零 ref 的 fact claim 變成有 ref、`
    + `歧義放棄 ${claimsAutoAttachStats().ambiguous} 個數字`,
    '★怎麼讀 D1：上面那個 fact 數字就是「機器補的 grounding」。【4】的 D2/D3 淘汰數若為 0，'
    + '「D1 分子 − 該數字」就是模型自己的 grounding；若不為 0，被淘汰後再由 auto-attach 救回的 '
    + 'claim 不在該計數內，減法會少扣，模型自己的 grounding 只是上界。',
    'LLM call 筆數若超過「新聞則數 × 3」代表有 fabrication retry——被丟棄的 attempt 也會累加進 '
    + '上面的 auto-attach 與 safeParse 計數（模組層計數器不隨 retry 回溯）。',
    '',
    '臂 A＝ANALYST_CLAIMS_ENABLED=true；臂 B＝關閉（今日 prod 行為，只作 prose 對照）。',
    '下列所有 claim 指標都只出自臂 A。',
    '',
    ...renderMetrics(metrics),
    '',
    '這份量測不能證明什麼',
    '-'.repeat(64),
    '- 不能證明 claim 的語意正確：D1–D7 全是機械檢查，因果對不對要另外驗證。',
    '- 序列是固定 fixture、不是 canary 那幾天的真實行情，且新聞講的是別天的行情',
    '  → 模型引用序列的動機低於真實 pipeline，series ref 產出率是下限。',
    '- citation 池不含 tier2 chains（prod 的 orchestrator 會把它們併進同一個 output）',
    '  → prod 的池是這裡的超集，故 D2 淘汰率是上限、D4 通過率是下限。',
    `- 樣本是 ${dates.length} 天的 canary、${metrics.news} 則，給的是量級（60% 還是 95%），不是 prod 的精確 grounding 率。`,
    '',
    '臂 A／臂 B prose 逐則對照（判 mechanism 是否因為要湊 claim 而變空洞）',
    '='.repeat(64),
    ...prose,
  ].join('\n')
}

async function main(): Promise<void> {
  const notice = canaryExampleNotice()
  if (notice !== null)
    console.warn(notice)
  requireGeminiKeyOrExit('pnpm claim:yield（會吃 apps/server/.env）')

  // 開跑前就講清楚結果會寫到哪、會不會撞名——這一跑要 45 分鐘與約 $2.7。
  warnIfOutPathTaken(outPathFor(OUT_DIR, new Date()))

  resetClaimsRejectedTotal()
  resetClaimsAutoAttachStats()
  const available = listCanaryDates()
  const dates = (onlyDates ?? available).filter(d => available.includes(d))

  // 花錢之前先估總則數（套用 --limit 之後的真實則數，不是 fixture 原始則數）；
  // 主迴圈稍後會再 loadCanarySources 一次，重複 I/O 但零 LLM 呼叫。
  const newsCount = dates.reduce((sum, d) => {
    const all = loadCanarySources(d)
    return sum + (limit > 0 ? Math.min(limit, all.length) : all.length)
  }, 0)
  enforceLlmRunBudget(estimateClaimYieldSmoke(newsCount), {
    confirmed: hasYesFlag(process.argv.slice(2)),
    errLog: line => console.error(line),
    exit: process.exit,
  })

  const marketSnapshot = buildSnapshotBlock(LATEST, NOW, SNAPSHOT_REPORT_DATE)
  const started = new Date().toISOString()
  const armA = emptyMetrics()
  const prose: string[] = []

  for (const date of dates) {
    const all = loadCanarySources(date)
    const sources = limit > 0 ? all.slice(0, limit) : all
    console.log(`\n=== ${date}：${sources.length}/${all.length} 則 ===`)

    const outputsA: AnalystOutput[] = []
    for (const s of sources) {
      // 單則失敗不得毀掉整輪：2026-08-05 首次全量跑在第 3 則撞到 AbortError（LLM 逾時）
      // 整個 process 就倒了，40 分鐘與已跑完的樣本一起沒了。失敗改為記錄＋跳過——
      // 但**必須出現在報告裡**，否則「34 則裡實測 31 則」會被讀成全樣本。
      let a: AnalystOutput
      let b: AnalystOutput
      try {
        const decomposed = await callDecomposer({
          newsTitle: s.title,
          newsText: s.contentText,
          newsId: String(s.id),
          onCallRecord: onCall,
        })

        process.env.ANALYST_CLAIMS_ENABLED = 'true'
        a = await runTier1(s, decomposed, sources, marketSnapshot, date)
        delete process.env.ANALYST_CLAIMS_ENABLED
        b = await runTier1(s, decomposed, sources, marketSnapshot, date)
      }
      catch (err) {
        delete process.env.ANALYST_CLAIMS_ENABLED
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        failures.push(`${date} / ${s.id} / ${s.title.slice(0, 40)} → ${reason}`)
        console.warn(`  [${s.id}] 失敗、跳過：${reason}`)
        continue
      }

      outputsA.push(a)
      console.log(`  [${s.id}] ${s.title.slice(0, 26)}… chains=${a.cascadeChains.length} claims=${a.claims.length}`)

      prose.push(
        `--- ${date} / ${s.id} / ${s.title} ---`,
        `[A primaryImpact] ${a.primaryImpact}`,
        `[B primaryImpact] ${b.primaryImpact}`,
        ...a.cascadeChains.map((c, i) => `[A mechanism ${i}] ${c.industry}：${c.mechanism}`),
        ...b.cascadeChains.map((c, i) => `[B mechanism ${i}] ${c.industry}：${c.mechanism}`),
        ...a.claims.map(c => `[A claim ${c.id}] (${c.kind}/${c.claimType}) ${c.claim} ← ${JSON.stringify(c.evidenceRefs)}`),
        '',
      )
    }
    // citations 以「當日全部 output」組裝——pipeline 就是這樣組 brief.citations 的。
    measure(outputsA, armA)
  }

  // 舊的輸出目錄是 tracked 的、永遠存在，所以原本不需要建。.eval-out 是 gitignore 的，
  // 乾淨 clone 上不存在——少了這行，會在跑完整趟（約 45 分鐘、約 $2.7）之後才 ENOENT，
  // 而那正是 freeOutPath／warnIfOutPathTaken 整套設計要防的損失。
  mkdirSync(OUT_DIR, { recursive: true })
  const outPath = freeOutPath(outPathFor(OUT_DIR, new Date()))
  const banner = canaryExampleBanner()
  const report = buildReport(started, dates, armA, prose)
  writeFileSync(outPath, banner !== null ? `${banner}\n\n${report}` : report, 'utf8')
  console.log(`\n報告已寫入 ${outPath}\n`)
  console.log(renderMetrics(armA).join('\n'))
}

await main()
