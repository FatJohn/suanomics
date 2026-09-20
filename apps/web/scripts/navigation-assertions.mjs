/* eslint-disable no-console -- 這支是 CLI reporter，印出斷言結果就是它的產出 */
/**
 * 導覽斷言 harness。
 *
 * 為什麼存在：換日掉層別、返回掉日期與層別，這兩種回歸都是獨立複查讀出來
 * 的，不是測試抓到的。純函式那層覆蓋是滿的——`reader-route`／`carriedQuery`／`back-link`
 * 每條規則都用突變驗過——缺的是**元件有沒有正確接線**。實測過：把 `AppBackLink` 裡的
 * `hasInternalHistory` 判斷反相（＝把「返回掉日期與層別」的 bug 原封裝回去），`pnpm --filter web test`
 * 仍然全綠。這支腳本守的就是那一層。
 *
 * **它守什麼、不守什麼**（別把綠燈當成「導覽沒問題」的證明）：
 * 守 — 返回落點（站內返回、直接進站的 fallback）、換日落在正確的路徑（含回到最新一天
 *      走的 `/` 分支）並保留層別、`?date=` 與非法 `?view=` 的正規化、未知 query 進站
 *      留著但不沿著切層擴散、redirect 觸發時不順手把它丟掉。每條都是「做完這串動作之後
 *      網址是什麼」。
 *      ★ 這裡刻意不寫「報告層換日不長出 `?view=report`」：把 `carriedQuery` 改成吐
 *      `{ view: 'report' }` 之後那條照樣綠——guard 的正規化會洗掉它，所以那條擋的是
 *      路徑不是這個 query。README 的斷言表寫的是同一件事，兩邊要一起改。
 * 不守 — 頁面內容對不對（只比網址，不看畫面上是哪一天的報告）、瀏覽器上一頁／下一頁、
 *        兩個刻意不改的連結（`AppHeader.vue` 的 brand、`BriefNewsView.vue` 那句「請從
 *        今日簡報挑一則」）、中鍵與修飾鍵點擊（那條手動驗過，自動化要開新
 *        分頁、成本不成比例）、任何**新增**的導覽點——這裡列的是已知的路徑，新增一個
 *        沒有走 `carriedQuery`／`AppBackLink` 的連結，這支腳本不會知道。
 *        還有一種**素材缺席與元件壞掉分不開**的情形：`.source-more` 若因元件回歸而整批
 *        消失，探測拿到的就是「當天沒有站內分析頁」，兩條記 SKIP。加啟發式去猜是哪一種
 *        會製造假紅，所以這裡選擇讓 SKIP 看得見，由讀的人判斷。
 *
 * 為什麼是腳本而不是 test suite：與 `layout-assertions` 同一個理由——需要真實的 history
 * 與 router，jsdom 量不到；讓 CI 每次都裝瀏覽器、build、起 server 的代價不值得。
 * 用 playwright-core 而非 playwright，是因為前者沒有下載瀏覽器的 postinstall（這個 repo
 * 的 pnpm allowBuilds 會擋掉它），改走系統 Chrome。
 *
 * 素材缺席時**記成 SKIP 並印出原因**，不發假 PASS：本機只有一天報告、或當天的來源都沒有
 * 站內分析頁時，相關斷言沒有素材可跑。斷言總數會看得見地掉下來。
 *
 * 用法：
 *   pnpm dev:server                  # 另一個 terminal（要有資料）
 *   pnpm dev:web                     # 再一個
 *   pnpm --filter web nav:assert
 *   pnpm --filter web nav:assert --url http://localhost:5174
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { judge } from './navigation-assertions.judge.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPORT_PATH = resolve(HERE, 'navigation-assertions.latest.json')

/** 讀者面就緒的三個終局狀態，與 layout-assertions 同一組（有報告／沒報告／載入失敗）。 */
const READER_READY = '.synoptic, .brief-empty, .brief-status-error'

function parseArgs(argv) {
  const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://localhost:5173'
  return { baseUrl: url.replace(/\/$/, '') }
}

const pathOf = page => page.evaluate(() => window.location.pathname + window.location.search)

/** 等網址真的變了再量——SPA 導覽不會觸發 navigation event。逾時就回當下的值，讓斷言去 FAIL。 */
async function clickAndSettle(page, selector) {
  const before = await pathOf(page)
  await page.click(selector)
  await page
    .waitForFunction(prev => window.location.pathname + window.location.search !== prev, before, { timeout: 5000 })
    .catch(() => {})
  await page.waitForTimeout(200)
  return pathOf(page)
}

