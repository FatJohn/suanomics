#!/usr/bin/env tsx
/* eslint-disable no-console -- 量測腳本：輸出就是產物，判讀由人做 */
/**
 * narrative 消費 claim ledger 的 A/B ＋ traceability 量測。
 *
 *   cd apps/server && pnpm ledger:ab                      # 全部 canary 日期
 *   cd apps/server && pnpm ledger:ab --dates 2026-07-26   # 單日
 *   cd apps/server && pnpm ledger:ab --limit 3            # 每日只取 3 則（試水溫）
 *
 * **變因只有一個**：narrative 有沒有吃 ledger。所以 decomposer／analyst／synthesizer
 * 每個日期只跑一次、三臂共用同一份 brief 與同一份 ledger；`ANALYST_CLAIMS_ENABLED`
 * 全程開著（兩臂都要有 claim，否則量到的是「有沒有 claim」而不是「有沒有消費 claim」）。
 *
 * 三臂而不是兩臂：
 * - `A1` 旗標開
 * - `A2` 旗標開（同設定再跑一次）→ **同臂雜訊底線**。本 repo 有過「沒有對照組時結論
 *   方向是反的」的實例（2026-08-02 model A/B），所以 A1 vs A2 的差距先量出來，
 *   A1 vs B 的差距要大過它才有話講。
 * - `B` 旗標關（今日 prod 行為）
 *
 * 不走 job runner：brief 有當日去重，連跑兩次會拿到
 * 第一次的既有 brief、兩臂變成同一份東西而毫無察覺。
 *
 * 產物是三份 brief JSON（可直接餵 `pnpm brief:quality --a <檔> --b <檔> --sources <檔>`）
 * 加一份 traceability 報告。可讀性由那個 pairwise 工具判，本腳本不自己做主觀評分。
 */
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { AnalystOutput, DecomposerOutput, RetrievedArticle } from '../../src/agents/types.js'
import type { CanarySource } from '../eval/canary-fixtures.js'
import type { ArmResult, ReportInput } from '../eval/ledger-ab-report.js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildClaimLedger } from '@suanomics/shared'
import { callAnalystTier1 } from '../../src/agents/analyst-tier1.js'
import { callDecomposer } from '../../src/agents/decomposer.js'
import { callNarrativeWriter } from '../../src/agents/narrative-writer.js'
import { resolveAgentModel } from '../../src/agents/providers/resolve.js'
import { callSynthesizer } from '../../src/agents/synthesizer.js'
import { assembleDailyBrief } from '../../src/brief/assemble.js'
import { SERIES_SPECS } from '../../src/market-data/series-config.js'
import { buildSnapshotBlock, selectCitableSeries, selectSeriesAnchors } from '../../src/market-data/snapshot.js'
import { canaryExampleBanner, canaryExampleNotice, listCanaryDates, loadCanarySources } from '../eval/canary-fixtures.js'
import { LATEST, NOW, SNAPSHOT_REPORT_DATE } from '../eval/claim-metrics.js'
import { renderArmReport } from '../eval/ledger-ab-report.js'
import { measureRefChecks, measureTraceability } from '../eval/ledger-traceability.js'
import { buildOfficialFixtureBlock } from '../eval/official-fixture.js'
import { enforceLlmRunBudget, hasYesFlag } from './lib/llm-run-budget.js'
import { estimateNarrativeLedgerAb } from './lib/llm-run-estimates.js'
import { argValue, parseDateList, parseLimitOrExit, requireGeminiKeyOrExit } from './lib/smoke-args.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../../.eval-out/ledger-ab')

const limit = parseLimitOrExit(argValue('--limit'))
const onlyDates = parseDateList(argValue('--dates'))

let costUsd = 0
let calls = 0
function onCall(r: LlmCallRecord): void {
  costUsd += r.costUsd
  calls++
}

function toRetrieved(s: CanarySource): RetrievedArticle {
  return {
    id: String(s.id),
    url: s.url,
    title: s.title,
    contentSummary: s.contentText.slice(0, 600),
    entities: [],
    topicTags: s.topicTags ?? [],
    fetchedAt: s.publishedAt,
  }
}

