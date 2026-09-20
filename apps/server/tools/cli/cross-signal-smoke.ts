/* eslint-disable no-console -- smoke script：輸出就是產物，判讀由人做 */
/**
 * 跨市場訊號注入後的 analyst-tier1 真實 LLM smoke（驗收條件之一）。
 *
 *   cd apps/server && pnpm exec tsx --env-file-if-exists=.env tools/cli/cross-signal-smoke.ts
 *   cd apps/server && pnpm exec tsx tools/cli/cross-signal-smoke.ts --snapshot-only   # 不打 LLM、只印餵入原文
 *
 * 為什麼需要這支：`macro-frames.ts` 的兩條問題改成「引用快照算好的結論、不要自己重判方向」，
 * 而 macro-frames 只掛在 analyst-tier1 的 system prompt——`narrative-smoke.ts` 打的是
 * narrative-writer，量不到這個改動。canary fixtures 同樣量不到 prompt 改動（曾經因此吃過教訓）。
 *
 * 它只印產出、不做斷言（判 FAIL 也 exit 0），**是人工判讀工具、不是 gate**。要看的是：
 * 1. analyst 有沒有真的引用「跨市場訊號一致性」的結論，而不是自己重判一次方向
 * 2. 有沒有把事實句**逐字複誦**當成分析（parroting）
 * 3. 有沒有把「3 項中 2 項同向」這種事實**扭成方向結論**（偏多／偏空／可信度高）——本 issue 的紅線
 */
import type { SeriesLatest } from '../../src/market-data/snapshot.js'
import process from 'node:process'
import { callAnalystTier1 } from '../../src/agents/analyst-tier1.js'
import { runViewpointsDebate } from '../../src/agents/viewpoints-debate.js'
import { SERIES_SPECS } from '../../src/market-data/series-config.js'
import { buildSnapshotBlock } from '../../src/market-data/snapshot.js'

function specOf(id: string) {
  const spec = SERIES_SPECS.find(x => x.seriesId === id)
  if (!spec)
    throw new Error(`unknown series ${id}`)
  return spec
}

// 兩個訊號組刻意做出不同形狀：
// - us-tech 全數同向（費半與那斯達克同步走高）→ aligned，看模型會不會過度延伸
// - foreign-flow 刻意背離（台幣升值＝流入側；法人賣超與外資期貨淨空＝流出側）→ mixed，
//   這才是風險所在：模型可能把「2 比 1」讀成方向結論。
const LATEST: SeriesLatest[] = [
  { spec: specOf('us-sox'), points: [{ date: '2025-12-30', value: 5432.1 }, { date: '2025-12-29', value: 5300 }] },
  { spec: specOf('us-nasdaq-comp'), points: [{ date: '2025-12-30', value: 21480 }, { date: '2025-12-29', value: 21200 }] },
  { spec: specOf('us-10y-yield'), points: [{ date: '2025-12-30', value: 4.32 }, { date: '2025-12-29', value: 4.28 }] },
  { spec: specOf('us-10y-real-rate'), points: [{ date: '2025-12-30', value: 2.05 }, { date: '2025-12-29', value: 1.95 }] },
  { spec: specOf('us-10y-breakeven'), points: [{ date: '2025-12-30', value: 2.27 }, { date: '2025-12-29', value: 2.33 }] },
  { spec: specOf('taiex-close'), points: [{ date: '2025-12-31', value: 23150 }, { date: '2025-12-30', value: 23010 }] },
  { spec: specOf('usd-twd'), points: [{ date: '2025-12-30', value: 32.1 }, { date: '2025-12-29', value: 32.5 }] },
  { spec: specOf('taiex-institutional-net'), points: [{ date: '2025-12-31', value: -120 }, { date: '2025-12-30', value: -80 }] },
  { spec: specOf('foreign-taifex-net'), points: [{ date: '2025-12-31', value: -15000 }, { date: '2025-12-30', value: -12000 }] },
]

// 這支 smoke 能證明什麼、不能證明什麼（兩輪獨立複查修正後的誠實版本）：
//
// **不能證明**：「產出裡方向講對 ⇒ 注入的事實被消費」。快照的**原始表格本身就帶方向**
// （`前值 4.28%、較前值 +0.04 個百分點`、`+2.49%`、`連續賣超`、`持續淨空`），模型不需要
// 訊號小節也能講對方向。第一版還把方向寫進新聞內文與標題，那更是雙重 confound。
//
// **能證明**：產出裡出現**只有注入的事實才有的資訊**。真正的指紋是**極性映射**——
// 「美元兌台幣下降」要對應到「資金流入台股」，靠的是 group spec 的 `polarity: -1`
// （cross-market-signals.ts），表格、標題、新聞都沒有這層語意。組名（「外資動向」
// 「美債殖利率拆解」）同理，只存在於注入的事實句裡。
//
// 所以新聞內文與標題一律不帶方向與數字，把 confound 降到最低；判讀時看的是指紋、不是方向對錯。
const NEWS_TEXT = [
  '美國公債市場昨日交易後，市場討論轉向這次十年期殖利率變動的組成，',
  '究竟是由實質利率（TIPS）還是通膨預期（breakeven）所主導。',
  '同一時間，市場也在檢視美股科技類指數的表現，',
  '以及匯率、三大法人現貨買賣超與外資台指期部位所反映的外資動向。',
].join('')

const NOW = new Date('2026-01-01T05:10:00+08:00')

