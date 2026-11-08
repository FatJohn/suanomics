import type { SeriesSpec } from './series-config.js'
import type { RawPoint } from './transform.js'
import { getLatestPoints, upsertMarketDataPoints } from '@suanomics/db/repos/market-data-repo'
import { fetchFredObservations } from './fred-client.js'
import { fetchNasdaqSeries } from './nasdaq-client.js'
import { SERIES_SPECS } from './series-config.js'
import { fetchTaifexSeries } from './taifex-client.js'
import { applySpread, applyTransform } from './transform.js'
import { fetchTwseSeries } from './twse-client.js'

export interface RefreshDeps {
  fredApiKey: string
  fetchFred?: typeof fetchFredObservations
  fetchTwseSeries?: (spec: SeriesSpec) => Promise<RawPoint[]>
  fetchTaifexSeries?: (spec: SeriesSpec) => Promise<RawPoint[]>
  fetchNasdaqSeries?: (spec: SeriesSpec) => Promise<RawPoint[]>
  upsert?: typeof upsertMarketDataPoints
  getLatest?: typeof getLatestPoints
}

export interface RefreshResult {
  seriesProcessed: number
  pointsUpserted: number
  failures: string[]
}

// transform 'spread' 之外的種類才走 applyTransform；narrow 給 transform.ts 的簽名。
type DirectTransform = 'level' | 'yoy' | 'mom-diff'

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function refreshMarketData(deps: RefreshDeps): Promise<RefreshResult> {
  const fetchFred = deps.fetchFred ?? fetchFredObservations
  const fetchTwse = deps.fetchTwseSeries ?? fetchTwseSeries
  const fetchTaifex = deps.fetchTaifexSeries ?? fetchTaifexSeries
  const fetchNasdaq = deps.fetchNasdaqSeries ?? fetchNasdaqSeries
  const upsert = deps.upsert ?? upsertMarketDataPoints
  const getLatest = deps.getLatest ?? getLatestPoints

  const direct = SERIES_SPECS.filter(s => s.transform !== 'spread')
  const derived = SERIES_SPECS.filter(s => s.transform === 'spread')

  const failures: string[] = []
  let pointsUpserted = 0

  // (1) 非 derived 序列逐條（序列少、不需並發）。
  for (const spec of direct) {
    try {
      const raw = await fetchOneRaw(spec, { fredApiKey: deps.fredApiKey, fetchFred, fetchTwse, fetchTaifex, fetchNasdaq })
      const points = applyTransform(spec.transform as DirectTransform, raw)
      pointsUpserted += await upsert(points.map(p => ({ seriesId: spec.seriesId, date: p.date, value: p.value })))
    }
    catch (err) {
      failures.push(spec.seriesId)
      console.warn(`[refreshMarketData] ${spec.seriesId} failed:`, errMessage(err))
    }
  }

  // (2) derived spread 最後跑：兩腿讀「已落地」值、即使腿剛失敗 DB 仍有舊值可算。
  for (const spec of derived) {
    try {
      const [legA, legB] = spec.spreadOf ?? []
      if (!legA || !legB)
        throw new Error(`missing spreadOf for ${spec.seriesId}`)
      const a = await getLatest(legA, 10)
      const b = await getLatest(legB, 10)
      const points = applySpread(a, b)
      pointsUpserted += await upsert(points.map(p => ({ seriesId: spec.seriesId, date: p.date, value: p.value })))
    }
    catch (err) {
      failures.push(spec.seriesId)
      console.warn(`[refreshMarketData] ${spec.seriesId} failed:`, errMessage(err))
    }
  }

  return { seriesProcessed: SERIES_SPECS.length, pointsUpserted, failures }
}

interface FetchCtx {
  fredApiKey: string
  fetchFred: typeof fetchFredObservations
  fetchTwse: (spec: SeriesSpec) => Promise<RawPoint[]>
  fetchTaifex: (spec: SeriesSpec) => Promise<RawPoint[]>
  fetchNasdaq: (spec: SeriesSpec) => Promise<RawPoint[]>
}

/** 有自己抓取路徑的 source（`derived` 不在此列：它從已落地的兩腿算出來、不對外抓）。 */
type FetchableSource = Exclude<SeriesSpec['source'], 'derived'>

/**
 * source → 抓取路徑。
 *
 * 用 `Record<FetchableSource, ...>` 而不是 if-chain，是要讓「新增一種 source」變成編譯期
 * 的事：往 `SeriesSpec['source']` 加一個值而沒補這張表，tsc 當場紅。
 * 原本的 if-chain 以 twse 作 fallthrough——新 source 忘了加分支不會報錯，
 * 而是安靜地拿去打 TWSE，再由 parser 判成空資料，看起來像「那天沒公布」。
 */
const SOURCE_ADAPTERS: Record<FetchableSource, (spec: SeriesSpec, ctx: FetchCtx) => Promise<RawPoint[]>> = {
  fred: (spec, ctx) => {
    // 缺 key → fred 全 skip 進 failures（throw 由 caller 收）。
    if (!ctx.fredApiKey)
      throw new Error('missing FRED api key — skip fred series')
    return ctx.fetchFred({
      fredId: spec.sourceCode,
      apiKey: ctx.fredApiKey,
      limit: spec.frequency === 'monthly' ? 15 : 10,
    })
  },
  twse: (spec, ctx) => ctx.fetchTwse(spec),
  taifex: (spec, ctx) => ctx.fetchTaifex(spec),
  nasdaq: (spec, ctx) => ctx.fetchNasdaq(spec),
}

async function fetchOneRaw(spec: SeriesSpec, ctx: FetchCtx): Promise<RawPoint[]> {
  // derived 走的是 (2) 那條路，照理不會進來；真的進來代表 spec 的 source 與 transform
  // 對不起來（`derived` 卻不是 `spread`），這時要當場失敗、不要拿去打 TWSE。
  if (spec.source === 'derived')
    throw new Error(`${spec.seriesId}: source=derived 卻不是 spread transform、無抓取路徑`)
  return SOURCE_ADAPTERS[spec.source](spec, ctx)
}