async function analystFor(
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

/**
 * `--render <results.json>`：用既有資料重畫報告，不打任何 LLM。
 *
 * **輸出檔名不可由 `String.replace` 推導**：`replace` 在不匹配時原樣回傳，
 * 於是 `--render foo.json` 會把報告寫回 `foo.json`、**原地毀掉那份原始資料**，
 * 而畫面只印一行「報告：foo.json」看不出異常（2026-08-08 獨立複查實跑重現）。
 * 改成先驗檔名、不符就拒絕跑，寧可要求使用者改名也不要靜默覆蓋。
 */
function renderOnly(file: string): void {
  const m = /results-.+\.json$/.exec(file)
  if (!m) {
    console.error(`--render 的檔名必須是 results-<stamp>.json（收到：${file}）`)
    console.error('這是為了推導出 report-<stamp>.md；不符就拒跑，避免把報告寫回原始資料檔。')
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { meta: Omit<ReportInput, 'results' | 'outDir'>, results: ArmResult[] }
  const out = renderArmReport({ ...raw.meta, results: raw.results, outDir: OUT_DIR })
  const dest = file.replace(/results-(.+)\.json$/, 'report-$1.md')
  if (dest === file) {
    console.error(`推導出的輸出檔與輸入檔相同（${dest}），拒絕覆蓋。`)
    process.exit(1)
  }
  writeFileSync(dest, out)
  console.log(out)
  console.log(`\n報告：${dest}`)
}

async function main(): Promise<void> {
  const renderFile = argValue('--render')
  if (renderFile !== undefined) {
    renderOnly(renderFile)
    return
  }
  const notice = canaryExampleNotice()
  if (notice !== null)
    console.warn(notice)
  requireGeminiKeyOrExit('pnpm ledger:ab（會吃 apps/server/.env）')
  mkdirSync(OUT_DIR, { recursive: true })

  const available = listCanaryDates()
  const dates = (onlyDates ?? available).filter(d => available.includes(d))

  // 花錢之前先估——sourceCountsByDate 是「這次真的會處理幾則」（套用 --limit 之後），
  // 不是 fixture 原始則數；主迴圈稍後會再 loadCanarySources 一次，重複 I/O 但零 LLM 呼叫。
  const sourceCountsByDate = dates.map((d) => {
    const all = loadCanarySources(d)
    return limit > 0 ? Math.min(limit, all.length) : all.length
  })
  enforceLlmRunBudget(estimateNarrativeLedgerAb(sourceCountsByDate), {
    confirmed: hasYesFlag(process.argv.slice(2)),
    errLog: line => console.error(line),
    exit: process.exit,
  })

  const marketSnapshot = buildSnapshotBlock(LATEST, NOW, SNAPSHOT_REPORT_DATE)
  const started = new Date().toISOString()
  const results: ArmResult[] = []
  const failures: string[] = []

  for (const date of dates) {
    const all = loadCanarySources(date)
    const sources = limit > 0 ? all.slice(0, limit) : all
    console.log(`\n=== ${date}：${sources.length}/${all.length} 則 ===`)

    // claim 產出兩臂都要開：變因是「narrative 有沒有吃 ledger」，不是「有沒有 claim」
    process.env.ANALYST_CLAIMS_ENABLED = 'true'
    const analystOutputs: AnalystOutput[] = []
    for (const s of sources) {
      // 單則失敗不得毀掉整輪（claim-yield-smoke 踩過：第 3 則逾時、40 分鐘一起沒了），
      // 但失敗必須進報告，否則「7 則」會被讀成全樣本
      try {
        const decomposed = await callDecomposer({
          newsTitle: s.title,
          newsText: s.contentText,
          newsId: String(s.id),
          onCallRecord: onCall,
        })
        analystOutputs.push(await analystFor(s, decomposed, sources, marketSnapshot, date))
        console.log(`  [analyst] ${s.id} ok`)
      }
      catch (err) {
        failures.push(`${date}/${s.id}：${err instanceof Error ? err.message : String(err)}`)
        console.warn(`  [analyst] ${s.id} FAILED`)
      }
    }
    if (analystOutputs.length === 0) {
      failures.push(`${date}：全部 analyst 都失敗、跳過本日`)
      continue
    }

    const ledger = buildClaimLedger(analystOutputs.map(a => a.claims))
    console.log(`  [ledger] ${ledger.claims.length} claims（來源 ${ledger.sourceCount}、去重掉 ${ledger.droppedDuplicates}）`)

    const synth = await callSynthesizer({ analystOutputs, date, marketSnapshot, onCallRecord: onCall })
    const selectedNewsById = new Map(sources.map(s => [String(s.id), { title: s.title, url: s.url }] as const))
    const brief = assembleDailyBrief({
      synth,
      analystOutputs,
      selectedNewsById,
      cascadeChains: analystOutputs.flatMap(a => a.cascadeChains),
    })

    // 2026-08-28：官方公告 block 三臂都餵——變因仍然只有 ledger 旗標。加它是為了讓
    // 這支量到的 prompt 與 prod 同形；★ 副作用是**基準線移動了**，本日之前跑出來的
    // 報告不能直接跟之後的比。
    const officialBlock = buildOfficialFixtureBlock(date)

    // 三臂共用同一份 brief／ledger／news：唯一的差別是旗標
    const news = sources.map(s => ({
      id: String(s.id),
      title: s.title,
      url: s.url,
      text: s.contentText,
      publishedAt: s.publishedAt,
    }))
    for (const arm of ['A1', 'A2', 'B'] as const) {
      // 旗標在 callNarrativeWriter 內讀 env，所以同一個 process 內切換有效
      // （module-level 讀取會把第一次的值凍住、三臂看起來「沒有差異」）
      if (arm === 'B')
        delete process.env.NARRATIVE_LEDGER_ENABLED
      else
        process.env.NARRATIVE_LEDGER_ENABLED = 'true'

      const r = await callNarrativeWriter({
        brief,
        analystOutputs,
        news,
        citations: brief.citations,
        briefDate: date,
        marketSnapshot,
        officialBlock,
        claimLedger: ledger.claims,
        onCallRecord: onCall,
      })
      const armBrief = { ...brief, narrative: r.narrative ?? null, claimLedger: ledger.claims }
      const file = resolve(OUT_DIR, `${date}-${arm}.json`)
      writeFileSync(file, JSON.stringify(armBrief, null, 2))
      results.push({
        date,
        arm,
        file,
        newsCount: analystOutputs.length,
        audit: r.audit,
        sections: r.narrative?.sections.length ?? 0,
        chars: r.narrative
          ? r.narrative.intro.length + r.narrative.sections.reduce((a, s) => a + s.body.length, 0) + r.narrative.outro.length
          : 0,
        trace: measureTraceability(armBrief),
      })
      console.log(`  [${arm}] narrative ${r.narrative ? 'ok' : 'NULL'}｜claimIdsStripped=${r.audit.claimIdsStripped}｜反推 section=${r.audit.claimCitationSections}`)
    }
    delete process.env.NARRATIVE_LEDGER_ENABLED

    // D2／D3：有個可推翻條件——「若 D2／D3 開始出現非 0 的淘汰數，(c) 的論證要重來」，
    // 所以每輪都要印，不能只印 D1／D4（2026-08-08 第一版就漏了這一項）
    const refChecks = measureRefChecks(ledger.claims, {
      citations: brief.citations.map(c => ({ url: c.url, quote: c.quote })),
      seriesPoints: selectSeriesAnchors(LATEST, NOW, SNAPSHOT_REPORT_DATE),
      knownSeriesIds: SERIES_SPECS.map(sp => sp.seriesId),
      calendarDates: [],
    })
    console.log(`  [D2/D3] D2 ${refChecks.d2Passed}/${refChecks.d2Applicable}（濾掉 ${refChecks.refsDroppedD2} refs）`
      + `｜D3 ${refChecks.d3Passed}/${refChecks.d3Applicable}（濾掉 ${refChecks.refsDroppedD3} refs）`)

    // sources 檔給 brief:quality 當 grounding 底本（解耦本機 DB）
    writeFileSync(
      resolve(OUT_DIR, `${date}-sources.json`),
      JSON.stringify(sources.map(s => ({ title: s.title, text: s.contentText })), null, 2),
    )
  }

  const report = renderArmReport({
    started,
    finished: new Date().toISOString(),
    dates,
    limit,
    failures,
    calls,
    costUsd,
    narrativeModel: resolveAgentModel('narrative-writer'),
    analystModel: resolveAgentModel('analyst-tier1'),
    results,
    outDir: OUT_DIR,
  })
  // results 一併落檔：報告的判讀邏輯之後一定會改（本輪就改過一次——彙總判準漏掉配對結構），
  // 沒有原始資料就得重跑一次 $2.7 的 LLM 才能換個算法看
  writeFileSync(resolve(OUT_DIR, `results-${started.slice(0, 10)}.json`), JSON.stringify({ meta: {
    started,
    finished: new Date().toISOString(),
    dates,
    limit,
    failures,
    calls,
    costUsd,
    narrativeModel: resolveAgentModel('narrative-writer'),
    analystModel: resolveAgentModel('analyst-tier1'),
  }, results }, null, 2))
  const reportFile = resolve(OUT_DIR, `report-${started.slice(0, 10)}.md`)
  const banner = canaryExampleBanner()
  writeFileSync(reportFile, banner !== null ? `${banner}\n\n${report}` : report)
  console.log(`\n${report}`)
  console.log(`\n報告：${reportFile}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
