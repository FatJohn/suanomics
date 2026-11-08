import type { SeriesPoint } from './series-direction.js'
import { describe, expect, it } from 'vitest'
import { containsForbiddenPhrase } from './compliance.js'
import {
  buildCrossMarketSignals,
  CROSS_MARKET_SIGNAL_GROUPS,
  MAX_SPAN_DAYS,
} from './cross-market-signals.js'

type Points = Record<string, SeriesPoint[]>
type Dir = 'up' | 'down' | 'flat'

const KIND_BY_ID = new Map(
  CROSS_MARKET_SIGNAL_GROUPS.flatMap(g => g.members.map(m => [m.seriesId, m.kind] as const)),
)

/**
 * 造出「會被算成指定方向」的點位。
 *
 * 刻意不直接餵 direction：這一層要驗的正是 buildCrossMarketSignals 有沒有走
 * computeSeriesDirection——flow 看值的正負、level 看與前值的差，兩者對同一組數字
 * 可能得到相反結論。
 */
function pts(seriesId: string, direction: Dir, asOf = '2026-07-31'): Points {
  const kind = KIND_BY_ID.get(seriesId)
  if (kind === undefined)
    throw new Error(`測試引用了不在任何組別裡的序列：${seriesId}`)
  const prev = { date: '2026-07-30', value: 100 }
  if (kind === 'flow') {
    const value = direction === 'up' ? 873 : direction === 'down' ? -495 : 0
    return { [seriesId]: [{ date: asOf, value }, prev] }
  }
  const value = direction === 'up' ? 110 : direction === 'down' ? 90 : 100
  return { [seriesId]: [{ date: asOf, value }, prev] }
}

function merge(...parts: Points[]): Points {
  return Object.assign({}, ...parts) as Points
}

const TW_FLOW = merge(
  pts('taiex-institutional-net', 'up'),
  pts('foreign-taifex-net', 'up'),
)

function groupById(results: ReturnType<typeof buildCrossMarketSignals>, id: string) {
  return results.find(r => r.groupId === id)
}

describe('cROSS_MARKET_SIGNAL_GROUPS', () => {
  it('只引用真實存在的序列（對齊 series-config 的 26 條）', () => {
    const known = new Set([
      'us-cpi-yoy',
      'us-core-cpi-yoy',
      'us-cpi-energy-yoy',
      'us-cpi-food-yoy',
      'us-cpi-shelter-yoy',
      'us-cpi-supercore-yoy',
      'us-nonfarm-payrolls',
      'us-unemployment',
      'us-m2-yoy',
      'us-fed-funds',
      'us-10y-yield',
      'us-2y-yield',
      'us-10y-real-rate',
      'us-10y-breakeven',
      'us-yield-spread-10y2y',
      'usd-index',
      'wti-oil',
      'us-sox',
      'us-nasdaq-comp',
      'usd-twd',
      'taiex-close',
      'taiex-institutional-net',
      'taiex-margin-balance',
      'foreign-taifex-net',
      'taiex-sbl-balance',
      'taiex-margin-short-balance',
    ])
    for (const g of CROSS_MARKET_SIGNAL_GROUPS) {
      for (const m of g.members)
        expect(known.has(m.seriesId), `${g.id} 引用了不存在的序列 ${m.seriesId}`).toBe(true)
    }
  })

  it('每個成員都帶 label 與 kind（句子與方向判定都靠它）', () => {
    for (const g of CROSS_MARKET_SIGNAL_GROUPS) {
      for (const m of g.members) {
        expect(m.label.length, `${m.seriesId} 缺 label`).toBeGreaterThan(0)
        expect(['level', 'flow']).toContain(m.kind)
      }
    }
  })

  it('每組至少兩個成員（單一序列談不上一致性）', () => {
    for (const g of CROSS_MARKET_SIGNAL_GROUPS)
      expect(g.members.length).toBeGreaterThanOrEqual(2)
  })

  // 美元兌台幣上升＝台幣走貶＝資金流出，與買超／淨多部位上升的意義相反
  it('usd-twd 在外資動向組是反向極性', () => {
    const fx = CROSS_MARKET_SIGNAL_GROUPS
      .find(g => g.id === 'foreign-flow')
      ?.members
      .find(m => m.seriesId === 'usd-twd')
    expect(fx?.polarity).toBe(-1)
  })
})

