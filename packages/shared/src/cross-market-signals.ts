// 跨市場訊號一致性。
//
// 為什麼在資料層算而不是叫 LLM 自己看：macro-frames.ts 目前的做法是在 prompt 裡問
// 「兩者背離指向什麼」，等於要模型先從市場快照挑出相關序列、各自判方向、再比對——
// 三個步驟都可能錯，而唯一的硬 gate 是 NarrativeSchema，量不到這種錯。這裡把「誰跟誰
// 同向」變成算好的事實，注入 prompt，模型只負責解讀。
//
// 邊界（compliance）：只輸出可證偽的事實陳述，不輸出方向結論、不預測開盤、不碰個股。

import type { SeriesDirection, SeriesKind, SeriesPoint } from './series-direction.js'
import { computeSeriesDirection } from './series-direction.js'

export interface SignalMemberSpec {
  seriesId: string
  /** 顯示名。與 worker `SERIES_SPECS` 的 `displayName` 一致，漂移由 series-config 的守衛測試擋。 */
  label: string
  /** 方向語意（level／flow）。同樣刻意複製自 worker，同一份守衛測試擋漂移。 */
  kind: SeriesKind
  /** 這條序列的 raw 方向對應到組別軸線的哪一極：1 ＝ 同向、-1 ＝ 反向 */
  polarity: 1 | -1
}

export interface SignalGroupSpec {
  id: string
  label: string
  /** 軸線兩極的白話說法，用於組出事實句 */
  poles: { positive: string, negative: string }
  members: SignalMemberSpec[]
}

export interface ExcludedMember {
  seriesId: string
  label: string
  asOf: string
}

export interface SignalGroupResult {
  groupId: string
  label: string
  status: 'aligned' | 'mixed'
  statement: string
  excluded: ExcludedMember[]
}

/**
 * 同一組內各成員資料日期的最大容許落差（曆日）。
 *
 * 3 天是為了讓週五對週一的正常落差過關；`usd-twd` 那種落後一整週的才會被排除。
 * 注意不能用 series 的 `frequency` 當守衛——`usd-twd` 宣告是 `daily`，週的是它的
 * **發布**節奏（FRED H.10），用 frequency 判會完全不觸發。只有比實際日期才擋得住。
 */
export const MAX_SPAN_DAYS = 3

