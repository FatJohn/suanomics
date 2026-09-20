import type { AnalystOutput } from '../../src/agents/types.js'
import type { SeriesLatest } from '../../src/market-data/snapshot.js'
import { checkNamedNumbers, extractCheckedNumbers, runDeterministicChecks } from '@suanomics/shared'
import { assembleBriefCitations } from '../../src/brief/assemble.js'
import { SERIES_SPECS } from '../../src/market-data/series-config.js'
import { buildSnapshotBlock, selectSeriesAnchors } from '../../src/market-data/snapshot.js'

// 量測用的固定素材與指標計算。與腳本主檔分開的直接原因是 max-lines，
// 但也讓指標本身可被單元測試——主檔是 I/O 與真 LLM 呼叫，測不了。

function specOf(id: string) {
  const s = SERIES_SPECS.find(x => x.seriesId === id)
  if (!s)
    throw new Error(`unknown series ${id}`)
  return s
}

/**
 * 固定序列 fixture（做法同 `cross-signal-smoke.ts`）。
 *
 * **已知限制、報告裡會再寫一次**：這些值不是 canary 那幾天的真實行情，所以「模型有沒有
 * 把序列數字抄對」量得到、「該日真實序列長什麼樣」量不到；且新聞內文講的是別天的行情，
 * 模型引用序列的動機會低於真實 pipeline → series ref 的產出率是**下限**。
 */
export const LATEST: SeriesLatest[] = [
  { spec: specOf('us-sox'), points: [{ date: '2026-07-24', value: 10447.49 }, { date: '2026-07-23', value: 10910.2 }] },
  { spec: specOf('us-nasdaq-comp'), points: [{ date: '2026-07-24', value: 24500.05 }, { date: '2026-07-23', value: 24657.8 }] },
  { spec: specOf('us-10y-yield'), points: [{ date: '2026-07-24', value: 4.32 }, { date: '2026-07-23', value: 4.28 }] },
  { spec: specOf('us-10y-real-rate'), points: [{ date: '2026-07-24', value: 2.05 }, { date: '2026-07-23', value: 1.95 }] },
  { spec: specOf('us-10y-breakeven'), points: [{ date: '2026-07-24', value: 2.27 }, { date: '2026-07-23', value: 2.33 }] },
  { spec: specOf('taiex-close'), points: [{ date: '2026-07-25', value: 23150 }, { date: '2026-07-24', value: 23010 }] },
  { spec: specOf('usd-twd'), points: [{ date: '2026-07-25', value: 32.1 }, { date: '2026-07-24', value: 32.5 }] },
  { spec: specOf('taiex-institutional-net'), points: [{ date: '2026-07-25', value: -120 }, { date: '2026-07-24', value: -80 }] },
  { spec: specOf('foreign-taifex-net'), points: [{ date: '2026-07-25', value: -15000 }, { date: '2026-07-24', value: -12000 }] },
]
export const NOW = new Date('2026-07-26T05:10:00+08:00')
export const SNAPSHOT_REPORT_DATE = '2026-07-26'

export interface Metrics {
  news: number
  chains: number
  claims: number
  chainsOfClaimlessNews: number
  byKind: Record<string, number>
  byClaimType: Record<string, number>
  factClaims: number
  factGrounded: number
  namedNumberClaims: number
  namedNumberPassedD4: number
  refsKept: number
  /** ref 組成三分。D2/D3 淘汰數為 0 時，只有這組能區分「模型很乾淨」與「模型根本沒掛 ref」。 */
  claimsNoRef: number
  claimsWithCitationRef: number
  claimsWithSeriesRef: number
  refsDroppedD2: number
  refsDroppedD3Unknown: number
  refsDroppedD3AsOf: number
  kindReclassified: number
  mechanismNumbers: number
  mechanismCovered: number
  mechanismTraceable: number
  /** D4 掛不上，但該數字**等於某個序列點的值**——這是 auto-attach 的 recall 缺口，不是刻意的設計限制。 */
  d4UnmatchedIsSeriesPoint: number
  /** D4 掛不上、在快照 block 裡、且不等於任何序列點值——delta／變動%（刻意不掛 ref）。 */
  d4UnmatchedInBlock: number
  /** D4 掛不上、且不在快照 block 裡的數字——來自新聞或真的沒有依據。 */
  d4UnmatchedElsewhere: number
}

export function emptyMetrics(): Metrics {
  return {
    news: 0,
    chains: 0,
    claims: 0,
    chainsOfClaimlessNews: 0,
    byKind: {},
    byClaimType: {},
    factClaims: 0,
    factGrounded: 0,
    namedNumberClaims: 0,
    namedNumberPassedD4: 0,
    refsKept: 0,
    claimsNoRef: 0,
    claimsWithCitationRef: 0,
    claimsWithSeriesRef: 0,
    refsDroppedD2: 0,
    refsDroppedD3Unknown: 0,
    refsDroppedD3AsOf: 0,
    kindReclassified: 0,
    mechanismNumbers: 0,
    mechanismCovered: 0,
    mechanismTraceable: 0,
    d4UnmatchedIsSeriesPoint: 0,
    d4UnmatchedInBlock: 0,
    d4UnmatchedElsewhere: 0,
  }
}