/**
 * 一個臂。`withSignals: false` 用 `computeSignals: () => []` 把訊號小節整段拿掉，
 * **其餘輸入完全相同**——這是唯一能歸因的做法：兩臂只差注入的事實，產出的差異才說得上是它造成的。
 */
async function runArm(withSignals: boolean): Promise<void> {
  const label = withSignals ? 'A（有訊號小節）' : 'B（對照組：無訊號小節）'
  const marketSnapshot = buildSnapshotBlock(LATEST, NOW, '2026-01-01', withSignals ? {} : { computeSignals: () => [] })
  console.log(`\n======== 臂 ${label} ========`)
  console.log(`=== marketSnapshot 餵入原文 ===\n${marketSnapshot}\n`)

  if (process.argv.includes('--snapshot-only')) {
    console.log('(--snapshot-only：不打 LLM)')
    return
  }

  const start = Date.now()
  const out = await callAnalystTier1({
    // 標題同樣不帶方向：第一版寫「殖利率上行由實質利率主導、通膨預期回落」，等於把
    // yield-decomposition 那條事實整組先講完，模型照抄標題就對了。
    newsTitle: '美債殖利率變動的組成與台美股資金動向',
    newsText: NEWS_TEXT,
    briefDate: '2026-01-01',
    publishedAt: '2025-12-31T22:00:00Z',
    decomposed: {
      primaryEntity: { name: '美國十年期公債殖利率', kind: 'indicator' },
      topicTags: ['rates', 'macro'],
      cascadeHypotheses: [],
    },
    retrieved: [],
    marketSnapshot,
    onCallRecord: (r) => {
      if (r.tokensIn > 0 || r.tokensOut > 0)
        console.log(`[llm-call] tokens=${r.tokensIn}/${r.tokensOut} cost=$${r.costUsd.toFixed(4)} latency=${r.latencyMs}ms attempts=${r.attempts}`)
    },
  })
  console.log(`\n=== analyst-tier1 產出（${Date.now() - start}ms）===`)
  console.log(JSON.stringify(out, null, 2))

  // viewpoints-debate 也吃同一個 snapshotBlock，而它是**唯一刻意產出正／反兩面論述**的 agent
  // ——把「2 比 1 的分歧」扭成方向結論的風險最高的就是它，所以一併真跑。
  // （獨立複查指出第一版漏了這個消費端。）
  const viewpoints = await runViewpointsDebate({
    // thesis 也不帶方向（原本寫「實質利率走高」）：viewpoints 是繞著 thesis 辯論的，
    // thesis 自帶方向就等於把答案先給了。
    thesis: '美債實質利率的變動是本日跨市場訊號的共同分母',
    headline: '殖利率結構變化牽動台美股資金動向',
    summary: '十年期殖利率的組成變化，與美股科技指數、台股外資動向的訊號一致性，構成本日觀察主軸。',
    marketSnapshot,
    cascadeChains: [],
    onCallRecord: (r) => {
      if (r.tokensIn > 0 || r.tokensOut > 0)
        console.log(`[llm-call/viewpoints] tokens=${r.tokensIn}/${r.tokensOut} cost=$${r.costUsd.toFixed(4)} latency=${r.latencyMs}ms`)
    },
  })
  console.log(`\n=== viewpoints-debate 產出 ===`)
  console.log(viewpoints ? JSON.stringify(viewpoints, null, 2) : '(null — 合規 gate 或 schema 未過，屬既有 graceful degrade)')

  // 只做提示、不當 gate：真正的判讀交給獨立複查。
  const text = JSON.stringify(out) + JSON.stringify(viewpoints)
  const parrotSuspects = ['項訊號全數指向', '項訊號中'].filter(s => text.includes(s))
  const directionSuspects = ['偏多', '偏空', '可信度', '開高走低', '布局'].filter(s => text.includes(s))
  console.log(`\n=== 人工判讀提示 ===`)
  console.log(`逐字複誦事實句的片段：${parrotSuspects.length > 0 ? parrotSuspects.join('、') : '（無）'}`)
  console.log(`方向結論措辭：${directionSuspects.length > 0 ? directionSuspects.join('、') : '（無）'}`)
  // 「方向講對」不是證據——快照的原始表格本身就帶方向。要找的是極性映射結果這種
  // 只有注入的事實才有的字串（詳見檔頭）。
  //
  // 清單刻意只留**措辭獨特**的：`資金流入台股`／`資金流出台股` 是 group spec 的極名、
  // `美債殖利率拆解` 是組名，模型自己不會這樣說。刻意**排除** `外資動向`、`美股科技`
  // ——那是通用中文財經詞，模型本來就會用，拿它當指紋是假陽性（第一版就這樣誤判過）。
  const fingerprints = ['資金流入台股', '資金流出台股', '美債殖利率拆解']
    .filter(s => text.includes(s))
  console.log(`候選指紋（措辭只可能來自注入事實）：${fingerprints.length > 0 ? fingerprints.join('、') : '（無）'}`)
  console.log('注意：指紋為零不代表沒被消費（模型多半改寫而非照抄），有指紋也仍要人工看語境。')
}

// 雙臂依序跑。要判的不是「臂 A 講得對不對」，而是**臂 A 與臂 B 有沒有差**：
// 若兩臂的背離判讀、極性語意、涵蓋的訊號組都一樣，就代表注入沒有改變模型的行為，
// 這次改動等於只是多花 token——這個負面結果必須看得見，不能被「臂 A 講得很好」蓋過去。
await runArm(true)
await runArm(false)
