// 跨日用量查詢：`pnpm --filter @suanomics/pipeline run llm:usage --days 7`（日界是 created_at 的台北日期）。
import process from 'node:process'
import { parseArgs } from 'node:util'
import { closeDb } from '../db/client.js'
import { getDailyUsage } from '../db/repos/llm-calls-repo.js'
import { renderDailyUsage } from './llm-usage-format.js'

async function main(): Promise<void> {
  const { values } = parseArgs({ args: process.argv.slice(2).filter(a => a !== '--'), options: { days: { type: 'string', default: '7' } } })
  const days = Number(values.days)
  if (!Number.isInteger(days) || days <= 0)
    throw new Error(`--days 必須是正整數，收到 ${values.days}`)
  console.warn(renderDailyUsage(await getDailyUsage(days)))
}

main()
  .catch((err: unknown) => {
    console.error('[llm:usage] failed:', err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
