import { describe, expect, it } from 'vitest'
import { formatMarketDelta, formatMarketValue } from './format-market-number.js'

describe('formatMarketValue', () => {
  it('shouldThousandsSeparateLevelPointValue', () => {
    expect(formatMarketValue(23150, '點', 'level')).toBe('23,150 點')
  })
  it('shouldTrimTrailingZerosForPercent', () => {
    expect(formatMarketValue(4.3, '%', 'level')).toBe('4.3%')
    expect(formatMarketValue(4, '%', 'level')).toBe('4%')
    expect(formatMarketValue(4.32, '%', 'level')).toBe('4.32%')
  })
  it('shouldSignFlowPositive', () => {
    expect(formatMarketValue(125, '億元', 'flow')).toBe('+125 億元')
  })
  it('shouldSignFlowNegative', () => {
    expect(formatMarketValue(-80, '億元', 'flow')).toBe('-80 億元')
  })
  it('shouldNotSignLevelBillion', () => {
    expect(formatMarketValue(5000, '億元', 'level')).toBe('5,000 億元')
  })
  it('shouldFormatCurrencyTwoDecimalsNoSpace', () => {
    expect(formatMarketValue(31.5, '元', 'level')).toBe('31.5元')
    expect(formatMarketValue(72.45, '美元', 'level')).toBe('72.45美元')
  })
  it('shouldNotShowNegativeZeroForFlowNearZero', () => {
    expect(formatMarketValue(-0.3, '億元', 'flow')).toBe('0 億元')
  })
  it('shouldNotShowNegativeZeroForLevelNearZero', () => {
    expect(formatMarketValue(-0.001, '%', 'level')).toBe('0%')
  })
  it('shouldShowZeroWithoutSignForExactZeroFlow', () => {
    expect(formatMarketValue(0, '億元', 'flow')).toBe('0 億元')
  })
})

describe('formatMarketDelta', () => {
  it('shouldReturnNullWithoutPrevious', () => {
    expect(formatMarketDelta(23150, null, '點', 'level')).toBeNull()
  })
  it('shouldSignLevelPointDifferenceWithThousands', () => {
    expect(formatMarketDelta(23150, 21950, '點', 'level')).toBe('+1,200')
    expect(formatMarketDelta(21950, 23150, '點', 'level')).toBe('-1,200')
  })
  it('shouldGivePercentagePointDifferenceWithoutUnitForPercent', () => {
    // 殖利率 4.3% ← 4.25%：+0.05 就是百分點差、帶 % 反而會被讀成「漲了 0.05%」
    expect(formatMarketDelta(4.3, 4.25, '%', 'level')).toBe('+0.05')
  })
  it('shouldTrimTrailingZerosInCurrencyDifference', () => {
    expect(formatMarketDelta(31.5, 31.4, '元', 'level')).toBe('+0.1')
    expect(formatMarketDelta(72.45, 73.65, '美元', 'level')).toBe('-1.2')
  })
  it('shouldSayFlatWhenLevelUnchanged', () => {
    expect(formatMarketDelta(23150, 23150, '點', 'level')).toBe('持平')
  })
  it('shouldSayFlatWhenLevelDifferenceRoundsToZero', () => {
    // 點/億元 走 Math.round：差 0.4 點格式化後是 '0'、不能顯示成 '+0'
    expect(formatMarketDelta(23150.4, 23150, '點', 'level')).toBe('持平')
    expect(formatMarketDelta(4.3001, 4.3, '%', 'level')).toBe('持平')
  })
  it('shouldShowPreviousValueInsteadOfDifferenceForFlow', () => {
    // flow 的 direction 取自值的正負：今日買超 50（▲紅）、昨日買超 100，
    // 差值 -50 會與紅色上漲箭頭矛盾、被讀成賣超。改給前值讓讀者自己比。
    expect(formatMarketDelta(50, 100, '億元', 'flow')).toBe('前 +100')
    expect(formatMarketDelta(50, -80, '億元', 'flow')).toBe('前 -80')
  })
  it('shouldOmitUnitInFlowPreviousValue', () => {
    expect(formatMarketDelta(50, 100, '億元', 'flow')).not.toContain('億元')
  })
})
