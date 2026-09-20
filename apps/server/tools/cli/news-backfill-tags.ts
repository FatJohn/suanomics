import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getUntaggedNewsItems } from '@suanomics/db/repos/news-repo'
import { tagAndStore } from '../../src/news/tag.js'
import { enforceLlmRunBudget, hasYesFlag } from './lib/llm-run-budget.js'
import { estimateNewsBackfillTags } from './lib/llm-run-estimates.js'

const CHUNK = 150

// 一次性 backfill：標近窗內 taggedAt IS NULL 的 news_items。
// 用法：pnpm --filter server run news:backfill-tags [sinceDays] [--yes]（sinceDays 預設 30）。
// chunk 寫入：每 150 筆呼叫一次 tagAndStore（內部再分 BATCH_SIZE 批）、某 chunk 失敗只損該 chunk、
// 重跑會跳過已標（taggedAt 已設）。
//
// export 是為了測試能 import 這個函式、驗證預算閘門會不會擋下 tagAndStore（不用真的連
// DB／打 LLM）；main 不會在 import 當下自動跑，見檔尾 isMainModule 的守門（同 brief-rerun.ts
// 的慣例）。
//
// @param argv 去掉 node/script 路徑後的原始參數（例：['30', '--yes']）。--yes 要先濾掉再取
// 位置參數，否則 `news-backfill-tags.ts --yes` 會把 --yes 當成 sinceDays（同 viewpoints-smoke.ts
// 的教訓）。
export async function runBackfillTags(argv: readonly string[]): Promise<void> {
  const confirmed = hasYesFlag(argv)
  const [sinceDaysArg] = argv.filter(a => a !== '--yes')
  const sinceDays = Number.parseInt(sinceDaysArg ?? '30', 10) || 30
  const items = await getUntaggedNewsItems(sinceDays)
  console.warn(`[backfill-tags] ${items.length} untagged items in last ${sinceDays}d`)

  // 批次量隨未標記新聞數而動，可能撞到 500 次／尖峰 10 的專案風險門檻。這支腳本沒有
  // --limit／--dates／--replicates，縮小範圍的正確做法是調小 sinceDays（少查幾天）。
  enforceLlmRunBudget(estimateNewsBackfillTags(items.length), {
    confirmed,
    errLog: line => console.error(line),
    exit: process.exit,
    narrowingHint: `調小 sinceDays（目前 ${sinceDays} 天）`,
  })

  let done = 0
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    try {
      await tagAndStore(chunk)
      done += chunk.length
      console.warn(`[backfill-tags] tagged ${done}/${items.length}`)
    }
    catch (err) {
      console.error(`[backfill-tags] chunk @${i} failed (will remain untagged, re-run to retry):`, err)
    }
  }
  console.warn(`[backfill-tags] done, ${done}/${items.length} tagged`)
}

// 只在「這支檔案被直接執行」時才跑（同 brief-rerun.ts 的慣例）
// ——否則測試 import runBackfillTags 時，會在 import 當下就連去打 DB 與 process.exit。
const isMainModule = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
  runBackfillTags(process.argv.slice(2)).then(() => process.exit(0)).catch((err) => {
    console.error('[backfill-tags] fatal:', err)
    process.exit(1)
  })
}
