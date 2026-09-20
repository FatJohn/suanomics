#!/usr/bin/env tsx
/* eslint-disable no-console -- dev eval harness 進度輸出 */
// storyline 素材早期訊號 harness：在同一份「今日」合成情境上，用真 narrative-writer + synthesizer
// 生兩版 brief —— stateless（不餵 storyline block / hint）vs storyline（餵 enriched block + hint），
// 再用 brief:continuity 那把尺對照（昨日 = 既有 fixtures/continuity/prev.json 當基準線）。
//
// 為什麼這樣設計：storyline 素材只改 narrative-writer + synthesizer 兩個 agent、A/B 只差「有沒有餵
// storyline 素材」、其餘輸入完全相同 → 乾淨隔離 storyline 素材這個單一變因。不需 Postgres、只需 GEMINI_API_KEY（reuse）。
// 弧是手構的成熟弧（prev.json 的兩條主線：油價/能源通膨 + 半導體出口管制）→ 驗「機制」（writer 拿到
// 修好的弧有沒有寫出 delta/兌現），不是「真實多日新聞」端到端；後者待 prod 弧成熟後用同尺跑。
import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import type { MarketBrief } from '@suanomics/shared'
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import type { NewsItem } from '../../src/agents/orchestrator.js'
import type { AnalystOutput } from '../../src/agents/types.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { exit } from 'node:process'
import { fileURLToPath } from 'node:url'
import { callNarrativeWriter } from '../../src/agents/narrative-writer.js'
import { resolveAgentModel } from '../../src/agents/providers/resolve.js'
import { buildStorylineBlock, continuityHintFromEntries, entriesFromEditorResult } from '../../src/agents/storyline-block.js'
import { callSynthesizer } from '../../src/agents/synthesizer.js'
import { assembleDailyBrief } from '../../src/brief/assemble.js'
import { runContinuityCompare } from '../eval/continuity-judge.js'
import { buildContinuityReport } from '../eval/continuity-report.js'
import { loadBrief } from '../eval/load-brief.js'
import { buildOfficialFixtureBlock } from '../eval/official-fixture.js'
import { requireGeminiKeyOrExit } from './lib/smoke-args.js'

const TODAY = '2026-06-18'
const OUT_DIR = '.eval-out/storyline-ab'
// 昨日基準線 = 已 commit 的 prev.json（建立兩條主線的論點與懸念）
const PREV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../eval/fixtures/continuity/prev.json')

// 與 prev.json 兩條主線對齊的成熟弧（更新止於昨日 06-17）
const storylines: Storyline[] = [
  {
    id: 1,
    title: '能源通膨與油價',
    thesis: '中東地緣風險推升油價、台灣輸入性通膨壓力升溫、壓縮央行降息空間',
    status: 'open',
    entities: ['布蘭特原油', '荷姆茲海峽'],
    updates: [
      { briefDate: '2026-06-16', valence: 'extend', note: '美伊口角升溫、市場開始計入地緣溢價' },
      { briefDate: '2026-06-17', valence: 'support', note: '荷姆茲航運風險升高、布蘭特單日跳升逾4%' },
    ],
    lastTouchedBriefDate: '2026-06-17',
  },
  {
    id: 2,
    title: '美對中半導體出口管制',
    thesis: '美國研擬擴大對中先進製程設備出口限制、強化非中供應鏈地位',
    status: 'open',
    entities: ['台積電', '先進製程設備'],
    updates: [
      { briefDate: '2026-06-17', valence: 'extend', note: '管制細節未定、相關個股波動多反映預期而非已實現營收' },
    ],
    lastTouchedBriefDate: '2026-06-17',
  },
]

// 今日 editor 結果：主線1 出現反向訊號（delta）、主線2 懸念兌現（payoff）
const touches = [
  { storylineId: 1, valence: 'challenge' as const, note: '原油庫存意外大增、布蘭特自高點回落、與供給中斷論點出現反向訊號' },
]
const resolves = [
  { storylineId: 2, disposition: 'confirmed' as const, note: '美方正式公布對中設備管制清單、政策落地、先前不確定性解除' },
]

const news: NewsItem[] = [
  {
    id: 'n-oil',
    title: '原油庫存意外大增 布蘭特自高點回落',
    url: 'https://example.com/oil-inventory',
    text: '美國上週原油庫存意外大增、遠超市場預期、顯示供給並未如先前擔心般中斷。布蘭特原油自近期高點回落約3%、市場重新評估荷姆茲海峽供給中斷的機率與地緣溢價。',
    publishedAt: null,
  },
  {
    id: 'n-chip',
    title: '美方公布對中先進製程設備管制清單',
    url: 'https://example.com/chip-rule',
    text: '美國商務部正式公布擴大對中先進製程設備出口管制的最終清單、涵蓋多類關鍵設備與檢測機台。先前市場關注的政策細節正式落地、不確定性解除。',
    publishedAt: null,
  },
]
const selectedNewsById = new Map(news.map(n => [n.id, { title: n.title, url: n.url }]))

