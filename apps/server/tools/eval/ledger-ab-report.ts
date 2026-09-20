import type { CallNarrativeWriterResult } from '../../src/agents/narrative-writer.js'
import type { TraceabilityMetrics } from './ledger-traceability.js'

export type Arm = 'A1' | 'A2' | 'B'

export interface ArmResult {
  date: string
  arm: Arm
  file: string
  newsCount: number
  audit: CallNarrativeWriterResult['audit']
  sections: number
  chars: number
  trace: TraceabilityMetrics
}

export interface ArmSummary {
  arm: Arm
  days: number
  /** narrative degrade 成 null 的天數——分母裡有它，其他平均才讀得懂 */
  failedDays: number
  numbers: number
  matched: number
  chars: number
  sections: number
  claimIdsStripped: number
  claimCitationSections: number
  claimCitationUrlsDropped: number
  unsupportedFactClaims: number
  factClaims: number
}

export function pct(num: number, den: number): string {
  return den === 0 ? 'n/a' : `${((num / den) * 100).toFixed(1)}%`
}

export function summarizeArm(results: readonly ArmResult[], arm: Arm): ArmSummary {
  const rows = results.filter(r => r.arm === arm)
  const sum = (f: (r: ArmResult) => number): number => rows.reduce((a, r) => a + f(r), 0)
  return {
    arm,
    days: rows.length,
    failedDays: rows.filter(r => r.audit.failed).length,
    numbers: sum(r => r.trace.totals.total),
    matched: sum(r => r.trace.totals.matched),
    chars: sum(r => r.chars),
    sections: sum(r => r.sections),
    claimIdsStripped: sum(r => r.audit.claimIdsStripped),
    claimCitationSections: sum(r => r.audit.claimCitationSections),
    claimCitationUrlsDropped: sum(r => r.audit.claimCitationUrlsDropped),
    unsupportedFactClaims: sum(r => r.trace.unsupportedFactClaims),
    factClaims: sum(r => r.trace.factClaims),
  }
}

export interface PairedDaily {
  /** 資料裡出現過的日期數。與 `days` 不同就代表有日子被丟掉了，判定要說出來。 */
  requestedDays: number
  /** 三臂齊全且分母非 0 的天數 */
  days: number
  /** A 兩臂的平均勝過 B 的天數。方向一致性比幅度可靠——幅度受單日 LLM 波動主宰。 */
  aWins: number
  /**
   * **A1 單臂**勝過 B 的天數。與 `aWins` 分開記是因為 pairwise judge 比的是 A1，
   * 混用兩者會讓「兩個方法同向」講得比證據強（2026-08-08 實跑：A 平均 5/5、A1 單臂 4/5）。
   */
  a1Wins: number
  /** 逐日 (A1,A2 平均 − B) 的百分點差，未排序。 */
  effects: number[]
  medianEffect: number
  /** 逐日 |A1 − A2|，同臂雜訊的典型值。 */
  medianNoise: number
}

function median(xs: readonly number[]): number {
  if (xs.length === 0)
    return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0)
}

/**
 * 逐日配對比較。**不能只看彙總**：把所有天的分子分母加總會讓分母大的那一天主導，
 * 一個 5/5 天同向的效果會被稀釋成「沒過雜訊底線」（2026-08-08 全量實跑就是這個形狀——
 * 彙總說 12.5pt vs 雜訊 8.1pt 判不足以宣稱，逐日配對是 5/5 同向、中位效果 15.9pt
 * 對中位雜訊 2.5pt）。彙總丟掉的正是配對結構。
 *
 * 缺臂或分母為 0 的日子直接跳過——那天沒有可比的東西，補 0 會把它算成「沒有效果」。
 */
export function pairedDaily(results: readonly ArmResult[]): PairedDaily {
  const byDate = new Map<string, Map<Arm, ArmResult>>()
  for (const r of results) {
    const m = byDate.get(r.date) ?? new Map<Arm, ArmResult>()
    m.set(r.arm, r)
    byDate.set(r.date, m)
  }
  const effects: number[] = []
  const noises: number[] = []
  let aWins = 0
  let a1Wins = 0
  for (const m of byDate.values()) {
    const a1 = m.get('A1')
    const a2 = m.get('A2')
    const b = m.get('B')
    if (!a1 || !a2 || !b)
      continue
    if (a1.trace.totals.total === 0 || a2.trace.totals.total === 0 || b.trace.totals.total === 0)
      continue
    const rate = (r: ArmResult): number => (r.trace.totals.matched / r.trace.totals.total) * 100
    const effect = (rate(a1) + rate(a2)) / 2 - rate(b)
    effects.push(effect)
    noises.push(Math.abs(rate(a1) - rate(a2)))
    if (effect > 0)
      aWins++
    if (rate(a1) > rate(b))
      a1Wins++
  }
  return {
    requestedDays: byDate.size,
    days: effects.length,
    aWins,
    a1Wins,
    effects,
    medianEffect: median(effects),
    medianNoise: median(noises),
  }
}

