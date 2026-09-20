/* eslint-disable no-console -- 這支是 CLI reporter，印出斷言結果就是它的產出 */
/**
 * 版面斷言 harness。
 *
 * 為什麼存在：DESIGN.md「版面驗證不能只看截圖」要求用 getBoundingClientRect 量碰撞與
 * 溢出，但在這支腳本之前，所有量測都是 session 內用瀏覽器手做的——repo 裡沒有可重跑的
 * 產物，下一個人重現不了。這裡把當時實際抓到過東西的斷言固定下來。
 *
 * **它守什麼、不守什麼**（別把綠燈當成「版面沒問題」的證明）：
 * 守 — 字級落在級數表、頁面級水平溢出、四個器械在場／沒被圖紙裁掉／兩兩不相撞，
 *      外加前兩輪各一條狀態斷言（「正反兩面預設是收合的」／「展開真的生效」），
 *      以及 report 與 evidence 兩輪的「頁尾的 .footer-meta 沒有被播放器蓋住」。
 * 不守 — 每行字數（58ch 的推導仍是手做，要量得準得處理中英混排與標點）、視覺品質、
 *        任何 INSTRUMENTS 以外元素被 `overflow:hidden` 祖先靜默裁切的情形，以及
 *        **「某個區塊有沒有被推出首屏」**（只量碰撞、裁切與溢出，一塊被推到 y=1200
 *        照樣全綠）。
 *        footer 那條**只量 `.footer-meta` 與播放器的縱向關係**——footer 的其他內容、
 *        寬度、區段結構一概不在範圍內（它也綁死那一個 selector，尾端多一個元素就守不到）。
 *        還有**它只載 `/`（最新那一天）**：圖上器械的高度由當天的 headline 與 dailyThesis
 *        決定，所以這是內容驅動元件的單日單樣本，今天全綠只證明今天那一組內容不撞。
 *        固定高度版面就曾這樣被放過去（2026-09-07：49 個報告日裡 9 天在舊版是碰撞，報告卻記
 *        著 failed: 0）。要驗一段時間的內容，自己用 /d/YYYY-MM-DD 逐日量。
 *
 * **每行字數**與**裁切覆蓋**這兩個邊界 2026-08-02 決定**不收**：圖區裡承載文字的就是這
 * 四個器械，其餘只有 `.chart-canvas` 的純紋理 SVG（被裁不會讓任何一個字消失），擴大量測
 * 換到的覆蓋接近零、卻要維護一份例外清單。完整理由在 apps/web/README.md 的「版面斷言」節。
 *
 * 為什麼是腳本而不是 test suite：這些需要真實 layout，jsdom 量不到；而讓 CI 每次都
 * 裝瀏覽器、build、起 server 的代價不值得（2026-08-02 決定先不進 CI）。用
 * playwright-core 而非 playwright，是因為前者沒有下載瀏覽器的 postinstall——這個 repo
 * 的 pnpm allowBuilds 會擋掉它，裝了也不會有瀏覽器。改走系統 Chrome。
 *
 * 掃的輪次：四個寬度 ×（報告層 / 報告層且正反兩面展開 / 佐證層）。第二輪是後來加的——
 * 正反兩面預設收合之後，不點開就等於把它展開的版面移出斷言範圍。
 *
 * 用法：
 *   pnpm dev:web                     # 另一個 terminal
 *   pnpm --filter web layout:assert
 *   pnpm --filter web layout:assert --url http://localhost:5174
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { collect } from './layout-assertions.collect.mjs'
import { judge } from './layout-assertions.judge.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPORT_PATH = resolve(HERE, 'layout-assertions.latest.json')

/**
 * DESIGN.md Typography 的八級，加上 alarm 的手機變體 26。
 * 級數表是約束不是現況清單——量到表外的值就是 drift，要嘛吸附、要嘛先改 DESIGN.md。
 */
const TYPE_SCALE = [42, 32, 26, 24, 20, 17, 15, 13, 11]

/**
 * 圖上四個器械。桌機是「標題組與讀數帶走正常流（flex column，讀數帶 margin-top: auto 貼底）
 * ＋兩個力場標籤絕對定位」，窄版全部退成正常流；兩兩不得相撞這條在每個斷點都成立。
 *
 * `conditional` 的兩個是 `v-if`（BriefSynopticChart.vue:143,147）：`selectForces` 只在
 * 該方向真的有產業時才給力場中心，而 direction enum 只有 positive/neutral/negative，
 * 所以全正的一天 `.force-damp` 根本不渲染。把它們當必在場會讓單邊日假紅，且訊息
 * （「頁面沒載到 brief」）方向指反。缺席由 judge() 記在 detail 裡而不是判 FAIL。
 */
