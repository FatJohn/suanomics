/**
 * `pnpm fixtures:check-canary` 的進入點。
 *
 * `apps/server/tools/eval/fixtures/canary-example/` 是公開 repo 的合成 fixture，
 * 公司名與 URL 都已刻意編造成一眼可辨（`example.com`），但證券代號沒有那種
 * 天然的「假貨長相」——00888 這種數字組合看起來很假，實際上可能真的被
 * TWSE 指派過。這支只查這一層：對 TWSE 的 `codeQuery` 端點做前綴查詢，
 * 確認 fixture 裡用的每個 ticker 都不是任何真實證券的代號或代號前綴。
 *
 * ★ **00xxx 沒有「安全區段」可以取代這支檢查。** 低位段一樣在被指派——主動式
 *   ETF 的 `00400A`–`00410A` 掛牌比 006xx 還晚卻配在更低的號碼，`00625K`、
 *   `00631L`–`00635U` 也都在交易中。任何「挑某個區間就安全」的規則都是假的，
 *   只有實際查詢算數（2026-09-11 實測，見 canary-example/README.md）。
 *
 * **刻意不進 CI**（同 `src/fixtures/cli.ts` 的理由）：它依賴外部服務當下
 * 可不可用，放進 CI 只會製造與程式碼無關的紅燈，然後大家開始習慣忽略紅燈。
 * 它的定位是「增補 fixture 之後跑一次」與「定期人工體檢」。打不到對方
 * 不算失敗，只有真的撞到真實證券才 exit 1。
 */
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { collectFixtureTickers, findTickerCollisions } from '../eval/canary-example-tickers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
// 這支只查合成 fixture（`canary-example`），不查需要自備的真實
// `canary/`——那組不隨公開 repo 發佈，內容是真實媒體全文，本來就不該虛構化。
const CANARY_EXAMPLE_DIR = resolve(HERE, '../eval/fixtures/canary-example')

const TIMEOUT_MS = 15_000
const THROTTLE_MS = 300

/**
 * codeQuery 的回應形狀跟預期不符。
 *
 * 刻意不用 `TypeError`：Node 的 `fetch` 網路失敗時丟的就是 `TypeError: fetch failed`，
 * 拿 `instanceof TypeError` 當判準會把「打不到對方」也當成形狀漂移往外丟，
 * 正好違反這支「打不到不算失敗」的章程。
 */
class CodeQueryShapeError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms))
}

async function lookupCode(ticker: string): Promise<readonly string[] | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const url = `https://www.twse.com.tw/rwd/zh/api/codeQuery?query=${encodeURIComponent(ticker)}`
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'suanomics/0.1 (canary ticker check)' },
    })
    if (!res.ok)
      return null
    const body = await res.json() as { suggestions?: unknown }
    // 形狀漂移**不能**回 null。null 的語意是「打不到對方」，而打不到會 exit 0——
    // codeQuery 哪天改掉回應形狀，這支就會安靜地每次都說「沒撞到」。寧可炸。
    if (!Array.isArray(body.suggestions))
      throw new CodeQueryShapeError(`codeQuery 回應形狀變了（query=${ticker}）：suggestions 不是陣列，收到 ${JSON.stringify(body).slice(0, 200)}`)
    return body.suggestions.filter((s): s is string => typeof s === 'string')
  }
  catch (err) {
    if (err instanceof CodeQueryShapeError)
      throw err
    return null
  }
  finally {
    clearTimeout(timer)
  }
}

function formatReport(
  tickers: readonly { file: string, path: string, ticker: string }[],
  collisions: Awaited<ReturnType<typeof findTickerCollisions>>['collisions'],
  unreachable: Awaited<ReturnType<typeof findTickerCollisions>>['unreachable'],
): string[] {
  const lines: string[] = []
  for (const c of collisions) {
    lines.push(`COLLISION ${c.ticker.file}:${c.ticker.path} = "${c.ticker.ticker}"`)
    for (const m of c.matches)
      lines.push(`           !! 撞到真實證券 ${m.code}\t${m.name}`)
  }
  for (const u of unreachable)
    lines.push(`NO-REACH  ${u.file}:${u.path} = "${u.ticker}" — 打不到 TWSE codeQuery`)

  const reached = tickers.length - unreachable.length
  lines.push('')
  // ★ 總結行一定要報「真的查到幾個」，不是只報撞到幾個。同 src/fixtures/check.ts
  //   的理由：撈到 0 個 ticker、或全部 unreachable 時，「撞到 0 個」讀起來像
  //   全過，實際上這一輪什麼都沒驗到。
  lines.push(`共 ${tickers.length} 個 ticker：真的查到 ${reached} 個、撞到真實證券 ${collisions.length} 個、打不到 ${unreachable.length} 個`)
  if (tickers.length === 0)
    lines.push('!! 掃描到 0 個 ticker——這代表 collectFixtureTickers 沒撈到東西，不代表 fixture 乾淨，先查掃描邏輯。')
  else if (reached === 0)
    lines.push('!! 一個都沒真的查到（全部 unreachable）——這一輪對 fixture 是否乾淨沒有任何驗證力。')
  return lines
}

async function main(): Promise<void> {
  const tickers = collectFixtureTickers(CANARY_EXAMPLE_DIR)
  const { collisions, unreachable } = await findTickerCollisions(tickers, async (ticker) => {
    const result = await lookupCode(ticker)
    // 對方是政府站台，逐次之間節流——不管查到什麼都要等，不只是成功時才等。
    await sleep(THROTTLE_MS)
    return result
  })

  for (const line of formatReport(tickers, collisions, unreachable))
    console.error(line)
  process.exit(collisions.length > 0 ? 1 : 0)
}

await main()