function pct(num: number, den: number): string {
  return den === 0 ? 'n/a（分母為 0）' : `${(num / den * 100).toFixed(1)}%（${num}/${den}）`
}

/**
 * 臂 A 的六項數字。**臂 B 不得呼叫本函式**——它不產 claim，套 claim 指標會得到假的 0%。
 *
 * `outputs` 必須是**同一天的全部** tier1 產出：`brief.citations` 是跨新聞 union 出來的
 * （`assemble.ts:85`），逐則各自組會少掉那個 union、量出來的 D2 淘汰率偏嚴。
 */
export function measure(outputs: AnalystOutput[], m: Metrics): void {
  const citations = assembleBriefCitations(outputs).map(c => ({ url: c.url, quote: c.quote }))
  // 與 pipeline **同一個函式**產生錨點：兩邊各組一份的話，量到的就不是 pipeline 的行為
  // （之前已經踩過一次「量測 context 與 pipeline 不符」）。
  // 它天然只含 block 裡真的印出數字的序列，所以不會虛高 D3。
  const anchors = selectSeriesAnchors(LATEST, NOW, SNAPSHOT_REPORT_DATE)
  // 模型實際看得到的所有數字：用來分類「掛不上的數字」是快照裡的（delta、變動%——
  // 刻意不為它們定義 ref 種類）還是別處來的。
  //
  // 兩處刻意處理，缺一整桶都會搬錯邊（獨立複查 2026-08-05 實測）：
  // 1. **只取數據列**：跨市場訊號小節是散文，會把「3 家」「2 個」這種小整數灌進來。
  // 2. **比對絕對值**：block 印「-463 點 / -4.24%」，claim 寫「下跌 463 點、跌幅 4.24%」，
  //    帶正負號比對會讓最想量的那一類（負向 delta）幾乎全數落到另一桶。
  const blockText = (buildSnapshotBlock(LATEST, NOW, SNAPSHOT_REPORT_DATE) ?? '').split('### 跨市場訊號一致性')[0] ?? ''
  const blockNumbers = new Set(extractCheckedNumbers(blockText, '').map(n => Math.abs(n.value)))
  const ctx = {
    citations,
    seriesPoints: anchors,
    knownSeriesIds: SERIES_SPECS.map(s => s.seriesId),
    // 這裡沒有把行事曆注入 tier1；給了就是量測與輸入不一致。
    calendarDates: [] as string[],
  }

  for (const out of outputs) {
    m.news++
    m.chains += out.cascadeChains.length
    m.claims += out.claims.length
    if (out.claims.length === 0)
      m.chainsOfClaimlessNews += out.cascadeChains.length

    const audits = out.claims.map(c => runDeterministicChecks(c, ctx))
    for (const [i, claim] of out.claims.entries()) {
      const audit = audits[i]
      if (!audit)
        continue
      m.byKind[claim.kind] = (m.byKind[claim.kind] ?? 0) + 1
      m.byClaimType[claim.claimType] = (m.byClaimType[claim.claimType] ?? 0) + 1
      m.refsKept += audit.claim.evidenceRefs.length
      if (claim.evidenceRefs.length === 0)
        m.claimsNoRef++
      if (claim.evidenceRefs.some(r => r.kind === 'citation'))
        m.claimsWithCitationRef++
      if (claim.evidenceRefs.some(r => r.kind === 'series'))
        m.claimsWithSeriesRef++
      for (const f of audit.findings) {
        if (f.startsWith('D2：'))
          m.refsDroppedD2++
        else if (f.includes('未知序列 id'))
          m.refsDroppedD3Unknown++
        else if (f.includes('當日快照沒有'))
          m.refsDroppedD3AsOf++
      }
      if (claim.kind === 'fact') {
        m.factClaims++
        // D1 落在 checks 代表「跑了**且通過**」＝ D2/D3 過濾後仍有 ≥1 ref。
        if (audit.checks.includes('D1'))
          m.factGrounded++
      }
      if (claim.claimType === 'named-number') {
        m.namedNumberClaims++
        if (audit.checks.includes('D4'))
          m.namedNumberPassedD4++
      }
      if (audit.findings.some(f => f.startsWith('D6：')))
        m.kindReclassified++
      // 只對 named-number claim 判：D4 本來就只適用它（evidence-checks.ts），
      // 對 causal／dated-event 也算會把它們的數字全灌進「掛不上」桶。
      // 對象是 D2/D3 過濾**之後**的 claim，與 runDeterministicChecks 內部同一個。
      if (claim.claimType === 'named-number') {
        for (const n of checkNamedNumbers(audit.claim, ctx).unmatched) {
          // 三分而非兩分：序列點值先分出來。它們是 auto-attach 沒掛到（例如前值落在
          // 沒有序列名的子句），與「delta 沒有 ref 種類可掛」是兩件事，混成一桶會把
          // recall 缺口偽裝成刻意的設計限制（獨立複查 2026-08-05 抓到 3/24 屬此類）。
          if (anchors.some(a => Math.abs(a.value) === Math.abs(n.value) || (a.displayValue != null && Math.abs(a.displayValue) === Math.abs(n.value))))
            m.d4UnmatchedIsSeriesPoint++
          else if (blockNumbers.has(Math.abs(n.value)))
            m.d4UnmatchedInBlock++
          else
            m.d4UnmatchedElsewhere++
        }
      }
    }

    // 比對的是**抽出來的數字 token 的正規化值**，不是句子的子字串。
    // 2026-08-05 驗收實測到兩個方向都會錯：mechanism 的 `10` 會命中 claim 裡的 `10447.49`
    // （假陽性），而 mechanism 的 `23,150` 對不上 claim 的 `23150`（假陰性、千分位）。
    // 這兩者都不會讓任何測試變紅，卻剛好會灌水這裡的 traceability 數字。
    const numbersOf = (claims: typeof out.claims): Set<string> =>
      new Set(claims.flatMap(c => extractCheckedNumbers(c.claim, c.id).map(n => n.normalized)))

    const claimNumbers = numbersOf(out.claims)
    // 「可追溯」要求承載該數字的 claim 自己通過 D4——DoD 講的是 traceability，
    // 只算「數字有出現在某條 claim 裡」答不出那題（那條 claim 自己可能根本沒有證據）。
    const traceableNumbers = numbersOf(out.claims.filter((_, i) => audits[i]?.checks.includes('D4')))

    for (const chain of out.cascadeChains) {
      for (const n of extractCheckedNumbers(chain.mechanism, '')) {
        m.mechanismNumbers++
        if (claimNumbers.has(n.normalized))
          m.mechanismCovered++
        if (traceableNumbers.has(n.normalized))
          m.mechanismTraceable++
      }
    }
  }
}

