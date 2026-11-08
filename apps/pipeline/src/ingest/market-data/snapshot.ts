import type { SeriesAnchor, SeriesFreshness } from '@suanomics/shared'
import type { SeriesSection, SeriesSpec } from './series-config.js'
import { buildCrossMarketSignals, classifyFreshness, formatLagLabel, taipeiDateOf } from '@suanomics/shared'
import { SERIES_SPECS } from './series-config.js'

export interface SeriesLatest {
  spec: SeriesSpec
  points: { date: string, value: number }[] // 最新在前（points[0] 是最新）
}

// 區順序 + 區標題單一來源（ordered）：陣列序即輸出區序、繁中標題就近綁定。
// `satisfies` 釘住每個 entry 是 [section, title]、新 section 進 SeriesSection union 時
// 漏加在此會被 compiler 抓到（exhaustiveness 由下方 type 斷言保證）。
const SECTIONS = [
  ['us-macro', '美國總經'],
  ['rates-markets', '利率與市場'],
  // 美股緊鄰台股：兩個股市相鄰、方便 LLM 寫美台連動。
  ['us-equity', '美股'],
  ['taiwan', '台股'],
] as const satisfies readonly (readonly [SeriesSection, string])[]

// 若 SeriesSection 新增成員而 SECTIONS 漏加、此行 type error（缺的 section 無法 assign 到 never）。
type _ExhaustiveSections = Exclude<SeriesSection, (typeof SECTIONS)[number][0]> extends never
  ? true
  : ['SECTIONS missing section', Exclude<SeriesSection, (typeof SECTIONS)[number][0]>]
const _exhaustiveSections: _ExhaustiveSections = true
void _exhaustiveSections

// 過舊門檻（曆日）——**只剩降級路徑在用**（假日表涵蓋窗外、freshness 判 unknown 時）。
// 正常路徑改看「落後幾個發布週期」（@suanomics/shared 的 classifyFreshness）。
// 為什麼不再用它當主判：它用絕對曆日量按發布節奏更新的資料，兩頭都錯——2026-07-31 實測，
// 這組門檻把 26 行裡的 12 行判成「資料未更新」（整個美國總經區塊、M2 因 57 天發布落差
// 永遠不可見），同時又抓不到 us-sox 少一個美股交易日的靜默 T-1。
const STALE_DAYS: Record<SeriesSpec['frequency'], number> = {
  monthly: 45,
  daily: 5,
}

const MS_PER_DAY = 86_400_000

// 呼叫端傳入的錨點是 reportDate、不是執行當下的 now（見下方 resolveSeriesRenderState）——
// 補跑舊報告時真正的 now 距 latest.date 可以是數十天，用它當比較基準會讓這條本已是
// 「降級中的降級」的粗判，把當天其實齊全的資料一起判成過舊。
function calendarDaysBetween(anchor: Date, isoDate: string): number {
  const then = new Date(`${isoDate}T00:00:00Z`).getTime()
  return Math.floor((anchor.getTime() - then) / MS_PER_DAY)
}

// toFixed(2) 後去尾零：4.32 → '4.32'、3.10 → '3.1'、3.00 → '3'。
function trimTrailingZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

