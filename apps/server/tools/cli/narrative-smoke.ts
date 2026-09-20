#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
// smoke：呼叫 callNarrativeWriter 一次、用 hand-crafted brief / analyst / news / citations 餵 Gemini、
// 驗證 system prompt 產 valid structured narrative + 1500-2500 字 + citationUrls subset OK。
// 不需 DB 或完整 pipeline、純驗 LLM integration。
// 用法：cd apps/server && pnpm exec tsx --env-file-if-exists=.env tools/cli/narrative-smoke.ts
//   （原本寫的 `pnpm --filter server exec …` 是錯的：這支腳本在 worker 底下，
//     從 api workspace 執行找不到它；key 才是在 apps/server/.env，故用 --env-file-if-exists 指過去。）

import type { MarketBrief } from '@suanomics/shared'
import type { NewsItem } from '../../src/agents/orchestrator.js'
import type { AnalystOutput } from '../../src/agents/types.js'
import process from 'node:process'
import { buildClaimLedger } from '@suanomics/shared'
import { callNarrativeWriter, narrativeLedgerEnabled } from '../../src/agents/narrative-writer.js'
import { SERIES_SPECS } from '../../src/market-data/series-config.js'
import { buildSnapshotBlock } from '../../src/market-data/snapshot.js'
import { buildOfficialFixtureBlock } from '../eval/official-fixture.js'
import { requireGeminiKeyOrExit } from './lib/smoke-args.js'