async function gotoReader(page, baseUrl, path) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle', timeout: 20_000 })
  await page.waitForSelector(READER_READY, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

/**
 * 先探素材：有幾天報告、佐證層有沒有帶站內分析頁的來源。
 *
 * 這兩樣決定哪些 scenario 跑得起來。探不到不是失敗——是本機資料的狀態，記進 skipReason。
 */
async function probeFixtures(page, baseUrl) {
  // ★ 連不到就往上拋（由 main 收成 exit 2）。第一版把它 catch 成空 dates，於是
  //   `--url http://localhost:9999` 會印「0 條斷言、9 條跳過」然後 **exit 0**——
  //   什麼都沒驗到，離開碼卻與全過一樣。那正是這支腳本要防的形狀。
  const res = await fetch(`${baseUrl}/api/brief/dates`)
  if (!res.ok)
    throw new Error(`GET /api/brief/dates 回 ${res.status}（api server 起來了嗎？）`)
  const dates = (await res.json()).dates ?? []

  const latest = dates[0]
  let newsPath = null
  if (latest) {
    await gotoReader(page, baseUrl, `/d/${latest}?view=evidence`)
    newsPath = await page.evaluate(() => document.querySelector('a.source-more')?.getAttribute('href') ?? null)
  }
  return { dates, latest, older: dates[1], newsPath }
}

/**
 * 每個 scenario 回 `{ expected, actual }` 或 `{ skipReason }`。
 *
 * 刻意用 `dates[0]` 與 `dates[1]`：往更舊的方向走不會撞到「回到最新一天時路徑是 `/`」
 * 那個特例，那條另外由「回到最新」的斷言涵蓋（見 `carriedQuery` 的單元測試）。
 */
function buildScenarios({ latest, older, newsPath }) {
  const noDates = latest ? null : '拿不到 /api/brief/dates（server 沒起來，或本機沒有報告）'
  const noSecondDay = older ? null : '本機只有一天報告，換日跑不起來'
  const noNews = newsPath ? null : '當天的來源都沒有站內分析頁（.source-more 不存在）'

  return [
    {
      label: '從佐證層點進單則新聞再返回，回到原本那天那一層',
      skipReason: noDates ?? noNews,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${latest}?view=evidence`)
        await clickAndSettle(page, 'a.source-more')
        await page.waitForSelector('a.link-back', { timeout: 10_000 })
        return { expected: `/d/${latest}?view=evidence`, actual: await clickAndSettle(page, 'a.link-back') }
      },
    },
    {
      label: '直接開單則新聞頁（沒有站內上一頁）時，返回落在首頁',
      skipReason: noNews,
      async run(page, baseUrl, context) {
        // 新的 context 才是「直接從外部連結開啟」——同一個分頁 goto 會留下 history.state.back
        const fresh = await context.browser().newContext()
        const p = await fresh.newPage()
        try {
          await p.goto(`${baseUrl}${newsPath}`, { waitUntil: 'networkidle', timeout: 20_000 })
          await p.waitForSelector('a.link-back', { timeout: 10_000 })
          const back = await p.evaluate(() => window.history.state?.back ?? null)
          return {
            expected: '/',
            actual: await clickAndSettle(p, 'a.link-back'),
            detail: [`history.state.back = ${JSON.stringify(back)}`],
          }
        }
        finally {
          await fresh.close()
        }
      },
    },
    {
      label: '從 /sources 返回，回到原本那天那一層',
      skipReason: noDates,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${latest}?view=evidence`)
        await clickAndSettle(page, 'a[href="/sources"]')
        await page.waitForSelector('a.link-back', { timeout: 10_000 })
        return { expected: `/d/${latest}?view=evidence`, actual: await clickAndSettle(page, 'a.link-back') }
      },
    },
    {
      label: '在佐證層換日，留在佐證層',
      skipReason: noDates ?? noSecondDay,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${latest}?view=evidence`)
        return { expected: `/d/${older}?view=evidence`, actual: await clickAndSettle(page, 'button[aria-label="看更舊的簡報"]') }
      },
    },
    {
      // ★ 標籤只寫它擋得住的：把 carriedQuery 改成吐 `{ view: 'report' }` 之後這條照樣綠，
      //   因為 guard 的正規化會把 `?view=report` 洗掉。它實際擋的是「換日落在錯的路徑」。
      label: '在報告層換日，落在前一天的報告層',
      skipReason: noDates ?? noSecondDay,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${latest}`)
        return { expected: `/d/${older}`, actual: await clickAndSettle(page, 'button[aria-label="看更舊的簡報"]') }
      },
    },
    {
      label: '?date= 導到 canonical 的 /d/:date',
      skipReason: noDates,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/?date=${latest}`)
        return { expected: `/d/${latest}`, actual: await pathOf(page) }
      },
    },
    {
      label: '非法的 ?view= 被拿掉',
      skipReason: noDates,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${latest}?view=bogus`)
        return { expected: `/d/${latest}`, actual: await pathOf(page) }
      },
    },
    {
      label: '未知的 query 進站時原樣留著',
      skipReason: noDates,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${latest}?foo=bar`)
        return { expected: `/d/${latest}?foo=bar`, actual: await pathOf(page) }
      },
    },
    {
      // ★ redirect 觸發時的 query 保留：A8 走的是「不觸發 redirect」那條路，把
      //   `{ ...rest, view }` 改成只留 view 之後它照樣綠。這條補上那個組合。
      label: 'redirect 觸發時，未知的 query 不會被順手丟掉',
      skipReason: noDates,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${latest}?foo=bar&view=bogus`)
        return { expected: `/d/${latest}?foo=bar`, actual: await pathOf(page) }
      },
    },
    {
      // ★ 回到最新一天走的是 `target === props.latest ? '/' : ...` 的另一條分支，
      //   前面那兩條換日斷言都只走「更舊」的方向、碰不到它。
      label: '換日回到最新一天時落在 /，層別照樣帶著',
      skipReason: noDates ?? noSecondDay,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${older}?view=evidence`)
        return { expected: '/?view=evidence', actual: await clickAndSettle(page, 'button[aria-label="看更新的簡報"]') }
      },
    },
    {
      label: '切層不把未知的 query 帶著走',
      skipReason: noDates,
      async run(page, baseUrl) {
        await gotoReader(page, baseUrl, `/d/${latest}?foo=bar`)
        return { expected: `/d/${latest}?view=evidence`, actual: await clickAndSettle(page, 'a.layer-tab:not(.current)') }
      },
    },
  ]
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome' })
  }
  catch (err) {
    console.error('無法啟動系統 Chrome。playwright-core 不自帶瀏覽器，請確認本機裝了 Google Chrome。')
    console.error(String(err instanceof Error ? err.message : err).split('\n')[0])
    process.exit(2)
  }
}

async function runAll(page, context, baseUrl, scenarios) {
  const results = []
  for (const s of scenarios) {
    if (s.skipReason) {
      results.push({ label: s.label, skipReason: s.skipReason })
      continue
    }
    try {
      results.push({ label: s.label, ...await s.run(page, baseUrl, context) })
    }
    catch (err) {
      // 跑不完不是 SKIP：素材在、動作失敗，那正是這支腳本要抓的東西
      results.push({ label: s.label, expected: '（跑完）', actual: `執行中斷：${String(err instanceof Error ? err.message : err).split('\n')[0]}` })
    }
  }
  return results
}

async function main() {
  const { baseUrl } = parseArgs(process.argv.slice(2))
  const browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  let fixtures
  try {
    fixtures = await probeFixtures(page, baseUrl)
  }
  catch {
    console.error(`\n無法載入 ${baseUrl}。dev server 起來了嗎？（pnpm dev:web，或用 --url 指定 port）`)
    await browser.close()
    process.exit(2)
  }

  const results = await runAll(page, context, baseUrl, buildScenarios(fixtures))
  await context.close()
  await browser.close()

  const { assertions, skipped, failed } = judge(results)
  for (const a of assertions) {
    console.log(`\n${a.pass ? 'PASS' : 'FAIL'}  ${a.label}`)
    for (const line of a.detail) console.log(`        ${line}`)
  }
  for (const s of skipped)
    console.log(`\nSKIP  ${s.label} — ${s.reason}`)

  await mkdir(dirname(REPORT_PATH), { recursive: true })
  // 與 layout-assertions 同一個取捨：這是最後一次執行的紀錄、不是 golden file，
  // 刻意不寫時間戳，讓同樣的資料重跑時不會多一筆純噪音的 diff。
  await writeFile(REPORT_PATH, `${JSON.stringify({ baseUrl, fixtures, totalAssertions: assertions.length, failed, skipped, assertions }, null, 2)}\n`, 'utf8')

  console.log(`\n${assertions.length} 條斷言，${failed} 條 FAIL${skipped.length > 0 ? `，${skipped.length} 條跳過` : ''}。報告：${REPORT_PATH}`)
  // ★ 全部跳過＝什麼都沒驗到。素材缺席是合法狀態，但它的離開碼不該與「全過」一樣——
  //   單條跳過仍是 0（總數掉下來看得見），一條都沒跑到才升級成 2。
  if (assertions.length === 0) {
    console.error('\n一條斷言都沒跑到（素材全缺）。本機有報告資料嗎？')
    process.exit(2)
  }
  process.exit(failed > 0 ? 1 : 0)
}

await main()
