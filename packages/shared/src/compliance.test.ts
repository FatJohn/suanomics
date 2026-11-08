import { describe, expect, it } from 'vitest'
import {
  checkCompliance,
  containsForbiddenPhrase,
  containsTickerDirection,
  createStreamingFilter,
} from './compliance.js'

describe('containsForbiddenPhrase', () => {
  it('shouldReturnHitWhenTextContainsBanPhrase', () => {
    const result = containsForbiddenPhrase('你應該建議買 0050')
    expect(result.hit).toBe(true)
    expect(result.phrase).toBe('建議買')
  })

  it('shouldReturnNoHitForNeutralText', () => {
    const result = containsForbiddenPhrase('這檔 ETF 的歷史中位回報是 20%')
    expect(result.hit).toBe(false)
    expect(result.phrase).toBeUndefined()
  })

  it('shouldCatchGuaranteePhrase', () => {
    const result = containsForbiddenPhrase('只要定期定額就穩賺不賠')
    expect(result.hit).toBe(true)
    expect(result.phrase).toBe('穩賺不賠')
  })

  it('shouldReturnFirstMatchingPhraseWhenMultiple', () => {
    // 兩個禁用詞都出現、應回第一個（「建議買」在陣列中比較前）
    const result = containsForbiddenPhrase('建議買穩賺不賠')
    expect(result.hit).toBe(true)
    expect(result.phrase).toBe('建議買')
  })

  it('shouldNotFalsePositiveOnEverydayReplyPhrase', () => {
    // 拆詞後、日常「一定會回覆 / 回答」不再被誤判
    expect(containsForbiddenPhrase('你問的問題我一定會回覆').hit).toBe(false)
    expect(containsForbiddenPhrase('放心、我一定會回答').hit).toBe(false)
  })

  it('shouldCatchPriceRelatedReturnPredictions', () => {
    // 真正要攔的：LLM 對 ETF 做方向性預測
    expect(containsForbiddenPhrase('這檔 ETF 之後一定會回升').phrase).toBe('一定會回升')
    expect(containsForbiddenPhrase('跌這麼多一定會回檔').phrase).toBe('一定會回檔')
    expect(containsForbiddenPhrase('價格一定會回到原本位置').phrase).toBe('一定會回到')
  })

  it('shouldCatchNewBriefPhrases', () => {
    expect(containsForbiddenPhrase('建議攤平').hit).toBe(true)
    expect(containsForbiddenPhrase('建議停損').hit).toBe(true)
    expect(containsForbiddenPhrase('建議進場').hit).toBe(true)
    expect(containsForbiddenPhrase('建議出場').hit).toBe(true)
  })

  it('shouldCatchSoftRecommendationPhrases', () => {
    const softPhrases = [
      '可以考慮',
      '值得考慮',
      '值得關注',
      '值得留意',
      '值得追蹤',
      '建議觀察',
      '建議留意',
      '避開',
      '少碰',
      '繞開',
      '佈局',
      '可以進場',
      '可以出場',
      '進場時機',
      '出場時機',
      '進場點',
      '出場點',
      '加碼時機',
      '減碼時機',
      '看多',
      '看空',
      '偏多',
      '偏空',
      '轉多',
      '轉空',
      '做多',
      '做空',
      '增持',
      '減持',
    ]
    for (const phrase of softPhrases) {
      const r = containsForbiddenPhrase(`這檔標的${phrase}`)
      expect(r.hit).toBe(true)
      expect(r.phrase).toBe(phrase)
    }
  })
})

describe('createStreamingFilter', () => {
  it('shouldEmitSafeContentWhenNoPhraseMatches', () => {
    const filter = createStreamingFilter()
    const r1 = filter.push('聽起來你現在')
    expect(r1.hit).toBe(false)
    // safe 可能回空（還沒確定 tail 是不是 phrase 前綴）、但 push 完 + flush 後完整內容應恢復
    const r2 = filter.push('很焦慮。')
    expect(r2.hit).toBe(false)
    const tail = filter.flush()
    const total = (r1.safe) + (r2.safe) + tail
    expect(total).toBe('聽起來你現在很焦慮。')
  })

  it('shouldFlagHitWithinSingleChunk', () => {
    const filter = createStreamingFilter()
    const result = filter.push('所以我建議買這檔')
    expect(result.hit).toBe(true)
    expect(result.phrase).toBe('建議買')
  })

  it('shouldFlagHitAcrossChunkBoundary', () => {
    const filter = createStreamingFilter()
    const r1 = filter.push('所以我建')
    expect(r1.hit).toBe(false)
    const r2 = filter.push('議買這檔')
    expect(r2.hit).toBe(true)
    expect(r2.phrase).toBe('建議買')
  })

  it('shouldFlagHitAcrossThreeChunksSplittingPhrase', () => {
    const filter = createStreamingFilter()
    const r1 = filter.push('我建')
    const r2 = filter.push('議')
    const r3 = filter.push('買 0050')
    expect(r1.hit).toBe(false)
    expect(r2.hit).toBe(false)
    expect(r3.hit).toBe(true)
  })

  it('shouldStopEmittingAfterHit', () => {
    const filter = createStreamingFilter()
    filter.push('開頭安全文字很長一段')
    const hitResult = filter.push('我建議買這檔')
    expect(hitResult.hit).toBe(true)
    // 命中後再 push 不應該吐新內容
    const after = filter.push('後續文字')
    expect(after.hit).toBe(true)
    expect(after.safe).toBe('')
  })

  it('shouldFlushRemainingTailWhenNoHit', () => {
    const filter = createStreamingFilter()
    const pushed = filter.push('完整無害內容')
    const tail = filter.flush()
    expect(pushed.safe + tail).toBe('完整無害內容')
  })

  it('shouldHandleEmptyInputGracefully', () => {
    const filter = createStreamingFilter()
    const r = filter.push('')
    expect(r.hit).toBe(false)
    expect(r.safe).toBe('')
    expect(filter.flush()).toBe('')
  })

  it('shouldNotFalsePositiveOnSafeAllowedPhrase', () => {
    // 應放行的範例：「歷史上類似跌幅、多數持有者 1 年後的中位數回報」
    const filter = createStreamingFilter()
    const r = filter.push('歷史上類似跌幅、多數持有者 1 年後的中位數回報是 20%')
    const tail = filter.flush()
    expect(r.hit).toBe(false)
    expect(r.safe + tail).toBe('歷史上類似跌幅、多數持有者 1 年後的中位數回報是 20%')
  })
})

