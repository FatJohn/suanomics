#!/usr/bin/env tsx
/* eslint-disable no-console -- 量測腳本：輸出就是產物，判讀由人做 */
/**
 * 用 **prod 真實 brief** 量 traceability 與 unsupported fact claim 的分佈
 * （閾值要靠這個定；`ledger:ab` 量到的是 canary、tier1-only 的下限值）。
 *
 * 這支**不打 LLM、不動 prod**，只讀已經產出的 brief。
 *
 * ## 怎麼把 brief 撈下來
 *
 * `/api/brief/by-date` **會剝掉 `claimLedger`**（讀者面政策），所以不能用它，要直接讀 DB：
 * 每個報告日取 `daily_briefs.brief_json` 整欄（`where brief_date = <日期>`），原樣存成
 * `apps/server/.eval-out/prod-briefs/<日期>.json`——一個檔就是一份完整的 MarketBrief JSON。
 * 怎麼連進你的資料庫取值由部署者自備，這個 repo 不附撈取腳本。
 *
 * ★ 不要把撈取指令寫成 heredoc 貼進 JSDoc：`* ` 前綴會讓 heredoc 的終止符失效，複製出來的
 * 指令不會報錯，只會靜靜產出 0 bytes。存檔後先確認第一個字元是 `{`，再丟給下面那條。
 *
 * ## 跑
 *
 * ```bash
 * cd apps/server && pnpm prod:ledger-metrics --briefs .eval-out/prod-briefs
 * ```
 */
import type { MarketBrief } from '@suanomics/shared'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { checkNarrativeClaimBinding } from '../../src/agents/narrative-claim-binding.js'
import { pct } from '../eval/ledger-ab-report.js'
import { measureTraceability } from '../eval/ledger-traceability.js'
import { argValue } from './lib/smoke-args.js'

const dir = argValue('--briefs')
if (dir === undefined) {
  console.error('用法：pnpm prod:ledger-metrics --briefs <放 brief JSON 的目錄>')
  process.exit(1)
}

const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
if (files.length === 0) {
  console.error(`${dir} 裡沒有 .json——先照檔頭的指令把 prod brief 撈下來`)
  process.exit(1)
}

console.log('# prod ledger traceability')
console.log('')
console.log('| 日期 | ledger claims | ①對到/總數 | ① 比例 | viewpoints 追溯 | fact | 無 ref | 無 ref 比例 | binding unbound |')
console.log('|---|---|---|---|---|---|---|---|---|')

let totalMatched = 0
let totalNumbers = 0
let totalVpMatched = 0
let totalVpNumbers = 0
let totalFact = 0
let totalUnsupported = 0
let totalUnbound = 0
let totalChecked = 0
const noLedger: string[] = []
const bindingHits: string[] = []

for (const f of files) {
  const brief = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as MarketBrief
  const date = f.replace(/\.json$/, '')
  // 沒有 ledger 的日子不能混進分母：它們是旗標開之前產的，①必然是 0，
  // 算進去會把整體比例往下拉而看起來像 ledger 沒用
  if (brief.claimLedger === undefined) {
    noLedger.push(date)
    continue
  }
  const m = measureTraceability(brief)
  totalMatched += m.totals.matched
  totalNumbers += m.totals.total
  totalVpMatched += m.viewpoints.matched
  totalVpNumbers += m.viewpoints.total
  totalFact += m.factClaims
  totalUnsupported += m.unsupportedFactClaims
  // 收緊判準：數字要對回**本段掛的** claim，不是整個 ledger 池。①與它不會一起動——
  // 2026-08-09 就是①41/42 全綠、binding 1/26 抓到那句正負號相反的敘述。
  const b = brief.narrative
    ? checkNarrativeClaimBinding(brief.narrative, brief.claimLedger ?? [])
    : { total: 0, unbound: 0, details: [] as const }
  totalUnbound += b.unbound
  totalChecked += b.total
  for (const d of b.details)
    bindingHits.push(`${date} sec${d.sectionIndex}.${d.field}=${d.value}`)
  console.log(`| ${date} | ${m.ledgerClaims} | ${m.totals.matched}/${m.totals.total} | ${pct(m.totals.matched, m.totals.total)} `
    + `| ${m.viewpoints.matched}/${m.viewpoints.total}（${pct(m.viewpoints.matched, m.viewpoints.total)}） `
    + `| ${m.factClaims} | ${m.unsupportedFactClaims} | ${pct(m.unsupportedFactClaims, m.factClaims)} `
    + `| ${b.unbound}/${b.total} |`)
}

console.log('')
console.log(`合計：① ${totalMatched}/${totalNumbers}（${pct(totalMatched, totalNumbers)}）——**參考值、不是 gate**`)
// viewpoints 另計、刻意不併進①：併進去會改動①的分母、讓 2026-08 之前的基線失去可比性。
// 2026-08-14 之前這一面只有 50-60%，且查不到的幾乎都是挑戰主軸的反向數字。
console.log(`viewpoints 追溯 ${totalVpMatched}/${totalVpNumbers}（${pct(totalVpMatched, totalVpNumbers)}）`
  + `——另計、不併進①；C 類（讀者面有、ledger 查不到）的主要觀察面`)
console.log(`unsupported fact claim ${totalUnsupported}/${totalFact}（${pct(totalUnsupported, totalFact)}）`
  + `——這個閾值已於 2026-08-09 降級為健康度監控，不當結案指標`)
console.log('')
console.log(`**結案指標**：binding unbound ${totalUnbound}/${totalChecked}（${pct(totalUnbound, totalChecked)}）`)
if (bindingHits.length > 0) {
  console.log('命中明細（每一筆都要人判是不是真問題）：')
  for (const h of bindingHits)
    console.log(`  - ${h}`)
}
else if (totalChecked > 0) {
  console.log('（本批零命中）')
}
if (noLedger.length > 0)
  console.log(`\n⚠ 跳過 ${noLedger.length} 份沒有 claimLedger 的 brief（旗標開之前產的）：${noLedger.join('、')}`)

console.log('')
console.log('限制：')
console.log('- **binding 只涵蓋 narrative section**：headline／summary／reasoningChain 沒有 claimIds 掛載點，')
console.log('  無從收緊，仍只有①的整池比對。同類錯誤若發生在 summary，這個數字看不見（這是明確的取捨）。')
console.log('- **binding 擋不住語意改寫**：claim 若有掛進本段，narrative 仍可改寫它的時間口徑')
console.log('  （2026-08-09 的「單日→全週累積」），而數字照樣對得回去。')
console.log('- 這裡**沒有 A/B 對照**——prod 只有旗標開的那一臂。①的絕對值不能與 `ledger:ab` 的 canary 數字直接比')
console.log('  （分母的組成不同：prod 有 tier2、editor thesis 與 viewpoints）。')
console.log('- **不含 D2／D3**：那兩項要當日快照實際餵入的序列點，brief 裡只留了 dataFreshness 的')
console.log('  (seriesId, asOf)、沒有 value。硬湊一個假 value 會讓同一次 runDeterministicChecks 的')
console.log('  D4 一起算錯，寧可不報。要量 D2／D3 請走 `pnpm ledger:ab`（它有真的 ctx）。')
console.log('- 週日是週報特輯（weekend prompt）、週六不產——排期時要把這兩天分開看。')
process.exit(0)