const analystOutputs: AnalystOutput[] = [
  {
    newsId: 'n-oil',
    claims: [],
    primaryImpact: '油價回落、能源生產端營收承壓、輸入性通膨壓力短線緩解',
    reasoning: '原油庫存意外大增顯示供給未如預期中斷、地緣溢價部分回吐、與昨日油價跳升的供給疑慮形成反向訊號',
    cascadeChains: [
      {
        industry: '能源',
        mechanism: '庫存意外增加 → 供給疑慮緩解 → 油價回落 → 能源生產端營收動能承壓',
        affectedTickers: ['XLE'],
        direction: 'negative',
        citations: [{ url: 'https://example.com/oil-inventory', title: '原油庫存報告', quote: '庫存意外大增' }],
      },
      {
        industry: '航運運輸',
        mechanism: '油價回落 → 燃油成本下降 → 運輸業成本面改善',
        affectedTickers: ['2615'],
        direction: 'positive',
        citations: [{ url: 'https://example.com/oil-inventory', title: '原油庫存報告', quote: '布蘭特回落' }],
      },
    ],
  },
  {
    newsId: 'n-chip',
    claims: [],
    primaryImpact: '半導體出口管制政策落地、不確定性解除、非中供應鏈地位強化',
    reasoning: '昨日仍屬預期的管制細節今日正式公布、先前的政策不確定性兌現為明確事實',
    cascadeChains: [
      {
        industry: '半導體',
        mechanism: '管制清單正式落地 → 非中供應鏈重要性上升 → 龍頭議價地位結構面增強',
        affectedTickers: ['2330'],
        direction: 'positive',
        citations: [{ url: 'https://example.com/chip-rule', title: '管制清單公告', quote: '正式公布清單' }],
      },
    ],
  },
]
const cascadeChains = analystOutputs.flatMap(a => a.cascadeChains)
const mainThemes = ['能源與油價反轉', '半導體出口管制落地']

// 生一份「今日」brief；useStoryline=true 餵 storyline block + 標題 hint、false 為 stateless 對照
async function genToday(useStoryline: boolean, onCall: (r: LlmCallRecord) => void): Promise<MarketBrief> {
  const entries = entriesFromEditorResult(touches, resolves, storylines, TODAY)
  const storylineBlock = buildStorylineBlock(entries)
  const continuityHint = continuityHintFromEntries(entries)

  const synth = await callSynthesizer({
    analystOutputs,
    date: TODAY,
    ...(useStoryline && continuityHint ? { continuityHint } : {}),
    onCallRecord: onCall,
  })
  const brief = assembleDailyBrief({ synth, analystOutputs, selectedNewsById, cascadeChains })
  // 刻意不傳 claimLedger：這支量的是 storyline 素材的跨日連續性，analystOutputs 是
  // 手寫 fixture、本來就沒有 claims，傳進去也是空 ledger。要量 ledger 效果請走 `ledger:ab`。
  const nr = await callNarrativeWriter({
    brief,
    analystOutputs,
    news,
    citations: brief.citations,
    briefDate: TODAY,
    mainThemes,
    // 2026-08-28：兩版都餵官方公告 block（變因仍只有 storyline 素材），
    // 讓量到的 prompt 與 prod 同形。★ 基準線因此移動，與本日之前的報告不可直接比。
    officialBlock: buildOfficialFixtureBlock(TODAY),
    ...(useStoryline && storylineBlock ? { storylineBlock } : {}),
    onCallRecord: onCall,
  })
  if (!nr.narrative)
    throw new Error(`narrative 生成失敗（storyline=${useStoryline}）：${nr.audit.retryReason}`)
  return { ...brief, narrative: nr.narrative }
}

async function main(): Promise<void> {
  requireGeminiKeyOrExit('pnpm storyline:continuity-ab（會吃 apps/server/.env）')
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0
  const onCall = (r: LlmCallRecord): void => {
    costUsd += r.costUsd
    tokensIn += r.tokensIn
    tokensOut += r.tokensOut
  }

  console.log('生 stateless 版（不餵 storyline）...')
  const stateless = await genToday(false, onCall)
  console.log('生 storyline 版（餵 enriched block + hint）...')
  const withStoryline = await genToday(true, onCall)

  const yesterday = loadBrief(PREV_PATH)

  const outDir = resolve(OUT_DIR)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'today-stateless.json'), JSON.stringify(stateless, null, 2), 'utf8')
  writeFileSync(resolve(outDir, 'today-storyline.json'), JSON.stringify(withStoryline, null, 2), 'utf8')

  console.log('跑 brief:continuity judge（雙 orientation）...')
  const { model } = resolveAgentModel('brief-continuity-judge')
  const result = await runContinuityCompare({ todayA: stateless, todayB: withStoryline, yesterday, onCallRecord: onCall })
  const markdown = buildContinuityReport(result, { labelA: 'stateless', labelB: 'storyline', model, tokensIn, tokensOut, costUsd })
  const reportPath = resolve(outDir, 'continuity-stateless-vs-storyline.md')
  writeFileSync(reportPath, markdown, 'utf8')

  console.log('')
  console.log(`報告：${reportPath}`)
  console.log(`生成 brief：${resolve(outDir, 'today-stateless.json')} / ${resolve(outDir, 'today-storyline.json')}`)
  console.log(`跨日連貫=${result.crossDay.winner} 論點演進=${result.thesisDelta.winner} 伏筆兌現=${result.resolvePayoff.winner}（winner=B 代表 storyline 勝）`)
  console.log(`總成本：$${costUsd.toFixed(4)}（in ${tokensIn} / out ${tokensOut}）`)
}

main().then(() => exit(0)).catch((err: Error) => {
  console.error(err.stack ?? err.message)
  exit(1)
})