export interface ReportInput {
  started: string
  finished: string
  dates: readonly string[]
  limit: number
  failures: readonly string[]
  calls: number
  costUsd: number
  narrativeModel: { provider: string, model: string }
  analystModel: { provider: string, model: string }
  results: readonly ArmResult[]
  outDir: string
}

/**
 * 判定用符號檢定（每天勝負當成一次硬幣），不用平均值——幅度受單日 LLM 波動主宰。
 *
 * `0.5^n` 是**單側**值（只問「A 是不是每天都贏」）：5 天 ≈ 3.1%、4 天 6.25%。
 * 字面上的「全同向」不指定方向，機率是它的兩倍——這兩個標籤混用會讓信心被高估一倍，
 * 所以輸出裡兩個都印。3 天以下就算全勝也講不出話，這裡明說而不是讓讀者自己想。
 *
 * 另外兩個會讓判定過度自信的洞，都在這裡堵掉：
 * - 缺臂被靜默丟掉的日子（4 天可比、16 天被丟，仍然照 4 天下結論）。
 * - 每天只贏 0.01pt 的「全同向」（方向一致只是雜訊剛好同號）。
 */
export function verdict(p: PairedDaily): string {
  const lines: string[] = []
  const dropped = p.requestedDays - p.days
  if (dropped > 0)
    lines.push(`⚠ **丟掉 ${dropped} 天**（缺臂或分母為 0）：下面的判定只根據剩下的 ${p.days} 天，不是全部樣本。`)

  if (p.days === 0) {
    lines.push('**沒有可比的日子**——這一輪量不出任何東西，不要從彙總欄硬讀結論。')
    return lines.join('\n')
  }
  // 單側：只問「A 是不是每天都贏」。字面上的「全同向」（不指定方向）機率是這個值的兩倍。
  const oneSided = (0.5 ** p.days * 100).toFixed(1)
  const allSame = p.aWins === p.days

  if (allSame && p.days >= 4) {
    lines.push(`**${p.days}/${p.days} 天 A 勝**（若無效果，「A 每天都贏」的隨機機率 ${oneSided}%，**單側**；`
      + `不指定方向的「全同向」是它的兩倍 ${(Number(oneSided) * 2).toFixed(1)}%）。`)
    if (p.medianEffect < p.medianNoise) {
      lines.push(`但**逐日效果中位數 ${p.medianEffect.toFixed(1)}pt 小於同臂雜訊中位數 ${p.medianNoise.toFixed(1)}pt**`
        + '——方向一致可能只是雜訊剛好同號，不足以宣稱效果。')
    }
    else {
      lines.push('→ 方向可以講：ledger 讓讀者面的數字更容易連回證據。幅度不要引用單一數字。')
    }
  }
  else if (allSame) {
    lines.push(`**${p.days}/${p.days} 天 A 勝、但只有 ${p.days} 天**（單側隨機機率 ${oneSided}%）→ 方向偏 A，樣本不足以下定論。`)
  }
  else if (p.aWins > p.days / 2) {
    lines.push(`**${p.aWins}/${p.days} 天 A 勝**——方向偏 A 但不一致，不足以宣稱效果；把不同向的那幾天拉出來看是什麼形態。`)
  }
  else {
    lines.push(`**${p.aWins}/${p.days} 天 A 勝**——沒有方向可言，不得宣稱 ledger 改善了 traceability。`)
  }

  if (p.a1Wins !== p.aWins) {
    lines.push(`⚠ 上面用的是 **A1／A2 平均**。改用 **A1 單臂**比是 ${p.a1Wins}/${p.days} 天——`
      + '兩者結論不同時，任何與 A1 產物綁在一起的指標（例如 pairwise judge 比的就是 A1）不得與這裡的結論互相佐證。')
  }
  return lines.join('\n')
}

function armRow(s: ArmSummary): string {
  return `| ${s.arm} | ${s.days}（失敗 ${s.failedDays}） | ${s.matched}/${s.numbers}（${pct(s.matched, s.numbers)}） `
    + `| ${s.claimCitationSections}/${s.sections}（${pct(s.claimCitationSections, s.sections)}） `
    + `| ${s.claimIdsStripped} | ${s.claimCitationUrlsDropped} | ${s.chars} |`
}

