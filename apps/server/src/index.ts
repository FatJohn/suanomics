import process from 'node:process'
import { serve } from '@hono/node-server'
import { createAuditRepo } from '@suanomics/jobs'
import { checkStartupConfig, formatStartupConfigReport } from '@suanomics/shared'
import { warnLlmConcurrencyBudgetOnce } from './agents/fanout-concurrency.js'
import { createApp } from './http/app.js'
import { createServerRunner } from './jobs/create-server-runner.js'

const audit = createAuditRepo()

let httpServer: ReturnType<typeof serve> | undefined
let runner: ReturnType<typeof createServerRunner> | undefined

// 關的順序有意義：先讓 HTTP 停止收新請求，再等 job 收尾。反過來做的話，runner 已經
// 停了、HTTP 還在收 enqueue，那些 job 會排進一個不再消費的佇列。
function gracefulShutdown(): void {
  const closed = httpServer === undefined
    ? Promise.resolve()
    : new Promise<void>((resolve) => { httpServer?.close(() => resolve()) })
  closed
    .then(() => runner?.stop({ timeoutMs: 30_000 }))
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
}

async function main(): Promise<void> {
  // 缺主線設定就停在這裡，而不是讓 process 起來、每個 job 與每個請求各自撞一次同一個缺。
  // 次要設定缺了只大聲 log、服務照起（少一個資料源不該讓整條 pipeline 停擺）。
  // 判定本身是純函式、在 @suanomics/shared 有測試；這裡只負責印出來與決定要不要活。
  const startupConfig = checkStartupConfig('server', process.env)
  for (const line of formatStartupConfigReport(startupConfig)) {
    if (line.level === 'error')
      console.error(line.message)
    // eslint-disable-next-line no-console -- 檢查通過時的單行 startup log
    else console.log(line.message)
  }
  if (startupConfig.fatal.length > 0) {
    console.error('[startup-config] server 缺少必要設定，停止啟動。補齊上列變數後重新部署。')
    process.exit(1)
  }

  // LLM fanout 並行預算：四個常數各自都吃 env 覆寫，這裡用「實際生效值」（含覆寫）
  // 算一次有效全域尖峰，超標不擋啟動（設定過大不該讓服務起不來）、但要跟其他
  // startup-config 問題一樣大聲 log——這正是防呆要防的形狀：改一個看起來無害的
  // 並行數字、全綠上線、尖峰靜默翻倍（見 fanout-concurrency.ts 的事故脈絡）。
  // 同一個 once-guard 現在也被 callAgentLLM 共用，server 啟動只是它的第一個呼叫點。
  warnLlmConcurrencyBudgetOnce()

  // job 狀態現在只活在這個 process 的記憶體裡，所以上一次執行留下的 queued/active row
  // **不可能**有人接手——不像從前還有外部服務存著那份佇列。開機一律無條件標成 failed，
  // 靠下一次觸發補；不清的話同 payload 會被當成 already-inflight 永遠擋著。
  // ★ 代價是 server 重啟會殺掉 CLI 正在跑的那一筆，所以兩者不要同時跑（plan D9）。
  //
  // ★ 這裡要 await 完才能開始收請求。它掃的是整張表、沒有窗，所以若與第一批請求交錯，
  //   會把那些請求剛 insert 的 row 一起標成 failed——輪詢方在 markActive 蓋回去之前
  //   看到的就是 `failed`，正是這裡要消滅的那種假告警。回收失敗只 log、不擋啟動。
  try {
    const reclaimed = await audit.failAllInflight('server restarted')
    if (reclaimed > 0)
      console.error(`[server] failed ${reclaimed} inflight job row(s) left by the previous process`)
  }
  catch (err) {
    console.error('[server] inflight reconcile failed:', err)
  }

  runner = createServerRunner()
  const app = createApp({ enqueue: runner.enqueue, runner })
  runner.start()
  // eslint-disable-next-line no-console -- 單行 startup log
  console.log(`[server] ${Object.keys(runner.stats()).length} job kinds registered`)

  const port = Number(process.env.PORT ?? 3000)
  httpServer = serve({ fetch: app.fetch, port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://localhost:${info.port}`)
  })

  process.on('SIGTERM', gracefulShutdown)
  process.on('SIGINT', gracefulShutdown)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error('[server] startup failed:', err)
    process.exit(1)
  })
}
