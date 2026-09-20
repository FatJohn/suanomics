/* eslint-disable no-console -- smoke script：輸出就是產物，判讀由人做 */
/**
 * `/info` 疊加的真實端點 smoke。
 *
 *   cd apps/server && pnpm exec tsx tools/cli/nasdaq-overlay-smoke.ts
 *
 * fixture 測不到、只有打真的端點才會現形的三件事：
 * 1. URL 與必要標頭真的通（不帶 User-Agent 時端點是直接斷線、不是 4xx）
 * 2. 真實回應的形狀真的能解（欄位名、巢狀層級、千分位與美式日期）
 * 3. 真實的 netChange 真的對得上真實的前一列收盤（一致性檢查的容差夠不夠）
 *
 * 它只印結果、不做 process 層的 pass/fail——判讀由人做（同 narrative-smoke.ts 的定位）。
 * 若跑的當下 `/historical` 已自行補上當日列，(1) 會看不到疊加；(3) 會刻意砍掉最新一列
 * 重現 pipeline 在台北清晨拿到的落後狀態，那才是本修法的實際場景。
 */
import { fetchNasdaqSeries, overlayInfoPoint, parseNasdaqInfo } from '../../src/market-data/nasdaq-client.js'
import { SERIES_SPECS } from '../../src/market-data/series-config.js'

// 刻意吃真的 SERIES_SPECS 而非手捏一份：這樣新增的 nasdaq 序列會自動納入，
// 也順便驗證線上設定本身（symbol 打錯會在這裡就吵）。
const NASDAQ_SPECS = SERIES_SPECS.filter(s => s.source === 'nasdaq')

async function rawInfo(symbol: string): Promise<unknown> {
  const res = await fetch(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=index`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  return await res.json() as unknown
}

async function main(): Promise<void> {
  for (const spec of NASDAQ_SPECS) {
    const symbol = spec.sourceCode
    console.log(`\n===== ${spec.seriesId}（${symbol}） =====`)

    const points = await fetchNasdaqSeries(spec)
    const sorted = [...points].sort((a, b) => b.date.localeCompare(a.date))
    console.log(`fetchNasdaqSeries → ${points.length} points, 最新 3 筆:`)
    console.log(JSON.stringify(sorted.slice(0, 3)))

    const info = parseNasdaqInfo(await rawInfo(symbol), symbol)
    console.log(`parseNasdaqInfo → ${JSON.stringify(info)}`)

    // 重現 pipeline 實際拿到的落後狀態：砍掉最新一列，看疊加會不會用真實的 netChange
    // 對上真實的前一列收盤、把當日補回來。
    const lagging = sorted.slice(1)
    const overlaid = overlayInfoPoint(lagging, info)
    const recovered = overlaid.length === lagging.length + 1 && overlaid[0]?.date === sorted[0]?.date
    console.log(`模擬 historical 落後一列（最新 = ${lagging[0]?.date}）→ 疊加後最新 = ${overlaid[0]?.date}`)
    console.log(`  一致性檢查通過並補回當日 → ${recovered ? 'PASS' : 'FAIL'}`)

    // 硬 gate 反例：同一份真實 payload、只把 marketStatus 換成 Open，必須拒絕。
    const live = await rawInfo(symbol) as { data: Record<string, unknown> }
    const intraday = { ...live, data: { ...live.data, marketStatus: 'Open' } }
    console.log(`  marketStatus=Open 的同一份 payload → ${parseNasdaqInfo(intraday, symbol) === null ? 'PASS（拒絕）' : 'FAIL（誤收）'}`)
  }
}

await main()