export function renderMetrics(m: Metrics): string[] {
  return [
    '【1】claim 產出率',
    `  新聞則數：${m.news}｜cascadeChain 數：${m.chains}｜claim 總數：${m.claims}`,
    `  每則新聞平均 claim：${m.news === 0 ? 'n/a' : (m.claims / m.news).toFixed(2)}`,
    `  每條 chain 平均 claim：${m.chains === 0 ? 'n/a' : (m.claims / m.chains).toFixed(2)}`,
    `  零 claim 的新聞所含 chain 數：${m.chainsOfClaimlessNews}`,
    `  kind 分佈：${JSON.stringify(m.byKind)}｜claimType 分佈：${JSON.stringify(m.byClaimType)}`,
    '',
    '【2】D1 grounding 率（★最關鍵的數字）',
    `  fact claim 中「D2/D3 過濾後仍有 ≥1 ref」：${pct(m.factGrounded, m.factClaims)}`,
    '',
    '【3】D4 通過率（分母：claimType = named-number）',
    `  ${pct(m.namedNumberPassedD4, m.namedNumberClaims)}`,
    '',
    '【4】ref 淘汰（三桶分開；合成一桶看不出是自編來源還是抄錯日期）',
    `  過濾後留存的 ref 數：${m.refsKept}`,
    `  D2 幻覺 url：${m.refsDroppedD2}｜D3 未知 seriesId：${m.refsDroppedD3Unknown}｜D3 asOf 不符：${m.refsDroppedD3AsOf}`,
    // 淘汰數全為 0 時這三個數字才是重點：它區分「模型很乾淨」與「模型根本沒掛 ref」。
    `  claim 的 ref 組成：無 ref ${m.claimsNoRef}｜有 citation ${m.claimsWithCitationRef}｜有 series ${m.claimsWithSeriesRef}`,
    '',
    '【5】mechanism 具名數字（分母＝所有 chain 的 mechanism 受檢數字）',
    `  分母：${m.mechanismNumbers}`,
    `  a. 涵蓋（出現在任一 claim 句）：${pct(m.mechanismCovered, m.mechanismNumbers)}`,
    `  b. 可追溯（出現在通過 D4 的 claim 句）：${pct(m.mechanismTraceable, m.mechanismNumbers)}`,
    '',
    '【5.5】D4 掛不上的數字是哪一類（三分：前兩桶意義完全不同，別合看）',
    `  等於某個序列點的值 → **auto-attach 的 recall 缺口**：${m.d4UnmatchedIsSeriesPoint}`,
    `  在 block 裡但不是序列點值 → delta／變動%（刻意不定義 ref 種類）：${m.d4UnmatchedInBlock}`,
    `  不在快照 block 裡（來自新聞、或真的沒依據）：${m.d4UnmatchedElsewhere}`,
    '',
    '【6】D6 改判與 safeParse 淘汰',
    `  D6 改判（模型自報 kind 與句型不符）：${m.kindReclassified}`,
    '  claim safeParse 淘汰數：見檔頭（由 analyst-claims 的計數器實際回報，不是推測）',
    '  >30 截斷：見執行期 stderr 的 [analyst-claims] warn（無 warn ＝ 無截斷）',
  ]
}
