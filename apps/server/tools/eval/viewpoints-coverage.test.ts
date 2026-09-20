import type { EvidenceClaim } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { claimSurfacedIn, extractScaledNumbers } from './viewpoints-coverage.js'

function claimOf(text: string, id = 'c1'): EvidenceClaim {
  return {
    id,
    kind: 'fact',
    claimType: 'named-number',
    claim: text,
    evidenceRefs: [],
    asOf: '2026-08-11',
    checks: [],
  }
}

describe('extractScaledNumbers', () => {
  it('folds 萬/億/兆 into the value so scale is not lost', () => {
    expect(extractScaledNumbers('逾30萬顆', '').map(n => n.value)).toEqual([300000])
    expect(extractScaledNumbers('買超280億元', '').map(n => n.value)).toEqual([2.8e10])
  })

  it('keeps percent as a distinct unit', () => {
    const [n] = extractScaledNumbers('產能將提升 30%。', '')
    expect(n?.value).toBe(30)
    expect(n?.unit).toBe('%')
  })

  it('keeps plain numbers unitless', () => {
    const [n] = extractScaledNumbers('費城半導體指數收於12,098點。', '')
    expect(n?.value).toBe(12098)
    expect(n?.unit).toBe('')
  })
})

describe('claimSurfacedIn', () => {
  // ★ 這是本檔存在的理由。extractCheckedNumbers 不看單位，於是 c9 的「產能提升 30%」
  // 與「逾 30 萬顆 Maia 300」都抽成 30、互相假命中——2026-08-12 的 A/B 就是這樣把
  // no-ledger 臂記成命中 c9，而該臂文字裡「印能」出現 0 次（獨立複查抓到）。
  const c9 = claimOf('印能科技受惠於台積電先進封裝需求放量，且市場預估其今年產能將提升 30%。', 'c9')

  it('does not match 30% against 30萬顆', () => {
    const text = '此因素削弱該論點，因為微軟磋商明年度交付逾30萬顆自研晶片，且ASML調高銷售預測。'
    expect(claimSurfacedIn(c9, text)).toBe(false)
  })

  it('matches when the same number and unit really appear', () => {
    const text = '先進封裝設備商印能科技產能預估將提升30%，需求依然強勁。'
    expect(claimSurfacedIn(c9, text)).toBe(true)
  })

  it('does not match a percent claim against a bare number', () => {
    expect(claimSurfacedIn(c9, '該指數收於 30 點。')).toBe(false)
  })

  it('matches 億-scale amounts across phrasings', () => {
    const c12 = claimOf('昨日台股三大法人買超金額為280億元。', 'c12')
    expect(claimSurfacedIn(c12, '三大法人轉為買超280億元，顯示資金並未撤離。')).toBe(true)
    expect(claimSurfacedIn(c12, '外資賣超280萬元。')).toBe(false)
  })

  it('claims with no checkable number are not eligible', () => {
    expect(claimSurfacedIn(claimOf('市場情緒轉趨保守。'), '市場情緒轉趨保守、資金觀望。')).toBe(false)
  })

  // 既有 EXCLUSION_PATTERNS 排掉曆日與四位數年份，但**刻意保留**「連 N 日」這種次數
  // （`evidence-number-check.ts:74` 的 `(?<![連近逾])`）。量測用的排除規則要跟著它走，
  // 否則會把「外資連 7 日賣超」當成日期刪掉——2026-08-12 的 shell 版指標就踩過。
  it('keeps 連N日 as data but drops calendar dates', () => {
    expect(extractScaledNumbers('外資連7日賣超。', '').map(n => n.value)).toEqual([7])
    expect(extractScaledNumbers('2026年8月11日收盤。', '')).toEqual([])
  })

  // 版本號式數字（`關稅壁壘 2.0`）目前**不在**排除清單裡，留待之後處理。
  // 這條測試釘住現況，改了排除清單時它會紅，提醒同步更新量測解讀。
  it('does NOT currently exclude version-style numbers', () => {
    expect(extractScaledNumbers('關稅壁壘 2.0 正在成形。', '').map(n => n.value)).toEqual([2])
  })
})