export function renderArmReport(p: ReportInput): string {
  const a1 = summarizeArm(p.results, 'A1')
  const a2 = summarizeArm(p.results, 'A2')
  const b = summarizeArm(p.results, 'B')
  const noise = Math.abs(a1.matched / Math.max(1, a1.numbers) - a2.matched / Math.max(1, a2.numbers)) * 100
  const effect = Math.abs(a1.matched / Math.max(1, a1.numbers) - b.matched / Math.max(1, b.numbers)) * 100
  const paired = pairedDaily(p.results)

  return [
    '# narrative 消費 claim ledger 的 A/B ＋ traceability',
    '',
    `執行：${p.started} → ${p.finished}`,
    `narrative-writer：${p.narrativeModel.provider}/${p.narrativeModel.model}｜analyst-tier1：${p.analystModel.provider}/${p.analystModel.model}`,
    `樣本：canary ${p.dates.join('、')}${p.limit > 0 ? `（--limit ${p.limit}）` : ''}`,
    `LLM call ${p.calls} 筆｜cost $${p.costUsd.toFixed(4)}`,
    `失敗跳過：${p.failures.length} 筆${p.failures.length > 0 ? `\n${p.failures.map(f => `  - ${f}`).join('\n')}` : '（無）'}`,
    '',
    '臂別：A1／A2 ＝ `NARRATIVE_LEDGER_ENABLED=true`（同設定跑兩次）、B ＝ 關閉（今日 prod 行為）。',
    '`ANALYST_CLAIMS_ENABLED` 三臂全開——變因只有「narrative 有沒有吃 ledger」。',
    '',
    '## 彙總',
    '',
    '| 臂 | 天數 | ① 讀者面數字對到 ledger | ② citationUrls 由 claim 反推 | claimId 幻覺 | claim url 對不上 | 總字數 |',
    '|---|---|---|---|---|---|---|',
    armRow(a1),
    armRow(a2),
    armRow(b),
    '',
    '**② 那一欄不要拿來做 A/B 比較**：B 臂沒吃 ledger、section 的 `claimIds` 必為空，',
    '反推率因此**恆為 0**——那是定義使然，不是量出來的發現。它只有在 A 臂內部有意義',
    '（「有 ledger 時，有多少段的出處真的由 claim 決定」）。',
    '',
    `**① 的分母兩臂不同**（A1 ${a1.numbers}、B ${b.numbers}）：讀者面寫了幾個數字本身就是模型行為，`,
    '會隨臂別變。比例的變化同時混著「分子變了」與「分母變了」，要一起看逐日表的絕對數。',
    '',
    `彙總層（把所有天的分子分母加總）：同臂雜訊 ${noise.toFixed(1)}pt、A1 vs B 差距 ${effect.toFixed(1)}pt。`,
    '**但彙總不是判準**——它讓分母大的那一天主導，會把逐日一致的效果稀釋掉。判準看下一節。',
    '',
    '## 判準：逐日配對',
    '',
    `可比天數 ${paired.days}／${paired.requestedDays}（A 均勝 ${paired.aWins} 天、A1 單臂勝 ${paired.a1Wins} 天；`
    + `逐日效果 ${paired.effects.map(e => e.toFixed(1)).join('、')}）。`,
    `逐日效果中位數 ${paired.medianEffect.toFixed(1)}pt、逐日同臂雜訊中位數 ${paired.medianNoise.toFixed(1)}pt。`,
    '',
    verdict(paired),
    '',
    '**方向比幅度可靠**：逐日幅度受單日 LLM 波動主宰（同臂雜訊在某些日子可以到 20pt 以上），',
    '所以「A 贏了幾天」是比「平均贏幾個百分點」更該拿去做決定的數字。',
    '',
    '## unsupported fact claim 分佈',
    '',
    `A1：${a1.unsupportedFactClaims}/${a1.factClaims} 條 fact claim 沒有任何 evidenceRef（${pct(a1.unsupportedFactClaims, a1.factClaims)}）。`,
    'ledger 是三臂共用的同一份，所以這個數字與臂別無關——它量的是 analyst 那一層，',
    '放在這裡是因為判斷閾值要等這個分佈才能定。',
    '',
    '## 逐日',
    '',
    '| 日期 | 臂 | 新聞 | narrative | 段數 | 字數 | ①對到/總數 | ②反推段 | claimId 幻覺 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...p.results.map(r =>
      `| ${r.date} | ${r.arm} | ${r.newsCount} | ${r.audit.failed ? 'NULL' : 'ok'} | ${r.sections} | ${r.chars} `
      + `| ${r.trace.totals.matched}/${r.trace.totals.total} | ${r.audit.claimCitationSections} | ${r.audit.claimIdsStripped} |`),
    '',
    '## 這份量測不能證明什麼',
    '',
    '- **不含可讀性判定**。字數變化不等於變好或變差；可讀性要跑 pairwise：',
    `  \`pnpm brief:quality --a ${p.outDir}/<date>-A1.json --b ${p.outDir}/<date>-B.json --sources ${p.outDir}/<date>-sources.json\``,
    '- 序列是固定 fixture、不是 canary 那幾天的真實行情 → 模型引用序列的動機低於真實 pipeline，',
    '  series ref 與能對到 ledger 的比例都是下限。',
    '- 不含 tier2（canary 只跑 tier1）、不含 editor 的 dailyThesis 與 viewpoints，',
    '  所以這裡的 brief 比 prod 的窄；讀者面數字的分母也因此偏小。',
    '- ① 的比對是**數值**層級（`closeEnough`）：讀者面寫「約 2.3 萬點」而 ledger 寫「23150」',
    '  這種同義不同寫法算不對到。它量的是「機器能不能把數字連回證據」，不是「作者有沒有依據」。',
    '',
  ].join('\n')
}
