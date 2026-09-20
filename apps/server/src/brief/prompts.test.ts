import type { RecentNews, TargetNews } from './prompts.js'
import { FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { buildMarketBriefSystemPrompt, buildMarketBriefUserPrompt } from './prompts.js'

describe('buildMarketBriefSystemPrompt', () => {
  it('shouldContainAnalystRoleAndForbiddenPhrasesClause', () => {
    const p = buildMarketBriefSystemPrompt()
    expect(p).toContain('財經新聞分析師')
    expect(p).toContain('非投資建議')
    expect(p).toContain('信心水準')
    expect(p).toContain('MarketBriefSchema')
    // 禁用字 clause 必列出 @suanomics/shared FORBIDDEN_PHRASES
    expect(p).toContain('建議買')
    expect(p).toContain('建議攤平')
  })

  it('shouldRenderEveryForbiddenPhraseFromSingleSourceOfTruth', () => {
    const p = buildMarketBriefSystemPrompt()
    for (const phrase of FORBIDDEN_PHRASES)
      expect(p).toContain(`「${phrase}」`)
  })
})

describe('buildMarketBriefUserPrompt', () => {
  const target: TargetNews = {
    title: '川普宣布半導體關稅',
    sourceName: 'DemoNews',
    publishedAt: '2026-04-20',
    content: '美國宣布對半導體加徵 25% 關稅…',
  }
  const recent: RecentNews[] = [
    { title: '台積電 Q1 財報優於預期', url: 'https://x/1' },
    { title: '匯率走勢', url: 'https://x/2' },
  ]

  it('shouldIncludeTargetTitleSourceAndContent', () => {
    const p = buildMarketBriefUserPrompt(target, recent)
    expect(p).toContain('川普宣布半導體關稅')
    expect(p).toContain('DemoNews')
    expect(p).toContain('2026-04-20')
    expect(p).toContain('25%')
  })

  it('shouldIncludeRecentNewsAsBulletList', () => {
    const p = buildMarketBriefUserPrompt(target, recent)
    expect(p).toContain('- 台積電 Q1 財報優於預期 (https://x/1)')
    expect(p).toContain('- 匯率走勢 (https://x/2)')
  })

  it('shouldReferenceSchemaName', () => {
    expect(buildMarketBriefUserPrompt(target, recent)).toContain('MarketBriefSchema')
  })
})

describe('buildMarketBriefSystemPrompt (supplement injection removed)', () => {
  it('shouldNotInjectYtPromptSupplementContent', () => {
    const prompt = buildMarketBriefSystemPrompt()
    expect(prompt).not.toContain('## Supplement')
    expect(prompt).not.toContain('yt-prompt-supplement')
    expect(prompt).not.toContain('【補充分析模式參考】')
  })

  it('shouldNotThrowWhenSupplementFileDoesNotExist', () => {
    expect(() => buildMarketBriefSystemPrompt()).not.toThrow()
  })

  it('shouldReturnBaseMarketBriefPrompt', () => {
    const prompt = buildMarketBriefSystemPrompt()
    expect(prompt.length).toBeGreaterThan(100)
    expect(prompt).toContain('財經新聞分析師')
  })
})