describe('buildCrossMarketSignals — 方向來自 computeSeriesDirection', () => {
  // 買賣超是 flow：值為負就是賣超（down），即使比前值高
  it('flow 序列看值的正負，不看與前值的差', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      { 'taiex-institutional-net': [{ date: '2026-07-31', value: -100 }, { date: '2026-07-30', value: -495 }] },
      pts('foreign-taifex-net', 'up'),
      pts('usd-twd', 'down'),
    )), 'foreign-flow')
    // 賣超（down）× polarity 1 → 流出；台幣升值與期貨淨多 → 流入。故為分歧
    expect(r?.status).toBe('mixed')
    expect(r?.statement).toContain('三大法人買賣超下降')
  })

  // 同一組數字若被當成 level 會判成 up，這條就是防它回歸
  it('level 序列看與前值的差，不看值的正負', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      { 'taiex-margin-short-balance': [{ date: '2026-07-31', value: -100 }, { date: '2026-07-30', value: -495 }] },
      pts('taiex-sbl-balance', 'up'),
    )), 'tw-short-side')
    expect(r?.status).toBe('aligned')
    expect(r?.statement).toContain('融券餘額上升')
  })
})

describe('buildCrossMarketSignals — 一致與分歧', () => {
  it('全數同向 → aligned，句子點名每一條訊號', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      pts('us-sox', 'up'),
      pts('us-nasdaq-comp', 'up'),
    )), 'us-tech')
    expect(r?.status).toBe('aligned')
    expect(r?.statement).toContain('費城半導體')
    expect(r?.statement).toContain('納斯達克綜合')
  })

  it('方向不一致 → mixed', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      pts('us-sox', 'up'),
      pts('us-nasdaq-comp', 'down'),
    )), 'us-tech')
    expect(r?.status).toBe('mixed')
  })

  // 極性的重點：raw 方向相反，但語意上其實同向
  it('反向極性的成員：raw 相反但語意同向時判 aligned', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      pts('usd-twd', 'down'),
      TW_FLOW,
    )), 'foreign-flow')
    expect(r?.status).toBe('aligned')
  })

  it('反向極性的成員：raw 相同時語意上其實分歧', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      pts('usd-twd', 'up'),
      TW_FLOW,
    )), 'foreign-flow')
    expect(r?.status).toBe('mixed')
  })
})

describe('buildCrossMarketSignals — graceful degrade', () => {
  it('序列缺資料 → 該組跳過，不影響其他組（比照 buildKeyNumbers）', () => {
    const results = buildCrossMarketSignals(merge(
      pts('us-sox', 'up'),
      pts('us-nasdaq-comp', 'up'),
    ))
    expect(groupById(results, 'us-tech')?.status).toBe('aligned')
    expect(groupById(results, 'foreign-flow')).toBeUndefined()
  })

  it('只剩一條有資料 → 不產生該組', () => {
    expect(groupById(buildCrossMarketSignals(pts('us-sox', 'up')), 'us-tech')).toBeUndefined()
  })

  it('空的 points 陣列視同缺資料', () => {
    const results = buildCrossMarketSignals(merge(pts('us-sox', 'up'), { 'us-nasdaq-comp': [] }))
    expect(groupById(results, 'us-tech')).toBeUndefined()
  })

  it('全部持平 → 不產生該組（沒有方向可談）', () => {
    const results = buildCrossMarketSignals(merge(
      pts('us-sox', 'flat'),
      pts('us-nasdaq-comp', 'flat'),
    ))
    expect(groupById(results, 'us-tech')).toBeUndefined()
  })

  it('完全沒有輸入 → 回空陣列，不 throw', () => {
    expect(buildCrossMarketSignals({})).toEqual([])
  })
})