const INSTRUMENTS = [
  { selector: '.chart-overlay', conditional: false },
  { selector: '.force-damp', conditional: true },
  { selector: '.force-push', conditional: true },
  { selector: '.chart-stations', conditional: false },
]

/** 2560 是 4K 的實際問題現場；1024 是窄版分界，900 與 1280 各站一邊；390 是手機基準。 */
const VIEWPORTS = [
  { name: '4K', width: 2560, height: 1440 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'narrow', width: 900, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

/**
 * 兩層 Reader Layers 的元件集合不同，兩層都要掃。
 *
 * `expand` 那一輪的存在理由：正反兩面自那時起**預設收合**，於是預設那一輪量到的是
 * 收合態。這一輪讓展開後的 DOM 回到既有那五條的量測範圍——**它加到的就只有這樣**：
 * 展開的文字進入字級掃描與溢出掃描、四個器械在更長的頁面上重量一次。它**不**量欄數、
 * 不量行長，那兩件事仍然是手做的（見下面「不守」）。
 *
 * `expectVisible` 是這一輪的存在證明：`judge()` 那五條全都在正反觀點區塊的上方或與它
 * 無關（圖上四個器械＋全域字級／溢出），所以點擊即使完全失效，五條也會照樣全綠——那就是
 * 一個無法被證偽的綠燈，正是「宣稱守住的比實際大」那類教訓的複發形式。多這一條
 * 斷言之後，展開沒生效會 FAIL，而不是靜靜多印五條 PASS。找不到觸發器則**整輪跳過並記錄
 * 原因**，讓斷言總數看得見地掉下來。
 *
 * `expectHidden` 守的是那個決定本身——「預設是收合的」。少了它，元件若回歸成
 * 預設展開，第一輪不會 FAIL，而第二輪的點擊反而把它**關上**、以「點過觸發器之後仍然
 * 看不到」FAIL，訊息會把方向指反、害人往錯的地方查。
 *
 * `checkFooterTail` 只掛在 report 與 evidence 兩輪：那兩輪的頁高不同（佐證層短很多），
 * 而 report-viewpoints-open 與 report 是同一個 footer、多量一次只是重複。
 */
const ROUTES = [
  { name: 'report', path: '/', expectHidden: '.vp-columns', checkFooterTail: true },
  { name: 'report-viewpoints-open', path: '/', expand: '.vp-trigger', expectVisible: '.vp-columns' },
  { name: 'evidence', path: '/?view=evidence', checkFooterTail: true },
]

function parseArgs(argv) {
  const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://localhost:5173'
  return { baseUrl: url.replace(/\/$/, '') }
}

/**
 * 頁尾探針：捲到文件底，量最後一行與常駐播放器的縱向關係。
 *
 * 為什麼要捲到底才量：播放器是 fixed，任何位置它都蓋著視窗底部，但只有在文件末端
 * 那一段才會蓋到「再也捲不出來」的內容。2026-08-02 的實例——留給播放器的 padding
 * 掛在 .brief-landing 上，而 footer 是它在 App.vue 的兄弟節點，於是 reserve 把 footer
 * 往下推出一個空隙、卻沒有保護 footer 自己的尾巴，© 那一行整條落在播放器底下、
 * 讀者永遠看不到（桌機 dock 頂緣 833、meta 佔 846–864）。這條就是為了讓那個回歸會 FAIL。
 *
 * 放在 collect() 之後跑：它會改變捲動位置，而器械的量測雖然都是相對比較（碰撞、裁切）
 * 理論上與捲動無關，還是不要讓一個探針的副作用落在另一個量測前面。
 */
async function runFooterTailProbe(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(300)
  return page.evaluate(() => {
    const rect = (s) => {
      const el = document.querySelector(s)
      if (!el)
        return null
      const b = el.getBoundingClientRect()
      return { selector: s, top: Math.round(b.top), bottom: Math.round(b.bottom) }
    }
    return { dock: rect('.dock'), meta: rect('.footer-meta') }
  })
}

/**
 * 跑一輪的狀態探針：收合／展開有沒有真的發生。
 *
 * 這兩個值是報告 JSON 裡唯一能區分收合／展開的指紋——`collect()` 量的五件事全都在
 * 正反觀點區塊的上方或與它無關，兩輪的量測值除了頁高以外完全一樣。
 */
async function runStateProbes(page, route) {
  const measure = sel => page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el)
      return { selector: s, visible: false, height: 0 }
    const r = el.getBoundingClientRect()
    return { selector: s, visible: r.height > 0, height: Math.round(r.height) }
  }, sel)

  const collapsedProbe = route.expectHidden ? await measure(route.expectHidden) : null
  if (!route.expand)
    return { collapsedProbe, expandProbe: null }

  const trigger = page.locator(route.expand)
  if (await trigger.count() === 0)
    return { skip: `找不到 ${route.expand}（viewpoints 為 null，或觸發器改了名）` }

  await trigger.first().click()
  await page.waitForTimeout(400)
  return { collapsedProbe, expandProbe: await measure(route.expectVisible) }
}

