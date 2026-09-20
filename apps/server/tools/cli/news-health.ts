#!/usr/bin/env tsx
/* eslint-disable no-console -- 這支的產出就是給人讀的報告 */
// news:health — 直接查 DB 回答「素材層現在有沒有真的把內文抓回來」。
//
// 為什麼要有這支：換 feed 之後的驗收條件是「那幾個來源要出現 scrape 而不是
// 100% rss-excerpt」，而 HTTP 200 完全判不出來——feed 可能 item 全空（udn 的
// 空殼端點）、可能停更十年（CSIS）、可能只有錨點 markup（Google News 代理）。
// 三種都是 200，三種在這份報告裡各有自己的旗標。
//
// 只讀不寫，可以安全指向任何一個 DATABASE_URL，用來取變更前的對照數字。

import process from 'node:process'
import { closeDb } from '@suanomics/db/client'
import { getNewsHealthRaw } from '@suanomics/db/repos/news-health'
import { formatNewsHealthReport } from '../../src/news/health-format.js'
import { summarizeNewsHealth } from '../../src/news/health.js'

interface CliArgs {
  windowDays: number
  json: boolean
}

const MS_PER_DAY = 86_400_000

export function parseArgs(argv: readonly string[]): CliArgs {
  let windowDays = 7
  let json = false
  for (const a of argv) {
    if (a === '--json') {
      json = true
    }
    else if (a.startsWith('--days=')) {
      const n = Number.parseInt(a.split('=')[1] ?? '', 10)
      if (Number.isFinite(n) && n > 0)
        windowDays = n
    }
  }
  return { windowDays, json }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const now = new Date()
  const windowStart = new Date(now.getTime() - args.windowDays * MS_PER_DAY)
  const raw = await getNewsHealthRaw(windowStart)
  const rows = summarizeNewsHealth(raw, now)

  if (args.json) {
    console.log(JSON.stringify({ windowDays: args.windowDays, now: now.toISOString(), sources: rows }, null, 2))
  }
  else {
    console.log(formatNewsHealthReport(rows, { windowDays: args.windowDays, now }))
  }
  await closeDb()
  // 只是報告，不因為有旗標就 exit 非 0：這支會被人在終端機直接跑，
  // 非 0 會讓它在 CI 或 && 串接裡把後面的步驟擋掉，而它沒有那個職權。
  process.exit(0)
}

main().catch((err) => {
  console.error('[news:health] uncaught', err)
  process.exit(1)
})