describe('buildCrossMarketSignals — 期間不一致（驗收條件 4）', () => {
  // usd-twd 的 frequency 是 daily，但 FRED H.10 每週才發布一次，所以它的最新點
  // 可能落後台股日頻序列一整週。用 frequency 當守衛完全擋不住，只能比實際日期。
  it('落後超過門檻的成員被排除，其餘足夠時該組仍成立', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      pts('usd-twd', 'down', '2026-07-24'),
      TW_FLOW,
    )), 'foreign-flow')
    expect(r?.status).toBe('aligned')
    expect(r?.excluded.map(e => e.seriesId)).toEqual(['usd-twd'])
  })

  it('被排除的成員必須在句子裡標明，含它的資料日期', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      pts('usd-twd', 'down', '2026-07-24'),
      TW_FLOW,
    )), 'foreign-flow')
    expect(r?.statement).toContain('美元兌台幣')
    expect(r?.statement).toContain('2026-07-24')
  })

  it('排除後不足兩條 → 該組不成立', () => {
    const results = buildCrossMarketSignals(merge(
      pts('us-sox', 'up'),
      pts('us-nasdaq-comp', 'up', '2026-07-10'),
    ))
    expect(groupById(results, 'us-tech')).toBeUndefined()
  })

  it('週末造成的 Fri→Mon 落差不算不一致', () => {
    const r = groupById(buildCrossMarketSignals(merge(
      pts('us-sox', 'up'),
      pts('us-nasdaq-comp', 'up', '2026-08-03'),
    )), 'us-tech')
    expect(MAX_SPAN_DAYS).toBeGreaterThanOrEqual(3)
    expect(r?.status).toBe('aligned')
    expect(r?.excluded).toEqual([])
  })
})

describe('buildCrossMarketSignals — 合規（驗收條件 5）', () => {
  // 全排列跑一次，確保沒有任何方向組合會生出禁用詞
  it('所有可能的輸出字串都通過 containsForbiddenPhrase', () => {
    const dirs: Dir[] = ['up', 'down', 'flat']
    let checked = 0
    for (const g of CROSS_MARKET_SIGNAL_GROUPS) {
      for (let mask = 0; mask < 3 ** g.members.length; mask++) {
        let rest = mask
        const input = merge(...g.members.map((m) => {
          const d = dirs[rest % 3] ?? 'flat' // rest % 3 恆為 0..2，fallback 只為滿足 noUncheckedIndexedAccess
          rest = Math.floor(rest / 3)
          return pts(m.seriesId, d)
        }))
        for (const r of buildCrossMarketSignals(input)) {
          expect(containsForbiddenPhrase(r.statement).hit, `禁用詞出現在：${r.statement}`).toBe(false)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('不輸出方向結論或預測措辭', () => {
    // 「預期」不能單獨列——「10 年期通膨預期」是序列的正式名稱（breakeven），
    // 不是我們在預測。要擋的是預測**句式**，所以用「預期將」這種構造。
    const banned = ['偏多', '偏空', '可信度高', '開高走低', '預期將', '預料', '可望', '將會', '應該']
    for (const g of CROSS_MARKET_SIGNAL_GROUPS) {
      const input = merge(...g.members.map(m => pts(m.seriesId, 'up')))
      for (const r of buildCrossMarketSignals(input)) {
        for (const b of banned)
          expect(r.statement, `「${b}」出現在：${r.statement}`).not.toContain(b)
      }
    }
  })
})

// 極名的自洽性（實際渲染後才現形）：mixed 情況 buildStatement 會產出
// 「N 項指向<極名>、M 項指向<反極名>」，極名若自帶「同步」就變成「2 項指向同步上行」，
// 是一句自相矛盾、且會誤導下游 LLM 的事實句。
describe('極名不得自帶「同步」', () => {
  it('沒有任何組別的極名含「同步」', () => {
    for (const g of CROSS_MARKET_SIGNAL_GROUPS) {
      expect(g.poles.positive, `${g.id} 的 positive 極名`).not.toContain('同步')
      expect(g.poles.negative, `${g.id} 的 negative 極名`).not.toContain('同步')
    }
  })

  it('mixed 的事實句讀得通（殖利率拆解 2 上 1 下）', () => {
    const [result] = buildCrossMarketSignals(merge(
      pts('us-10y-yield', 'up'),
      pts('us-10y-real-rate', 'up'),
      pts('us-10y-breakeven', 'down'),
    ))
    expect(result?.status).toBe('mixed')
    expect(result?.statement).toBe(
      '美債殖利率拆解：3 項訊號中 2 項指向上行（美債 10 年期殖利率上升、美債 10 年期實質利率上升），1 項指向下行（10 年期通膨預期下降）。',
    )
  })
})
