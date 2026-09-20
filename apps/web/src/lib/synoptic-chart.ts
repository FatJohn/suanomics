import type { MarketBrief } from '@suanomics/shared'

/**
 * 力場圖（The Synoptic Chart）的幾何與語意推導。
 *
 * 兩條紀律寫在這裡而不是元件裡：
 * 1. **決定性**——同一天的圖每次重新整理都必須一模一樣，所以一切由日期 seed 推導，
 *    不用 Math.random。
 * 2. **不需要圖例**——力場中心一律帶白話標籤（推升／壓抑）。這個模組不產生
 *    任何需要讀者解碼的氣象符號。
 */

type Industry = MarketBrief['affectedIndustries'][number]

export interface ForceCenter {
  kind: 'push' | 'damp'
  /** 白話標籤。刻意不叫高壓／低壓——讀者不該為了讀新聞先學會判讀天氣圖。 */
  label: '推升' | '壓抑'
  industry: string
  reasoning: string
  /** 0..1，由 editor 給的信心轉來；圖上以暈區大小與濃度表現。 */
  strength: number
}

export interface Forces {
  push: ForceCenter | null
  damp: ForceCenter | null
}

export interface ChartPoint {
  x: number
  y: number
}

export interface Front {
  path: string
  markers: ChartPoint[]
}

const STRENGTH_BY_CONFIDENCE: Record<Industry['confidence'], number> = {
  high: 1,
  medium: 0.66,
  low: 0.36,
}

/** 線條留在畫布中段，避免壓到疊在圖上的標題與讀數列。 */
const BAND_TOP = 0.24
const BAND_BOTTOM = 0.76

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function round(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * 由日期字串推出 0..1 的決定性種子（FNV-1a 變體）。
 * 只需要分散與可重現，不需要密碼學強度。
 */
export function dateSeed(date: string): number {
  let h = 2166136261
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/**
 * 從 editor 給的受影響產業推出兩個具名力場中心。
 *
 * `mixed` 與 `uncertain` 刻意不參與：它們無法用單一方向的白話標籤表達，
 * 硬要標會逼讀者猜。缺一邊時另一邊仍成立——版面必須承受單邊。
 */
export function selectForces(industries: readonly Industry[]): Forces {
  const strongest = (direction: Industry['direction']): Industry | undefined => {
    let best: Industry | undefined
    for (const item of industries) {
      if (item.direction !== direction)
        continue
      // 嚴格大於：同信心時保留 editor 的排序，先出現的勝出
      if (!best || STRENGTH_BY_CONFIDENCE[item.confidence] > STRENGTH_BY_CONFIDENCE[best.confidence])
        best = item
    }
    return best
  }

  const toCenter = (item: Industry | undefined, kind: ForceCenter['kind']): ForceCenter | null => {
    if (!item)
      return null
    return {
      kind,
      label: kind === 'push' ? '推升' : '壓抑',
      industry: item.name,
      reasoning: item.reasoning,
      strength: STRENGTH_BY_CONFIDENCE[item.confidence],
    }
  }

  return {
    push: toCenter(strongest('positive'), 'push'),
    damp: toCenter(strongest('negative'), 'damp'),
  }
}

interface CurveOptions {
  /** 振幅佔畫布高度的比例 */
  amplitude: number
  /** 橫跨畫布的波數 */
  frequency: number
  /** 整體傾斜，佔畫布高度的比例 */
  tilt: number
  /** 中心線位置，佔畫布高度的比例 */
  center: number
  samples: number
}

function samplePoints(seed: number, w: number, h: number, o: CurveOptions): ChartPoint[] {
  const phase = seed * Math.PI * 2
  const points: ChartPoint[] = []
  for (let i = 0; i <= o.samples; i++) {
    const t = i / o.samples
    const wave = Math.sin(phase + t * Math.PI * 2 * o.frequency) * (h * o.amplitude)
    const slope = h * o.tilt * (t - 0.5) * 2
    points.push({
      x: round(t * w),
      y: round(clamp(h * o.center + wave + slope, h * BAND_TOP, h * BAND_BOTTOM)),
    })
  }
  return points
}

/** 以中點做二次平滑，避免取樣點造成折線感。 */
function smoothPath(points: readonly ChartPoint[]): string {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last)
    return ''

  let d = `M ${first.x} ${first.y}`
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i]
    const next = points[i + 1]
    if (!current || !next)
      continue
    d += ` Q ${current.x} ${current.y} ${round((current.x + next.x) / 2)} ${round((current.y + next.y) / 2)}`
  }
  return `${d} L ${last.x} ${last.y}`
}

/**
 * 主鋒面——本日論點在圖上的形體。
 * 形狀隨日期變化（每天的圖不該長一樣），但意義完全來自它旁邊的白話標籤。
 */
export function buildFront(seed: number, w: number, h: number, samples = 22): Front {
  // 振幅刻意壓低：鋒面是「橫過畫面的一條線」，不是裝飾波浪。
  // 第一次整合時用 0.06~0.13 的振幅，實測讀起來像 swoosh 而不像天氣圖。
  const points = samplePoints(seed, w, h, {
    amplitude: 0.028 + seed * 0.03,
    frequency: 1.1 + seed * 1.1,
    tilt: (seed - 0.5) * 0.1,
    center: 0.52,
    samples,
  })

  return {
    path: smoothPath(points),
    markers: points.filter((_, i) => i > 0 && i < points.length - 1 && i % 4 === 0),
  }
}

/**
 * 背景等壓線。**它們不承載任何讀者必須讀懂的資訊**——只是讓版面像一張圖的紋理，
 * 所以刻意不附數值標籤（舊版的 1012／1024 是氣象術語 cosplay，已移除）。
 */
export function buildIsobars(seed: number, w: number, h: number): string[] {
  return [0, 1, 2].map((k) => {
    const localSeed = (seed + k * 0.17) % 1
    return smoothPath(samplePoints(localSeed, w, h, {
      amplitude: 0.03 + localSeed * 0.03,
      frequency: 0.8 + localSeed * 0.7,
      tilt: (localSeed - 0.5) * 0.18,
      center: 0.28 + k * 0.22,
      samples: 14,
    }))
  })
}