const FAKE_BRIEF: MarketBrief = {
  headline: '日月光 Q1 ROE 25%、半導體封測訂單能見度展望佳',
  summary: '日月光 Q1 ROE 達 25% 創新高、CoWoS 訂單能見度向後延展、市場關注上游設備供應鏈傳導。',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['日月光 Q1 ROE 25%', 'CoWoS 訂單能見度延展', '上游設備鏈受惠'],
  citations: [
    { url: 'https://example.com/aspeed-q1', title: '日月光 Q1 法說會', quote: 'ROE 達 25% 創歷史新高、CoWoS 訂單能見度延展至 2027' },
    { url: 'https://example.com/advantest', title: '愛德萬訂單動能', quote: 'advanced packaging 設備需求年增 30%' },
    { url: 'https://example.com/avgo-asic', title: 'Broadcom ASIC 雲端訂單', quote: 'AVGO 雲端客戶 ASIC 訂單能見度延展、Hyperscaler 自研晶片潮' },
    { url: 'https://example.com/chips-act', title: 'CHIPS Act 政策追蹤', quote: '美國商務部對 ESMC 第一階段補助核發、TSMC AZ 二期啟動' },
    { url: 'https://example.com/aws-trainium', title: 'AWS Trainium 進度', quote: 'Annapurna 主導 Trainium 3 量產、AWS 雲端 AI 算力自製化趨勢加快' },
  ],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

const FAKE_ANALYSTS: AnalystOutput[] = [
  {
    newsId: 'n-aspeed-q1',
    claims: [
      { id: 'c1', kind: 'fact', claimType: 'named-number', claim: '日月光投控 Q1 ROE 達 25%，為歷史新高', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/aspeed-q1' }], asOf: '2025-12-31', checks: [] },
      { id: 'c2', kind: 'fact', claimType: 'dated-event', claim: '日月光法說會揭露 CoWoS 訂單能見度延展至 2027 年', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/aspeed-q1' }], asOf: '2025-12-31', checks: [] },
      { id: 'c3', kind: 'inference', claimType: 'causal', claim: 'AI 算力需求拉動 advanced packaging，使封測產能爭奪延續', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/aspeed-q1' }], asOf: '2025-12-31', checks: [] },
    ],
    primaryImpact: '半導體封測訂單能見度向後延展',
    reasoning: 'AI 算力需求拉動 advanced packaging、CoWoS 產能爭奪、上游設備鏈受惠',
    cascadeChains: [
      {
        chainId: 't1-0',
        tier: 1,
        industry: '半導體封測產業',
        mechanism: 'AI 算力需求拉動 advanced packaging、CoWoS 產能延展',
        affectedTickers: ['2330', '3711'],
        direction: 'positive',
        citations: [{ url: 'https://example.com/aspeed-q1', title: '日月光 Q1 法說會', quote: 'ROE 25%' }],
      },
      {
        chainId: 't2-0',
        tier: 2,
        parentChainId: 't1-0',
        industry: '半導體設備鏈',
        mechanism: 'advanced packaging 設備需求拉動愛德萬 / 京瓷訂單',
        affectedTickers: ['Advantest', 'Kyocera'],
        direction: 'positive',
        citations: [{ url: 'https://example.com/advantest', title: '愛德萬訂單動能', quote: '需求年增 30%' }],
      },
    ],
  },
  {
    newsId: 'n-avgo-rev',
    claims: [
      { id: 'c1', kind: 'fact', claimType: 'dated-event', claim: 'Broadcom 公布雲端客戶 ASIC 訂單能見度延展', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/avgo-asic' }], asOf: '2025-12-31', checks: [] },
      { id: 'c2', kind: 'inference', claimType: 'causal', claim: 'Hyperscaler 自研晶片潮把 AI 算力需求分流到客製化 ASIC', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/avgo-asic' }], asOf: '2025-12-31', checks: [] },
    ],
    primaryImpact: 'AI ASIC 客製化晶片市場擴張',
    reasoning: 'Broadcom 雲端客戶 ASIC 訂單持續、AI ecosystem 客製化趨勢延伸',
    cascadeChains: [
      {
        chainId: 't1-1',
        tier: 1,
        industry: 'AI ASIC 客製化晶片',
        mechanism: '雲端客戶採購 ASIC 取代部分 GPU、Broadcom 訂單能見度延展',
        affectedTickers: ['AVGO', '2330'],
        direction: 'positive',
        citations: [{ url: 'https://example.com/avgo-asic', title: 'Broadcom ASIC 雲端訂單', quote: '雲端 ASIC' }],
      },
    ],
  },
  {
    newsId: 'n-aws-trainium',
    claims: [
      { id: 'c1', kind: 'fact', claimType: 'dated-event', claim: 'Annapurna 主導的 AWS Trainium 3 進入量產', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/aws-trainium' }], asOf: '2025-12-31', checks: [] },
      { id: 'c2', kind: 'inference', claimType: 'causal', claim: '雲端業者自製化推進，使 AI 算力供應鏈的客戶結構分散', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/aws-trainium' }], asOf: '2025-12-31', checks: [] },
    ],
    primaryImpact: 'AWS Trainium 3 量產、雲端 AI 自製化擴張',
    reasoning: 'Annapurna 加速自研、AWS 雲端 AI workload 自製化、影響 GPU vs ASIC 結構',
    cascadeChains: [
      {
        chainId: 't1-2',
        tier: 1,
        industry: '雲端 AI 自製晶片',
        mechanism: 'Hyperscaler 自研 ASIC 取代 Nvidia GPU 部分 workload',
        affectedTickers: ['AMZN', 'NVDA', 'AVGO'],
        direction: 'neutral',
        citations: [{ url: 'https://example.com/aws-trainium', title: 'AWS Trainium 進度', quote: 'Trainium 3' }],
      },
      {
        chainId: 't2-2',
        tier: 2,
        parentChainId: 't1-2',
        industry: '台廠 ASIC 設計服務',
        mechanism: 'AWS / Meta 訂單外溢至 Marvell / 台積電 ASIC 客製代工',
        affectedTickers: ['MRVL', '2330', '5347'],
        direction: 'positive',
        citations: [{ url: 'https://example.com/avgo-asic', title: 'Broadcom ASIC 雲端訂單', quote: 'ASIC' }],
      },
    ],
  },
  {
    newsId: 'n-chips-act',
    claims: [
      { id: 'c1', kind: 'fact', claimType: 'dated-event', claim: '美國商務部核發 ESMC 第一階段 CHIPS Act 補助', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/chips-act' }], asOf: '2025-12-31', checks: [] },
      { id: 'c2', kind: 'scenario', claimType: 'causal', claim: '政策引導製造在地化若延續，半導體資本支出的地理分布會再調整', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/chips-act' }], asOf: '2025-12-31', checks: [] },
    ],
    primaryImpact: 'CHIPS Act 第一階段補助對 ESMC / TSMC AZ 啟動',
    reasoning: 'CHIPS Act 結構性引導、半導體在地化長線資本支出',
    cascadeChains: [
      {
        chainId: 't1-3',
        tier: 1,
        industry: '半導體在地化',
        mechanism: '美歐補助引導晶圓代工赴美建廠、影響全球產能配置',
        affectedTickers: ['TSM', 'INTC', 'GFS'],
        direction: 'neutral',
        citations: [{ url: 'https://example.com/chips-act', title: 'CHIPS Act 政策追蹤', quote: 'ESMC' }],
      },
    ],
  },
  {
    newsId: 'n-cowos-pkg',
    claims: [
      { id: 'c1', kind: 'fact', claimType: 'named-number', claim: '費城半導體指數 12/30 收 5,432.1 點', evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2025-12-30' }], asOf: '2025-12-31', checks: [] },
      { id: 'c2', kind: 'fact', claimType: 'named-number', claim: '加權指數收 23,150 點', evidenceRefs: [{ kind: 'series', seriesId: 'taiex-close', asOf: '2025-12-31' }], asOf: '2025-12-31', checks: [] },
      { id: 'c3', kind: 'fact', claimType: 'named-number', claim: '美國 10 年期公債殖利率 4.32%', evidenceRefs: [{ kind: 'series', seriesId: 'us-10y-yield', asOf: '2025-12-30' }], asOf: '2025-12-31', checks: [] },
      { id: 'c4', kind: 'inference', claimType: 'causal', claim: 'CoWoS 排隊延長使材料端供需轉緊', evidenceRefs: [{ kind: 'citation', url: 'https://example.com/aspeed-q1' }], asOf: '2025-12-31', checks: [] },
    ],
    primaryImpact: 'CoWoS 產能爭奪戰加劇、上游材料價格張',
    reasoning: 'AI 晶片高階封裝排隊延長、材料端京瓷 / 三菱瓦斯化學受惠',
    cascadeChains: [
      {
        chainId: 't1-4',
        tier: 1,
        industry: 'CoWoS 上游材料',
        mechanism: 'AI advanced packaging 訂單拉動材料端供需轉緊',
        affectedTickers: ['Kyocera', '6963'],
        direction: 'positive',
        citations: [{ url: 'https://example.com/aspeed-q1', title: '日月光 Q1 法說會', quote: 'CoWoS' }],
      },
    ],
  },
]

const FAKE_NEWS: NewsItem[] = [
  { id: 'n-aspeed-q1', title: '日月光 Q1 ROE 達 25%', url: 'https://example.com/n-aspeed-q1', text: '日月光投控 Q1 法說會公布、ROE 達 25% 創歷史新高、CoWoS 訂單能見度向後延展至 2027 年', publishedAt: null },
  { id: 'n-avgo-rev', title: 'Broadcom AI 客製化晶片訂單延展', url: 'https://example.com/n-avgo-rev', text: 'Broadcom 公布雲端客戶 ASIC 訂單能見度延展、市場觀察 AI ecosystem 客製化趨勢', publishedAt: null },
  { id: 'n-aws-trainium', title: 'AWS Trainium 3 量產進度', url: 'https://example.com/n-aws-trainium', text: 'Annapurna 主導 AWS Trainium 3 自研晶片量產、雲端 AI 算力自製化趨勢明確', publishedAt: null },
  { id: 'n-chips-act', title: 'CHIPS Act 第一階段補助核發', url: 'https://example.com/n-chips-act', text: '美國商務部對 ESMC 第一階段補助核發、TSMC 鳳凰城二期啟動、政策引導半導體製造在地化', publishedAt: null },
  { id: 'n-cowos-pkg', title: 'CoWoS 產能爭奪、材料端價格張', url: 'https://example.com/n-cowos-pkg', text: 'AI 晶片 advanced packaging 排隊延長、京瓷與三菱瓦斯化學等材料端供需轉緊', publishedAt: null },
]

const BRIEF_DATE = '2026-01-01'

async function main() {
  requireGeminiKeyOrExit('pnpm exec tsx --env-file-if-exists=.env tools/cli/narrative-smoke.ts')
  console.log('=== NarrativeWriter smoke test ===')
  console.log(`brief.headline: ${FAKE_BRIEF.headline}`)
  console.log(`analyst count: ${FAKE_ANALYSTS.length}`)
  console.log(`news count: ${FAKE_NEWS.length}`)
  console.log(`citations count: ${FAKE_BRIEF.citations.length}`)
  console.log('')
  // 餵一份帶「落後標注」的市場數據區塊——用正式的 buildSnapshotBlock 產、不是手寫字串，
  // 這樣 smoke 看到的就是 prod 會餵給 LLM 的原文。us-sox 刻意落後一個美股交易日。
  const specOf = (id: string) => {
    const spec = SERIES_SPECS.find(x => x.seriesId === id)
    if (!spec)
      throw new Error(`unknown series ${id}`)
    return spec
  }
  // 序列刻意湊齊兩個訊號組，讓「跨市場訊號一致性」小節真的出現在餵入原文裡。
  // - us-tech 全數同向（費半與那斯達克同步走高）→ aligned
  // - foreign-flow 刻意背離（台幣升值算流入側，法人賣超與外資期貨淨空算流出側）→ mixed
  // mixed 才是風險所在：模型可能把「2 比 1」讀成方向結論。smoke 就是要看它有沒有這樣做。
  const marketSnapshot = buildSnapshotBlock([
    { spec: specOf('us-sox'), points: [{ date: '2025-12-30', value: 5432.1 }, { date: '2025-12-29', value: 5300 }] },
    { spec: specOf('us-nasdaq-comp'), points: [{ date: '2025-12-30', value: 21480 }, { date: '2025-12-29', value: 21200 }] },
    { spec: specOf('taiex-close'), points: [{ date: '2025-12-31', value: 23150 }, { date: '2025-12-30', value: 23010 }] },
    { spec: specOf('us-10y-yield'), points: [{ date: '2025-12-30', value: 4.32 }, { date: '2025-12-29', value: 4.28 }] },
    { spec: specOf('usd-twd'), points: [{ date: '2025-12-30', value: 32.1 }, { date: '2025-12-29', value: 32.5 }] },
    { spec: specOf('taiex-institutional-net'), points: [{ date: '2025-12-31', value: -120 }, { date: '2025-12-30', value: -80 }] },
    { spec: specOf('foreign-taifex-net'), points: [{ date: '2025-12-31', value: -15000 }, { date: '2025-12-30', value: -12000 }] },
  ], new Date(`${BRIEF_DATE}T05:10:00+08:00`), BRIEF_DATE)
  console.log(`=== marketSnapshot 餵入原文 ===\n${marketSnapshot}\n`)

  // 2026-08-28：官方公告 block 也用真的 builder 產（同 marketSnapshot 的理由）。
  // 沒有它，smoke 量到的是「沒有官方公告的那個 prompt」，而 prod 有。
  const officialBlock = buildOfficialFixtureBlock(BRIEF_DATE)
  console.log(`=== officialBlock 餵入原文 ===\n${officialBlock ?? '(null)'}\n`)

  // ledger 由真正的 buildClaimLedger 產（含跨 output 的重新編號與去重），
  // 不是手寫一份——smoke 要看到的就是 prod 會餵給 LLM 的那份東西。
  const ledger = buildClaimLedger(FAKE_ANALYSTS.map(a => a.claims))
  console.log(`=== claim ledger ===`)
  console.log(`NARRATIVE_LEDGER_ENABLED=${process.env.NARRATIVE_LEDGER_ENABLED ?? '(unset)'} → ledger ${narrativeLedgerEnabled() ? '進' : '不進'} prompt`)
  console.log(`claims=${ledger.claims.length} sources=${ledger.sourceCount} droppedDuplicates=${ledger.droppedDuplicates}\n`)

  const start = Date.now()
  const result = await callNarrativeWriter({
    brief: FAKE_BRIEF,
    analystOutputs: FAKE_ANALYSTS,
    news: FAKE_NEWS,
    citations: FAKE_BRIEF.citations,
    briefDate: BRIEF_DATE,
    marketSnapshot,
    officialBlock,
    claimLedger: ledger.claims,
    // 刻意餵一個自帶總括泛稱的 thesis（形態取自 editor-output.test.ts 的 fixture）：
    // editor 的輸出空間本來就可能長這樣，而 narrative 被指示「明確採用本日論點」——
    // 若時間框架規則沒堵住，這句會被原樣照抄進 intro。smoke 就是要看它有沒有被改寫掉。
    dailyThesis: '半導體封測鏈訂單能見度延展、是今日台股結構性關注升溫的核心',
    onCallRecord: (r) => {
      if (r.tokensIn > 0 || r.tokensOut > 0) {
        console.log(`[llm-call] tokens=${r.tokensIn}/${r.tokensOut} cost=$${r.costUsd.toFixed(4)} latency=${r.latencyMs}ms attempts=${r.attempts}`)
      }
      else {
        console.log(`[audit] failed=${r.narrativeFailed} retryReason=${r.narrativeRetryReason} fabricationStripped=${r.narrativeFabricationStripped} claimIdsStripped=${r.narrativeClaimIdsStripped} claimCitationSections=${r.narrativeClaimCitationSections} claimCitationUrlsDropped=${r.narrativeClaimCitationUrlsDropped}`)
      }
    },
  })
  const elapsed = Date.now() - start
  console.log(`\n=== Result (${elapsed}ms) ===`)
  console.log(`audit: ${JSON.stringify(result.audit, null, 2)}`)
  if (!result.narrative) {
    console.log('[FAIL] narrative is null')
    process.exit(1)
  }
  const n = result.narrative
  const totalChars = n.intro.length + n.sections.reduce((a, s) => a + s.body.length, 0) + n.outro.length
  console.log(`\nintro (${n.intro.length} chars):\n${n.intro}\n`)
  for (let i = 0; i < n.sections.length; i++) {
    const s = n.sections[i]
    if (!s)
      continue
    console.log(`section ${i + 1} · ${s.heading} · relatedNewsIds=[${s.relatedNewsIds.join(', ')}] · claimIds=[${s.claimIds.join(', ')}]`)
    console.log(`  takeaway (${s.takeaway?.length ?? 0} chars): ${s.takeaway ?? '(null)'}`)
    console.log(`  body (${s.body.length} chars):\n${s.body}`)
    console.log(`  citationUrls: ${s.citationUrls.join(', ')}\n`)
  }
  console.log(`outro (${n.outro.length} chars):\n${n.outro}\n`)
  console.log(`=== Stats ===`)
  console.log(`total chars: ${totalChars} (target 1500-2500, tolerated 1200-3000)`)
  console.log(`sections: ${n.sections.length}`)
  console.log(`fabricationStripped: ${result.audit.fabricationStripped}`)
  // Acceptance flags
  // 字數三態：真正的硬 gate 是 NarrativeSchema（intro/outro ≤320、body ≤800、≤4 段、理論上限
  // 3840），能跑到這裡的產出必然已通過它。1500-2500 只是 prompt 給 LLM 的建議區間、pipeline
  // 不 enforce，所以偏離它不該報 FAIL——LLM 字數本來就有數百字的自然波動。留 ±20% 寬限帶報
  // WARN（值得看一眼但不是壞掉），超出寬限才 FAIL。
  const TARGET = { min: 1500, max: 2500 }
  const TOLERATED = { min: 1200, max: 3000 }
  const lengthVerdict = totalChars >= TARGET.min && totalChars <= TARGET.max
    ? 'PASS'
    : totalChars >= TOLERATED.min && totalChars <= TOLERATED.max
      ? 'WARN'
      : 'FAIL'
  const lengthNote = lengthVerdict === 'WARN' ? '（在寬限帶內、非回歸訊號）' : ''
  console.log(`N1 字數 ${lengthVerdict} (${totalChars})${lengthNote}`)
  const validUrls = new Set(FAKE_BRIEF.citations.map(c => c.url))
  const unknownCount = n.sections.flatMap(s => s.citationUrls).filter(u => !validUrls.has(u)).length
  console.log(`N3 citation 對齊 ${unknownCount === 0 ? 'PASS' : `FAIL (${unknownCount} unknown)`}`)
  const takeaways = n.sections.map(s => s.takeaway)
  const missing = takeaways.filter(t => t === null).length
  // 自足性最終要人讀、但「開頭是承接語」是最常見的失敗形態、可機械抓
  const TRANSITION_OPENERS = ['順著', '另一條', '首先', '接著', '在此同時', '延續', '承上']
  const transitionish = takeaways.filter(t => t !== null && TRANSITION_OPENERS.some(o => t.startsWith(o)))
  console.log(`N5 takeaway 齊備 ${missing === 0 ? 'PASS' : `FAIL (${missing}/${n.sections.length} null)`}`)
  console.log(`N6 takeaway 非過場句 ${transitionish.length === 0 ? 'PASS' : `FAIL (${transitionish.join(' | ')})`}`)
  const FORBIDDEN = ['看多', '看空', '加碼時機', '報明牌', '飆漲', '強勢突破', '強烈買進', '強烈賣出']
  const fullText = [n.intro, ...n.sections.map(s => s.body), n.outro].join('\n')
  const forbiddenHits = FORBIDDEN.filter(p => fullText.includes(p))
  console.log(`N4 合規 ${forbiddenHits.length === 0 ? 'PASS' : `FAIL (${forbiddenHits.join(', ')})`}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
