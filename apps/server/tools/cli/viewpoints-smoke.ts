#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
// 量測：同一份真實 prod brief，分「餵 claimLedger」與「不餵」兩臂
// 各跑 N 次真 LLM，比對 viewpoints 是否撿起 ledger 裡的反向數字。
//
// 為什麼要兩臂而不是只看新版：LLM 有 run-to-run 雜訊，單臂單跑量不出因果。
// 兩臂同 brief、同 prompt、同 snapshot（都給 null），唯一差異就是 ledger 有沒有進素材。
//
// 覆蓋率的量尺在 `../eval/viewpoints-coverage.ts`（有測試）。它以 `extractCheckedNumbers` 的輸出
// 為白名單（沿用中文負號、全形與修辭數字排除），再自己補上**單位**——裸比數值會把
// 「產能提升 30%」與「逾 30 萬顆」判成同一個 30，第一版就是這樣得出假命中的。
//
// 用法：cd apps/server && pnpm exec tsx --env-file-if-exists=.env \
//   tools/cli/viewpoints-smoke.ts .eval-out/prod-briefs/2026-08-12.json 3

import type { CascadeChain, EvidenceClaim, Viewpoints } from '@suanomics/shared'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { runViewpointsDebate } from '../../src/agents/viewpoints-debate.js'
import { claimIsEligible, claimSurfacedIn } from '../eval/viewpoints-coverage.js'
import { enforceLlmRunBudget, hasYesFlag } from './lib/llm-run-budget.js'
import { estimateViewpointsSmoke } from './lib/llm-run-estimates.js'

interface BriefFile {
  dailyThesis?: string
  headline?: string
  summary?: string
  cascadeChains?: CascadeChain[]
  claimLedger?: EvidenceClaim[]
}

function viewpointsText(v: Viewpoints): string {
  return [...v.supportPoints, ...v.riskPoints, v.netRead].join('\n')
}

// 亂碼偵測（heuristic）：2026-08-12 的 with-ledger 臂出現 4 行夾雜壞字的輸出，且通過了
// compliance gate 與 ViewpointsSchema。既有的 stripControlChars 治的是控制字元、掃不到
// 這種被替換掉的 CJK。CJK 擴充 A 區在正常台股財經文字裡幾乎不會出現，拿它當旗標。
// ★ 這只是 proxy：`羮債`（美債）、`殛利率`（毛利率）這種落在常用區的壞字它抓不到，
// 所以量到的數字是**下界**。
const CJK_EXT_A = /[\u3400-\u4DBF]/u

function mojibakeLines(v: Viewpoints): number {
  return [...v.supportPoints, ...v.riskPoints, v.netRead].filter(s => CJK_EXT_A.test(s)).length
}

// B 要的是**挑戰側**的覆蓋。全文覆蓋會把支持側算進來——08-12 的 c34（中興電獲利）、
// c35（華城毛利率）正是 thesis 說資金流向的重電股，它們出現在 supportPoints 完全不代表
// 反向事實被撿起。兩個數字都報，主指標看 risk。
function riskText(v: Viewpoints): string {
  return v.riskPoints.join('\n')
}

/**
 * 一條 claim 算「被 viewpoints 撿起」＝ 它的受檢數字以**相同數值與單位**出現在文字裡。
 * 沒有受檢數字的 claim 不計入分母——對它們這個量法無效。
 *
 * 單位比對在 `../eval/viewpoints-coverage.ts`，不是這裡土炮的：第一版直接比裸數值，把
 * 「產能提升 30%」與「逾 30 萬顆」判成同一個 30（獨立複查抓到）。
 */
function ledgerCoverage(claims: readonly EvidenceClaim[], text: string): {
  hit: string[]
  eligible: number
} {
  const hit: string[] = []
  let eligible = 0
  for (const c of claims) {
    if (!claimIsEligible(c))
      continue
    eligible += 1
    if (claimSurfacedIn(c, text))
      hit.push(c.id)
  }
  return { hit, eligible }
}

async function main(): Promise<void> {
  // --yes 先濾掉再取位置參數，否則 `viewpoints-smoke.ts brief.json 3 --yes`
  // 會把 `--yes` 誤當成 runsArg（這支腳本沒有 commander、位置參數靠陣列索引取）。
  const confirmed = hasYesFlag(process.argv.slice(2))
  const [path, runsArg] = process.argv.slice(2).filter(a => a !== '--yes')
  if (!path) {
    console.error('用法：viewpoints-smoke.ts <brief.json> [runs] [--yes]')
    process.exit(1)
  }
  const runs = Number(runsArg ?? '2')
  const brief = JSON.parse(readFileSync(path, 'utf8')) as BriefFile
  const thesis = brief.dailyThesis
  if (!thesis) {
    console.error(`${path} 沒有 dailyThesis、無法辯論`)
    process.exit(1)
  }
  const ledger = brief.claimLedger ?? []
  enforceLlmRunBudget(estimateViewpointsSmoke(runs), {
    confirmed,
    errLog: line => console.error(line),
    exit: process.exit,
  })
  console.log(`brief=${path}｜ledger=${ledger.length} 條｜每臂 ${runs} 次`)
  console.log(`thesis：${thesis}\n`)

  const base = {
    thesis,
    headline: brief.headline ?? '',
    summary: brief.summary ?? '',
    // 兩臂都給 null：snapshot 不在 brief JSON 裡，但它同時缺席於兩臂、不構成混淆
    marketSnapshot: null,
    cascadeChains: brief.cascadeChains ?? [],
  }

  for (const arm of ['no-ledger', 'with-ledger'] as const) {
    console.log(`\n===== ${arm} =====`)
    for (let i = 0; i < runs; i++) {
      // 本專案 agent 幾乎全 input-bound，而 ledger 不截斷會讓三次呼叫的 input 同步變長；
      // 不收 token 就等於「沒量成本就宣稱可出貨」。
      let inTokens = 0
      const onCallRecord = (r: { tokensIn: number }): void => {
        inTokens += r.tokensIn
      }
      const out = await runViewpointsDebate(
        arm === 'with-ledger'
          ? { ...base, claimLedger: ledger, onCallRecord }
          : { ...base, onCallRecord },
      )
      if (!out) {
        console.log(`run${i}: degraded null`)
        continue
      }
      const risk = ledgerCoverage(ledger, riskText(out))
      const all = ledgerCoverage(ledger, viewpointsText(out))
      const garbled = mojibakeLines(out)
      const garbledNote = garbled > 0 ? `｜★亂碼 ${garbled} 行` : ''
      console.log(
        `run${i}: risk 覆蓋 ${risk.hit.length}/${risk.eligible}（${risk.hit.join(',') || '無'}）｜全文 ${all.hit.length}/${all.eligible}｜in≈${inTokens} tok${garbledNote}`,
      )
      // ★ 支持側與淨讀一定要落檔：ledger 的增益若主要落在支持側，等於把報告推得
      // 更靠向 thesis——與動機相反。只印 risk 行會把唯一能反駁自己的素材丟掉（2026-08-12
      // 第一版就是這樣，複查抓到）。
      for (const p of out.supportPoints)
        console.log(`   support> ${p}`)
      for (const p of out.riskPoints)
        console.log(`   risk> ${p}`)
      console.log(`   netread> ${out.netRead}`)
    }
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
