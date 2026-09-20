#!/usr/bin/env tsx

// daily-brief 的 CLI 入口。它自己起 runner 跑到完（含 chain 出去的 analyze、
// podcast-generate、podcast-tts），不再是「丟進 queue 等別人跑」的 thin enqueuer。
import process from 'node:process'
import { parseTimeoutMs, runJobCli } from './lib/run-job-cli.js'

async function main() {
  // 日期必要參數：從前的預設是 UTC 曆日，而報告日是台北曆日——台北清晨不帶參數手跑
  // 會安靜地產出前一天的報告。與 podcast-generate / podcast-tts 的 --date 同一條紀律。
  const date = process.argv[2]
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('usage: pnpm brief:generate <YYYY-MM-DD>（台北曆日、必要參數）[--timeout=N]')
    process.exit(2)
  }
  await runJobCli({
    kind: 'daily-brief',
    payload: { date },
    timeoutMs: parseTimeoutMs(process.argv.slice(2)),
    label: `running daily-brief for ${date}...`,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