describe('containsTickerDirection', () => {
  it('shouldReturnNoHitForNeutralText', () => {
    expect(containsTickerDirection('今日台股大盤震盪、半導體產業表現分歧').hit).toBe(false)
  })

  it('shouldHitWhenTickerFollowedByDirectionVerbWithinRange', () => {
    const r = containsTickerDirection('近期 2330 看多的聲音變強')
    expect(r.hit).toBe(true)
    expect(r.ticker).toBe('2330')
    expect(r.verb).toBe('看多')
  })

  it('shouldHitWhenCompanyNameFollowedByDirectionVerb', () => {
    const r = containsTickerDirection('台積電偏多格局延續')
    expect(r.hit).toBe(true)
    expect(r.company).toBe('台積電')
    expect(r.verb).toBe('偏多')
  })

  it('shouldNotHitWhenDirectionVerbAttributedToThirdParty', () => {
    // 外資偏多 2330 = 第三方事實陳述（描述性 context）→ 放行
    expect(containsTickerDirection('外資偏多 2330 半導體族群').hit).toBe(false)
  })

  it('shouldHitWhenUnattributedVerbPrecedesTicker', () => {
    // 未歸因、方向詞在 ticker 前：仍命中（保留「verb precedes ticker」順序覆蓋）
    expect(containsTickerDirection('短線看多 2330 後市').hit).toBe(true)
  })

  it('shouldAllowThirdPartyFundFlowReporting', () => {
    expect(containsTickerDirection('外資減碼台積電').hit).toBe(false)
    expect(containsTickerDirection('投信加碼聯發科').hit).toBe(false)
  })

  it('shouldStillHitUnattributedDirectionOnNamedStock', () => {
    // 自家未歸因 reader-facing：仍擋
    expect(containsTickerDirection('台積電可加碼').hit).toBe(true)
  })

  it('shouldNotHitWhenDistanceExceeds25Chars', () => {
    const text = '2330 的財報公布後、市場反應不一、雖然某些外資法人最近因為匯率因素偏多台灣金融股'
    expect(containsTickerDirection(text).hit).toBe(false)
  })

  it('shouldHitMultipleTwStockNames', () => {
    expect(containsTickerDirection('鴻海看空').hit).toBe(true)
    expect(containsTickerDirection('聯發科做多').hit).toBe(true)
    expect(containsTickerDirection('大立光轉空').hit).toBe(true)
  })

  it('shouldNotHitWhenTickerHasNoDirectionNearby', () => {
    expect(containsTickerDirection('2330 財報超過預期').hit).toBe(false)
  })

  it('shouldRespectTickerBoundaryNotPartialMatch', () => {
    expect(containsTickerDirection('序號 12345678 看多').hit).toBe(false)
  })

  it('shouldReturnSnippetWithContext', () => {
    const r = containsTickerDirection('今日焦點 2330 看多、因為外資連三買')
    expect(r.hit).toBe(true)
    expect(r.snippet).toContain('2330')
    expect(r.snippet).toContain('看多')
  })

  it('shouldNotTreatUnitSuffixedNumberAsTicker', () => {
    // 「1893點」是跌點不是股號；附近即使有未歸因方向詞也不該命中
    expect(containsTickerDirection('台股週跌1893點、後市看空').hit).toBe(false)
    // 對照：真股號 2330 後接方向詞仍命中
    expect(containsTickerDirection('2330 看多').hit).toBe(true)
  })
})

describe('checkCompliance', () => {
  it('returns null when text is clean', () => {
    expect(checkCompliance('半導體產業整體看好')).toBeNull()
  })
  it('returns forbidden violation when phrase hit', () => {
    const r = checkCompliance('建議買台積電')
    expect(r?.violation).toBe('forbidden')
    expect(r?.matched).toBeTruthy()
  })
  it('returns ticker-direction violation for ticker + verb', () => {
    // 使用 加碼（只在 FORBIDDEN_PHRASES 裡以「建議加碼」出現、單獨不命中）
    // 但 containsTickerDirection 會偵測 ticker + 方向動詞組合
    const r = checkCompliance('2330 加碼')
    expect(r?.violation).toBe('ticker-direction')
    expect(r?.matched).toBeTruthy()
  })
  it('forbidden takes precedence over ticker-direction', () => {
    const r = checkCompliance('建議買 2330 看多')
    expect(r?.violation).toBe('forbidden')
  })

  it('allows factual macro reporting that previously false-positived (6/27 regression)', () => {
    const snippet = '度最為劇烈，成為外資減碼的主要重災區。\n台股週跌1893點　上市公司市值縮水'
    expect(checkCompliance(snippet)).toBeNull()
  })

  it('still blocks reader-directed recommendation routed through 散戶 (not a third-party actor)', () => {
    // 散戶＝讀者本身、不是他方主體：對散戶的指示仍是個人化建議、必須擋
    expect(checkCompliance('建議散戶加碼台積電')).not.toBeNull()
    expect(checkCompliance('散戶可加碼台積電')).not.toBeNull()
  })
})