function withThousands(intStr: string): string {
  // 千分位只處理整數部分、符號另行拼接。
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 快照 block 實際印出來的**數值**（四捨五入之後）。
 *
 * 為什麼要單獨存在：block 對「點／億元／千人／口／張」走 `Math.round`，費半原值
 * `10447.49` 印成 `10,447 點`。模型只看得到後者，照抄天經地義，但 D4 的容差是
 * `max(0.01, |b|×1e-6)`——一個完全誠實照抄的模型必然不及格。
 * 稽核要比對的是「模型實際被給的那些表示法」，所以顯示值必須能被 code 取得。
 *
 * 它與 {@link formatSeriesValue} 的關係由**守衛測試**釘住：「從 formatter 輸出解析回來的數
 * === 本函式回傳值」，對 SERIES_SPECS 每一種 unit 都驗。單側改壞會讓該測試變紅（實測過）。
 *
 * 注意 formatter 並非每一支都呼叫本函式：`%`／`元`／`美元`／`億股` 四支直接用 `value`
 * 格式化，因為 `Number((-0.004).toFixed(2))` 是 `-0` 而 `(-0).toFixed(2)` 回 `"0.00"`，
 * 走 `shown` 會把既有的 `-0%` 顯示變成 `0%`（踩得到 us-yield-spread-10y2y、us-10y-real-rate）。
 * 兩者數值恆等，差別只在 `-0` 的字面——守衛測試對 `-0` 正規化，故那一格是它的盲點。
 */
export function displayValueOf(value: number, spec: SeriesSpec): number {
  switch (spec.unit) {
    case '%':
    case '元':
    case '美元':
    case '億股':
      return Number(value.toFixed(2))
    case '點':
    case '億元':
    case '千人':
    case '口':
    case '張':
      return Math.round(value)
  }
}

// 數字格式由 unit 決定（exhaustive switch）、正負號由 spec.kind 決定：
// - % / 元 / 美元：小數 2 位、去尾零、無千分位、無正號
// - 點 / 億元 / 千人 / 口 / 張：千分位、0 位小數；kind === 'flow' 才帶正負號
// 正負號不可由 unit 推：「億元」同時被 flow（三大法人買賣超）與 level（融資餘額）使用，
// 用 unit 判必然錯一邊——存量標成 +2,825 億元會被讀成「增加 2,825 億」。
export function formatSeriesValue(value: number, spec: SeriesSpec): string {
  const shown = displayValueOf(value, spec)
  switch (spec.unit) {
    case '%':
    case '元':
    case '美元': {
      // 這三種 unit 目前全是 level（殖利率、匯率、油價），負值自然帶負號、不需正號。
      // 仍照 kind 加正號是為了讓「標了 flow 就會顯示方向」這條規則在所有 unit 一致——
      // 否則日後新增 %-unit 的 flow 序列（例如某種變動幅度）會標了卻不生效。
      const sign = value >= 0 && spec.kind === 'flow' ? '+' : ''
      // 這裡刻意用 `value` 而非 `shown`：`Number((-0.004).toFixed(2))` 是 `-0`，
      // 而 `(-0).toFixed(2)` 回 `"0.00"`——改用 shown 會把 main 印的 `-0%` 變成 `0%`。
      // 那是**顯示行為改動**（踩得到的序列：us-yield-spread-10y2y、us-10y-real-rate），
      // 而這次改動承諾 fmt 一個字元都不改。兩者數值相同（-0 === 0），單一真相不受影響。
      return `${sign}${trimTrailingZeros(value.toFixed(2))}${spec.unit}`
    }
    case '點':
    case '億元':
    case '千人':
    case '口':
    case '張': {
      // 負號一律保留（不論 kind）；正號只有 flow 才加。早期版本在 level 走
      // `sign='' + Math.abs()`，會把負值靜默寫成正的——今日的 level 序列都不會為負
      // 所以沒出事，但那是資料湊巧、不是設計。
      const sign = shown < 0 ? '-' : (spec.kind === 'flow' ? '+' : '')
      // 點 / 億元 / 千人 / 口 / 張：數字與單位間留一個半形空白（對齊 spec 範例「23,150 點」）。
      return `${sign}${withThousands(String(Math.abs(shown)))} ${spec.unit}`
    }
    case '億股': {
      // 借券賣出餘額：億股尺度、2 位小數（去尾零）+ 千分位 + 半形空白、無正負號（存量）
      // 同上，用 value 保住 `-0` 的既有顯示。
      const fixed = value.toFixed(2)
      const dot = fixed.indexOf('.')
      const withSep = `${withThousands(fixed.slice(0, dot))}${fixed.slice(dot)}`
      return `${trimTrailingZeros(withSep)} ${spec.unit}`
    }
  }
}

// 日期標籤：monthly 取 YYYY-MM（發布月即可、日無意義）、daily 取完整日期。
function dateLabel(spec: SeriesSpec, isoDate: string): string {
  return spec.frequency === 'monthly' ? isoDate.slice(0, 7) : isoDate
}

// 流量序列（值本身帶方向）的 delta 措辭；存量（融資餘額）不在此、走差值規則。
// 「哪些序列是 flow」由 SeriesSpec.kind 認定、本表只負責措辭：新增 flow 序列時漏補措辭
// 會退化成省略 delta 描述（既有 null 路徑），而不是被誤當水準值。一致性由守衛測試釘住。
export const FLOW_PHRASES: Record<string, { posCont: string, negCont: string, toPos: string, toNeg: string }> = {
  'taiex-institutional-net': { posCont: '連續買超', negCont: '連續賣超', toPos: '由賣轉買', toNeg: '由買轉賣' },
  'us-nonfarm-payrolls': { posCont: '連續增加', negCont: '連續減少', toPos: '由減轉增', toNeg: '由增轉減' },
  'foreign-taifex-net': { posCont: '持續淨多', negCont: '持續淨空', toPos: '由淨空轉淨多', toNeg: '由淨多轉淨空' },
}

// 變化描述由 formatter 算好、analyst 照抄即可、維持「不得推算」防幻覺紀律。
// 回 null 表示省略（流量含 0 的邊界、語意模糊不硬給）。
function formatDelta(spec: SeriesSpec, latest: number, prev: number, prevWord: string): string | null {
  if (spec.kind === 'flow') {
    const flow = FLOW_PHRASES[spec.seriesId]
    if (!flow)
      return null
    if (latest > 0 && prev > 0)
      return flow.posCont
    if (latest < 0 && prev < 0)
      return flow.negCont
    if (latest > 0 && prev < 0)
      return flow.toPos
    if (latest < 0 && prev > 0)
      return flow.toNeg
    return null
  }
  if (spec.unit === '%') {
    const d = latest - prev
    const abs = trimTrailingZeros(Math.abs(d).toFixed(2))
    if (abs === '0')
      return `與${prevWord}持平`
    return `較${prevWord} ${d > 0 ? '+' : '-'}${abs} 個百分點`
  }
  // 水準值（點 / 元 / 美元 / 存量億元 / 千人 / 口 / 億股 / 張）：差值 + 變動%
  const d = latest - prev
  const sign = d >= 0 ? '+' : '-'
  // 元/美元/億股 帶 2 位小數（去尾零）；元/美元 數字與單位間無空白、其餘（點/億元/千人/口/億股）有半形空白
  const decimalUnit = spec.unit === '元' || spec.unit === '美元' || spec.unit === '億股'
  const noSpaceUnit = spec.unit === '元' || spec.unit === '美元'
  const absStr = decimalUnit
    ? trimTrailingZeros(Math.abs(d).toFixed(2))
    : withThousands(String(Math.round(Math.abs(d))))
  if (absStr === '0')
    return `與${prevWord}持平`
  const diffPart = noSpaceUnit ? `${sign}${absStr}${spec.unit}` : `${sign}${absStr} ${spec.unit}`
  if (prev === 0)
    return diffPart
  const pct = trimTrailingZeros((Math.abs(d) / Math.abs(prev) * 100).toFixed(2))
  return `${diffPart} / ${sign}${pct}%`
}

/**
 * 一條序列今天到底有沒有可用的值——三條抑制路徑集中在這裡。
 *
 * 抽出來的理由不是美觀：`selectCitableSeries` 要列的是「block 裡真的印出數字」的序列，
 * 兩邊各寫一份判斷必然漂移，而漂移的症狀是合法的 series evidenceRef 被 D3 判成幻覺
 * （清單列了、block 沒印）。共用同一個判斷讓那種漂移不可能發生。
 *
 * `warnOnDegrade` 預設關閉：假日表過期的告警是**渲染路徑**的職責，
 * 開著會讓每條序列在同一次載入中被警告兩次（block 一次、citable 清單一次）。
 */
export type SeriesRenderState
  = | { state: 'suppressed', text: string }
    | { state: 'shown', latest: { date: string, value: number }, freshness: SeriesFreshness }

export function resolveSeriesRenderState(
  item: SeriesLatest,
  now: Date,
  reportDate: string,
  opts: { warnOnDegrade?: boolean } = {},
): SeriesRenderState {
  const { spec, points } = item
  const latest = points[0]
  if (!latest)
    return { state: 'suppressed', text: '資料未更新' }

  // reportDate 是新鮮度判定與降級粗判共用的錨點。若 `Date` 解析不出來（`undefined`、空字串、
  // '2026-13-45' 這種月份超出 1-12 而被判成 Invalid Date 的值），放給下游會有兩種壞法：
  // @suanomics/shared 的 expectedAsOf 對某些 cadence 會直接拋錯（實測 weekly／irregular 對空字串
  // 丟 RangeError、monthly 對 undefined 與空字串都拋），而下面的降級粗判則是更
  // 隱蔽的 fail-open——Invalid Date 讓天數變成 NaN，`NaN > STALE_DAYS[...]` 恆為 false，
  // 過舊資料反而被放行。與其讓呼叫端撞到兩種不同的壞法，這裡先確認錨點解析得出來，
  // 解析不出來就直接抑制——寧可少顯示一條序列，不要放行未經新鮮度檢查的資料。
  //
  // 射程只到「解析不出來」：'2026-02-30' 這種月份合法、日期越界的值 JS 會靜默 roll-over
  // 成 3/2（'2026-06-31' 同理變 7/1），這道 guard 抓不到，錨點會偏移到另一天去算新鮮度。
  // 要擋那一類得另外做曆日驗證（逐欄位比對 parse 前後的年月日），本次刻意沒做。
  if (Number.isNaN(new Date(`${reportDate}T00:00:00Z`).getTime())) {
    if (opts.warnOnDegrade) {
      console.warn(
        `[snapshot] ${spec.seriesId}：報告日 ${JSON.stringify(reportDate)} 不是合法日期、`
        + `無法判定新鮮度——為避免放行過舊資料已抑制`,
      )
    }
    return { state: 'suppressed', text: '資料未更新' }
  }

  const freshness = classifyFreshness({
    seriesId: spec.seriesId,
    rule: spec.freshness,
    reportDate,
    actualAsOf: latest.date,
  })
  // 落後超過硬上限（相對期望、非曆日）就不再給數字：極舊的值對今天的報告沒有參考價值、
  // 標注也救不回來。附上實際日期讓下游知道舊到哪。
  if (freshness.state === 'stale')
    return { state: 'suppressed', text: `資料未更新（最新僅到 ${dateLabel(spec, latest.date)}）` }
  // 降級路徑：假日表涵蓋窗外算不出期望值時退回舊的絕對曆日粗判。
  // 出聲是必要的——這條路徑代表假日表過期（time-bomb 測試沒被理會），而它的症狀
  // （整批序列悄悄退回舊門檻）跟先前修掉的那個 bug 一模一樣，沒有 log 就無從察覺。
  if (freshness.state === 'unknown') {
    if (opts.warnOnDegrade) {
      console.warn(
        `[snapshot] ${spec.seriesId}：報告日 ${reportDate} 超出假日表涵蓋窗、`
        + `期望值判定停用、退回 STALE_DAYS 粗判——請更新 market-holidays.ts 的假日表`,
      )
    }
    // 粗判的比較基準是 reportDate、不是 now（同一理由見 calendarDaysBetween 的註解）。
    if (calendarDaysBetween(new Date(`${reportDate}T00:00:00Z`), latest.date) > STALE_DAYS[spec.frequency])
      return { state: 'suppressed', text: '資料未更新' }
  }

  return { state: 'shown', latest, freshness }
}

function renderRow(item: SeriesLatest, now: Date, reportDate: string): string {
  const { spec, points } = item
  const resolved = resolveSeriesRenderState(item, now, reportDate, { warnOnDegrade: true })
  if (resolved.state === 'suppressed')
    return `- ${spec.displayName}：${resolved.text}`
  const { latest, freshness } = resolved

  const prev = points[1]
  // monthly 前期講「前月」、daily 講「前值」。
  const prevWord = spec.frequency === 'monthly' ? '前月' : '前值'
  const delta = prev ? formatDelta(spec, latest.value, prev.value, prevWord) : null
  const prevPart = prev ? `、${prevWord} ${formatSeriesValue(prev.value, spec)}` : ''
  const deltaPart = delta ? `、${delta}` : ''
  // 落後標注緊接在日期之後：讓 LLM 在讀到數字的當下就知道它不是最新一期，
  // 而不是把「這是昨夜收盤」的錯誤前提寫進 thesis（靜默沿用 T-1 就是這樣發生的）。
  const lagPart = freshness.state === 'lagging' && freshness.lagCycles != null
    ? `、${formatLagLabel(spec.freshness, freshness.lagCycles)}`
    : ''
  return `- ${spec.displayName}：${formatSeriesValue(latest.value, spec)}（${dateLabel(spec, latest.date)}${lagPart}${prevPart}${deltaPart}）`
}

// 區內順序 = SERIES_SPECS 宣告順序（deterministic）；用宣告 index 排序傳入的 latest。
function declarationIndex(seriesId: string): number {
  return SERIES_SPECS.findIndex(s => s.seriesId === seriesId)
}

// 報告日的唯一實作在 `@suanomics/shared`；這裡 re-export 只為了不打斷既有的 import 路徑。
export { taipeiDateOf }

export interface CitableSeries {
  seriesId: string
  displayName: string
  /** 該序列**實際**的最新日期，不是報告日——series evidenceRef 的 asOf 要逐字等於它（D3 不做鄰近日回退）。 */
  asOf: string
}

/**
 * 可被 series evidenceRef 引用的序列。
 *
 * 快照 block 只印 displayName，模型無從得知 seriesId，於是掛不出合法的 series ref。
 * 本函式補的就是那個 handle，並且**只列在 block 裡真的印出數字的序列**——共用
 * `resolveSeriesRenderState` 保證這條一致性不會因為兩份判斷漂移而失效。
 */
export function selectCitableSeries(latest: SeriesLatest[], now: Date, reportDate: string): CitableSeries[] {
  const out: CitableSeries[] = []
  for (const item of latest) {
    const resolved = resolveSeriesRenderState(item, now, reportDate)
    if (resolved.state === 'shown') {
      out.push({
        seriesId: item.spec.seriesId,
        displayName: item.spec.displayName,
        asOf: resolved.latest.date,
      })
    }
  }
  // 與 block 區內順序同一套（宣告序），讓 prompt 的清單與上方數據表讀起來對得上。
  return out.sort((a, b) => declarationIndex(a.seriesId) - declarationIndex(b.seriesId))
}

/**
 * 可被 auto-attach 命中的快照序列點。
 *
 * 與 {@link selectCitableSeries} 的差別只有兩處，但兩處都是刻意的：
 * - **含前值點**：block 也印前值（`renderRow` 的 `prevPart`），模型真的會寫「前值為 10,910 點」。
 *   每個點帶自己的 `asOf`，所以這不是鄰近日回退，D3 的嚴格性不受影響。
 * - **帶數值**：auto-attach 要比對值。
 *
 * 為什麼不直接擴充 `selectCitableSeries`：那份清單會**逐字進 prompt**，
 * 多列前值就改動了七個 agent 之外的 tier1 prompt，這次改動承諾 prompt 一個字都不改。
 */
export function selectSeriesAnchors(latest: SeriesLatest[], now: Date, reportDate: string): SeriesAnchor[] {
  const out: SeriesAnchor[] = []
  for (const item of latest) {
    const resolved = resolveSeriesRenderState(item, now, reportDate)
    if (resolved.state !== 'shown')
      continue
    // block 實際印出來的就是這兩個點（前值缺就只有一個）。
    const points = [resolved.latest, item.points[1]].filter(p => p != null)
    for (const p of points) {
      out.push({
        seriesId: item.spec.seriesId,
        displayName: item.spec.displayName,
        asOf: p.date,
        value: p.value,
        displayValue: displayValueOf(p.value, item.spec),
      })
    }
  }
  return out.sort((a, b) =>
    declarationIndex(a.seriesId) - declarationIndex(b.seriesId) || b.asOf.localeCompare(a.asOf))
}

export interface SnapshotDeps {
  /** 測試用的接縫：預設走 `@suanomics/shared` 的 `buildCrossMarketSignals`。 */
  computeSignals?: typeof buildCrossMarketSignals
}

/**
 * 跨市場訊號一致性小節。
 *
 * 為什麼在這裡算：`latest` 已經是 `{ spec, points }[]`、`points` 就是 `getLatest(seriesId, 2)`
 * 的結果，轉成 `buildCrossMarketSignals` 要的形狀是零成本；而 snapshotBlock 是**七個** agent
 * 共用的同一個字串——analyst-tier1、tier2-fanout、synthesizer、viewpoints-debate、
 * narrative-writer（以上 orchestrator.ts）、editor（brief-worker.ts）、podcast-writer
 * （podcast/generate.ts）——改這一處等於七個都吃到算好的事實，不必各自重判一次方向。
 * 其中 viewpoints-debate 是唯一刻意產出正／反兩面論述的 agent，把事實扭成方向結論的
 * 風險最高，故 cross-signal-smoke.ts 一併真跑它。
 *
 * 訊號是快照的**加值**資料：算爆了只略過本小節，不能把整份市場數據一起帶走。
 */
function renderCrossMarketSection(latest: SeriesLatest[], deps: SnapshotDeps): string | null {
  const compute = deps.computeSignals ?? buildCrossMarketSignals
  try {
    const pointsBySeriesId: Record<string, { date: string, value: number }[]> = {}
    for (const item of latest) {
      pointsBySeriesId[item.spec.seriesId] = item.points
    }
    const signals = compute(pointsBySeriesId)
    if (signals.length === 0)
      return null
    return [
      '### 跨市場訊號一致性',
      '',
      // 引導句刻意只描述「這是算好的事實」：方向結論（偏多／偏空／可信度）是本 issue 明訂的
      // compliance 邊界，不能由這裡的措辭把模型推過去。
      '下列為由上表數據直接算出的方向一致性事實（方向定義與上表同一套）。這是事實陳述、不是方向判斷：',
      '',
      ...signals.map(s => `- ${s.statement}`),
    ].join('\n')
  }
  catch (err) {
    console.warn('[snapshot] 跨市場訊號計算失敗、略過該小節：', err)
    return null
  }
}

export function buildSnapshotBlock(latest: SeriesLatest[], now: Date, reportDate: string, deps: SnapshotDeps = {}): string | null {
  // reportDate 必填：重生舊報告時要用那一天算期望值，不是用執行當下的台北日。
  const sections: string[] = []
  for (const [section, title] of SECTIONS) {
    const rows = latest
      .filter(item => item.spec.section === section)
      .sort((a, b) => declarationIndex(a.spec.seriesId) - declarationIndex(b.spec.seriesId))
      .map(item => renderRow(item, now, reportDate))
    if (rows.length > 0)
      sections.push([`### ${title}`, ...rows].join('\n'))
  }

  if (sections.length === 0)
    return null

  const signalSection = renderCrossMarketSection(latest, deps)
  if (signalSection)
    sections.push(signalSection)

  return ['## 市場數據（含與前期變化、各序列日期見各行、非報告當日）', '', sections.join('\n\n')].join('\n')
}