export const CROSS_MARKET_SIGNAL_GROUPS: readonly SignalGroupSpec[] = Object.freeze([
  {
    id: 'foreign-flow',
    label: '外資動向',
    poles: { positive: '資金流入台股', negative: '資金流出台股' },
    members: [
      // 美元兌台幣上升＝台幣走貶，與買超、淨多部位增加的意義相反，故極性為 -1
      { seriesId: 'usd-twd', label: '美元兌台幣', kind: 'level', polarity: -1 },
      { seriesId: 'taiex-institutional-net', label: '三大法人買賣超', kind: 'flow', polarity: 1 },
      { seriesId: 'foreign-taifex-net', label: '外資台指期淨部位', kind: 'flow', polarity: 1 },
    ],
  },
  {
    id: 'yield-decomposition',
    label: '美債殖利率拆解',
    // 極名不含「同步」：`buildStatement` 在 mixed 情況會產出「2 項指向<極名>、1 項指向<反極名>」，
    // 極名自帶「同步」會變成「2 項指向同步上行」這種自相矛盾的句子（實際渲染後才看得出來）。
    poles: { positive: '上行', negative: '下行' },
    members: [
      { seriesId: 'us-10y-yield', label: '美債 10 年期殖利率', kind: 'level', polarity: 1 },
      { seriesId: 'us-10y-real-rate', label: '美債 10 年期實質利率', kind: 'level', polarity: 1 },
      { seriesId: 'us-10y-breakeven', label: '10 年期通膨預期', kind: 'level', polarity: 1 },
    ],
  },
  {
    id: 'tw-short-side',
    label: '台股空方部位',
    poles: { positive: '空方部位增加', negative: '空方部位減少' },
    members: [
      { seriesId: 'taiex-margin-short-balance', label: '融券餘額', kind: 'level', polarity: 1 },
      { seriesId: 'taiex-sbl-balance', label: '借券賣出餘額', kind: 'level', polarity: 1 },
    ],
  },
  {
    id: 'us-tech',
    label: '美股科技',
    poles: { positive: '走高', negative: '走低' },
    members: [
      { seriesId: 'us-sox', label: '費城半導體指數', kind: 'level', polarity: 1 },
      { seriesId: 'us-nasdaq-comp', label: '納斯達克綜合指數', kind: 'level', polarity: 1 },
    ],
  },
])

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`))
  return Math.round(ms / 86_400_000)
}

const DIRECTION_WORD: Record<Exclude<SeriesDirection, 'flat'>, string> = {
  up: '上升',
  down: '下降',
}

interface Resolved {
  label: string
  seriesId: string
  raw: Exclude<SeriesDirection, 'flat'>
  /** raw 套上極性之後、在這條軸線上的位置 */
  pole: 'positive' | 'negative'
}

function describe(members: Resolved[]): string {
  return members.map(m => `${m.label}${DIRECTION_WORD[m.raw]}`).join('、')
}

function buildStatement(spec: SignalGroupSpec, positive: Resolved[], negative: Resolved[], excluded: ExcludedMember[]): string {
  const total = positive.length + negative.length
  const [major, minor] = positive.length >= negative.length ? [positive, negative] : [negative, positive]
  const majorPole = major === positive ? spec.poles.positive : spec.poles.negative
  const minorPole = major === positive ? spec.poles.negative : spec.poles.positive

  const head = minor.length === 0
    ? `${spec.label}：${total} 項訊號全數指向${majorPole}（${describe(major)}）。`
    : `${spec.label}：${total} 項訊號中 ${major.length} 項指向${majorPole}（${describe(major)}），`
      + `${minor.length} 項指向${minorPole}（${describe(minor)}）。`

  if (excluded.length === 0)
    return head

  const tail = excluded.map(e => `${e.label}（資料日期 ${e.asOf}）`).join('、')
  return `${head}${tail}的資料日期與其餘訊號相差超過 ${MAX_SPAN_DAYS} 天，未納入本組比較。`
}

/**
 * 把市場序列的方向彙整成「訊號一致性事實」。
 *
 * 缺資料、全持平、或排除落後成員後不足兩條的組別直接不產出（graceful degrade，
 * 比照 `buildKeyNumbers`），不阻斷 pipeline。
 */
export function buildCrossMarketSignals(
  pointsBySeriesId: Record<string, SeriesPoint[]>,
  opts?: { maxSpanDays?: number },
): SignalGroupResult[] {
  const maxSpan = opts?.maxSpanDays ?? MAX_SPAN_DAYS
  const out: SignalGroupResult[] = []

  for (const spec of CROSS_MARKET_SIGNAL_GROUPS) {
    const present: Array<{ spec: SignalMemberSpec, obs: { seriesId: string, label: string, direction: SeriesDirection, asOf: string } }> = []
    for (const member of spec.members) {
      const points = pointsBySeriesId[member.seriesId]
      const latest = points?.[0]
      if (!latest)
        continue
      present.push({
        spec: member,
        obs: {
          seriesId: member.seriesId,
          label: member.label,
          // 方向不自己判，走 series-direction 的單一真相：flow 看值的正負、level 看與前值的差
          direction: computeSeriesDirection(member.kind, latest, points[1] ?? null),
          asOf: latest.date,
        },
      })
    }
    if (present.length < 2)
      continue

    // 以最新的資料日期為基準，落後太多的成員不參與比較——把上週的匯率跟昨天的
    // 買賣超當成同一天的訊號，算出來的「一致」是假的。
    // ISO 日期可直接字典序比大小；不用 sort().at(-1) 是為了避開 non-null assertion
    let newest = ''
    for (const p of present) {
      if (p.obs.asOf > newest)
        newest = p.obs.asOf
    }
    const excluded: ExcludedMember[] = []
    const inWindow: typeof present = []
    for (const p of present) {
      if (daysBetween(p.obs.asOf, newest) > maxSpan)
        excluded.push({ seriesId: p.obs.seriesId, label: p.obs.label, asOf: p.obs.asOf })
      else
        inWindow.push(p)
    }

    const resolved: Resolved[] = inWindow
      .filter(p => p.obs.direction !== 'flat')
      .map((p) => {
        const raw = p.obs.direction as Exclude<SeriesDirection, 'flat'>
        const aligned = p.spec.polarity === 1 ? raw === 'up' : raw === 'down'
        return { label: p.obs.label, seriesId: p.obs.seriesId, raw, pole: aligned ? 'positive' as const : 'negative' as const }
      })
    if (resolved.length < 2)
      continue

    const positive = resolved.filter(r => r.pole === 'positive')
    const negative = resolved.filter(r => r.pole === 'negative')
    out.push({
      groupId: spec.id,
      label: spec.label,
      status: positive.length === 0 || negative.length === 0 ? 'aligned' : 'mixed',
      statement: buildStatement(spec, positive, negative, excluded),
      excluded,
    })
  }

  return out
}
