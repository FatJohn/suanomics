import { describe, expect, it } from 'vitest'
import { judge } from './layout-assertions.judge.mjs'

/**
 * judge() 是整個 harness 唯一的判定權威，先前零測試——要證明某條斷言真的會 FAIL，
 * 唯一辦法是把版面弄壞、起 dev server、跑 Chrome。judge.mjs:8 自己要求「加新斷言前
 * 先問什麼情況下它會 FAIL」，這份 fixture 就是把那個宣稱變成可執行的證明。
 *
 * fixture 手寫而不是讀 layout-assertions.latest.json：那份是會被每次跑覆寫的產物，
 * 拿它當輸入的話，測試會跟著最近一次的頁面狀態漂移。
 */
function rect(selector, present, conditional = false) {
  const base = { selector, present, conditional }
  return present
    ? { ...base, left: 0, top: 0, right: 10, bottom: 10, clipper: null }
    : base
}

/** 一切正常的一輪：四個器械在場、無違規。 */
function cleanRaw(overrides = {}) {
  return {
    typeOffenders: [],
    observedSizes: [17, 15, 13],
    documentScrollWidth: 1280,
    documentClientWidth: 1280,
    overflowOffenders: [],
    instrumentRects: [
      rect('.chart-overlay', true),
      rect('.chart-stations', true),
      rect('.force-damp', true, true),
      rect('.force-push', true, true),
    ],
    clipped: [],
    collisions: [],
    collapsedProbe: null,
    expandProbe: null,
    footerTail: null,
    ...overrides,
  }
}

const byId = raw => Object.fromEntries(judge(raw).map(a => [a.id, a]))

describe('judge — 基準線', () => {
  it('乾淨的一輪五條全 PASS', () => {
    const out = judge(cleanRaw())
    expect(out).toHaveLength(5)
    expect(out.every(a => a.pass)).toBe(true)
  })
})

describe('judge — 每條都要能被證偽', () => {
  it('字級表外的值會 FAIL 並列出違規者', () => {
    const a = byId(cleanRaw({ typeOffenders: [{ fontSize: 14, selector: '.x', text: 'y' }] }))['type-scale']
    expect(a.pass).toBe(false)
    expect(a.detail.join()).toContain('14')
  })

  it('document 層級的水平溢出會 FAIL', () => {
    const a = byId(cleanRaw({ documentScrollWidth: 1300 }))['no-horizontal-overflow']
    expect(a.pass).toBe(false)
  })

  it('器械被裁掉會 FAIL', () => {
    const raw = cleanRaw({
      clipped: [{
        selector: '.force-push',
        sides: ['右'],
        instrument: { x: [0, 100], y: [0, 10] },
        clipperSelector: '.synoptic',
        clipper: { x: [0, 50], y: [0, 50] },
      }],
    })
    expect(byId(raw)['instruments-within-chart'].pass).toBe(false)
  })

  it('器械相撞會 FAIL', () => {
    const raw = cleanRaw({ collisions: [{ pair: ['.force-damp', '.force-push'], overlap: { x: 3, y: 4 } }] })
    expect(byId(raw)['instruments-no-collision'].pass).toBe(false)
  })
})

describe('judge — instruments-present 的兩種語意', () => {
  it('必在場的器械缺席＝頁面沒載到 brief，要 FAIL', () => {
    const raw = cleanRaw({
      instrumentRects: [
        rect('.chart-overlay', false),
        rect('.chart-stations', true),
        rect('.force-damp', true, true),
        rect('.force-push', true, true),
      ],
    })
    const a = byId(raw)['instruments-present']
    expect(a.pass).toBe(false)
    expect(a.detail.join()).toContain('.chart-overlay')
  })

  /**
   * 這條是 2026-08-14 修的假紅：.force-damp / .force-push 在 BriefSynopticChart.vue:143,147
   * 是 v-if，而 src/lib/synoptic-chart.ts:75 明寫「缺一邊時另一邊仍成立——版面必須承受單邊」。
   * direction enum 只有 positive/neutral/negative，所以全正的一天 damp 就是 null。
   * 修之前這一輪會 FAIL 並印「頁面沒載到 brief，或器械的 class 改了名」——兩個原因都不對。
   */
  it('條件在場的器械缺席＝當天資料單邊，不得 FAIL', () => {
    const raw = cleanRaw({
      instrumentRects: [
        rect('.chart-overlay', true),
        rect('.chart-stations', true),
        rect('.force-damp', false, true),
        rect('.force-push', true, true),
      ],
    })
    expect(byId(raw)['instruments-present'].pass).toBe(true)
  })

  it('兩邊力場都缺席仍然不是版面問題', () => {
    const raw = cleanRaw({
      instrumentRects: [
        rect('.chart-overlay', true),
        rect('.chart-stations', true),
        rect('.force-damp', false, true),
        rect('.force-push', false, true),
      ],
    })
    expect(byId(raw)['instruments-present'].pass).toBe(true)
  })

  it('必在場缺席時，即使條件器械齊全也要 FAIL', () => {
    const raw = cleanRaw({
      instrumentRects: [
        rect('.chart-overlay', false),
        rect('.chart-stations', false),
        rect('.force-damp', true, true),
        rect('.force-push', true, true),
      ],
    })
    expect(byId(raw)['instruments-present'].pass).toBe(false)
  })
})

describe('judge — 探針是條件式發射', () => {
  it('沒量到收合探針就不發那一條（而不是發假 PASS）', () => {
    expect(byId(cleanRaw())['viewpoints-collapsed-by-default']).toBeUndefined()
  })

  it('收合探針量到「看得見」時 FAIL', () => {
    const raw = cleanRaw({ collapsedProbe: { selector: '.vp-columns', visible: true, height: 200 } })
    expect(byId(raw)['viewpoints-collapsed-by-default'].pass).toBe(false)
  })

  it('展開探針量到「看不見」時 FAIL', () => {
    const raw = cleanRaw({ expandProbe: { selector: '.vp-columns', visible: false, height: 0 } })
    expect(byId(raw)['expansion-took-effect'].pass).toBe(false)
  })

  it('頁尾被播放器蓋住時 FAIL', () => {
    const raw = cleanRaw({ footerTail: { meta: { top: 846, bottom: 864 }, dock: { top: 833 } } })
    expect(byId(raw)['footer-tail-clear-of-dock'].pass).toBe(false)
  })

  it('頁尾有餘裕時 PASS', () => {
    const raw = cleanRaw({ footerTail: { meta: { top: 800, bottom: 820 }, dock: { top: 833 } } })
    expect(byId(raw)['footer-tail-clear-of-dock'].pass).toBe(true)
  })
})