async function main() {
  const { baseUrl } = parseArgs(process.argv.slice(2))

  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome' })
  }
  catch (err) {
    console.error('無法啟動系統 Chrome。playwright-core 不自帶瀏覽器，請確認本機裝了 Google Chrome。')
    console.error(String(err instanceof Error ? err.message : err).split('\n')[0])
    process.exit(2)
  }

  const runs = []
  const skipped = []
  let failed = 0

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await context.newPage()

    for (const route of ROUTES) {
      const url = `${baseUrl}${route.path}`
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 })
      }
      catch {
        console.error(`\n無法載入 ${url}。dev server 起來了嗎？（pnpm dev:web，或用 --url 指定 port）`)
        await browser.close()
        process.exit(2)
      }
      // `networkidle` 只保證「網路安靜了」，不保證 Vue 已經把資料畫出來。打遠端時實測會
      // 撞到：2026-08-02 對 prod 的第一次執行回 2 FAIL ＋ 1 輪 SKIP，三次重跑都 68/0——
      // 那是載入時序，不是版面。等到頁面進入某個**終局狀態**再量：有報告（力場圖）、
      // 沒報告（空狀態）、或載入失敗。三者都等不到才讓斷言去報「器械不在場」。
      await page
        .waitForSelector('.synoptic, .brief-empty, .brief-status-error', { timeout: 20_000 })
        .catch(() => {})
      // 圖是 ResizeObserver 驅動的，換 viewport 後要讓它跑完一輪再量。
      await page.waitForTimeout(400)

      const probes = await runStateProbes(page, route)
      if (probes.skip) {
        skipped.push({ viewport: vp.name, layer: route.name, reason: probes.skip })
        continue
      }

      const raw = await page.evaluate(collect, { typeScale: TYPE_SCALE, instruments: INSTRUMENTS })
      raw.expandProbe = probes.expandProbe
      raw.collapsedProbe = probes.collapsedProbe

      if (route.checkFooterTail) {
        const tail = await runFooterTailProbe(page)
        // 播放器只在有 podcast 的日子渲染。量不到就**記成跳過**、不要發一條假 PASS——
        // 「今天沒東西可量」與「量過而且沒問題」在報告裡必須看得出差別。
        if (tail.dock && tail.meta)
          raw.footerTail = tail
        else
          skipped.push({ viewport: vp.name, layer: route.name, reason: `頁尾斷言跳過：找不到 ${tail.dock ? '.footer-meta（頁尾那一行改了名？）' : '.dock（當天沒有 podcast，或播放器改了名）'}` })
      }

      const assertions = judge(raw)
      failed += assertions.filter(a => !a.pass).length
      runs.push({ viewport: vp.name, width: vp.width, height: vp.height, layer: route.name, url, assertions, raw })
    }

    await context.close()
  }

  await browser.close()

  for (const run of runs) {
    console.log(`\n${run.viewport} ${run.width}×${run.height} · ${run.layer}`)
    for (const a of run.assertions) {
      console.log(`  ${a.pass ? 'PASS' : 'FAIL'}  ${a.label}`)
      for (const line of Array.isArray(a.detail) ? a.detail : [a.detail])
        console.log(`        ${line}`)
    }
  }

  // 跳過的輪次要看得見：斷言總數少了一截而畫面上沒說為什麼，就是靜默縮小涵蓋範圍。
  for (const s of skipped)
    console.log(`\nSKIP  ${s.viewport} · ${s.layer} — ${s.reason}`)

  const total = runs.reduce((n, r) => n + r.assertions.length, 0)
  const report = {
    // 這份報告是**最後一次執行的紀錄**，不是 golden file：runs[].raw 的量測值取自跑的當下
    // 那份報告內容，所以換一天重跑、即使版面一行沒動也會有 diff。刻意不寫時間戳，是為了讓
    // 「同樣內容、同樣版面」重跑時至少不會多一筆純噪音的 diff。
    baseUrl,
    typeScale: TYPE_SCALE,
    instruments: INSTRUMENTS,
    totalAssertions: total,
    failed,
    skipped,
    runs,
  }
  await mkdir(dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`\n${total} 條斷言，${failed} 條 FAIL${skipped.length > 0 ? `，${skipped.length} 輪跳過` : ''}。報告：${REPORT_PATH}`)
  process.exit(failed > 0 ? 1 : 0)
}

await main()
