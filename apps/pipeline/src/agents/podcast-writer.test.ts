import type { MarketBrief, Narrative, Podcast } from '@suanomics/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callAgent } from './call-agent.js'
import { DailyCostLimitExceededError } from './cost-gate.js'
import { buildMarketCloseFraming } from './market-close-framing.js'
import { callPodcastWriter } from './podcast-writer.js'

// callAgent 換成假實作，測試不打 API
vi.mock('./call-agent.js', async () => {
  const actual = await vi.importActual<typeof import('./call-agent.js')>('./call-agent.js')
  return { ...actual, callAgent: vi.fn() }
})

const FAKE_NARRATIVE: Narrative = {
  intro: '今日科技板塊呈現結構性分化、AI 算力需求拉動上游設備鏈。',
  sections: [
    { heading: 'AI 算力與半導體鏈', takeaway: null, body: '輝達 GTC 釋出 Blackwell 進度、台積電 CoWoS 產能持續擴張。', relatedNewsIds: ['n1', 'n2'], claimIds: [], citationUrls: ['https://example.com/a'] },
    { heading: '地緣政治與能源', takeaway: null, body: '中東緊張推升油價、能源股上揚。', relatedNewsIds: ['n3'], claimIds: [], citationUrls: ['https://example.com/c'] },
  ],
  outro: '科技與地緣風險併行、配置上需平衡。',
}

const FAKE_BRIEF: MarketBrief = {
  headline: '科技算力與地緣風險併行',
  summary: '...',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [
    { url: 'https://example.com/a', title: 'NVDA GTC', quote: 'q' },
    { url: 'https://example.com/b', title: 'TSMC CoWoS', quote: 'q' },
    { url: 'https://example.com/c', title: 'Hormuz', quote: 'q' },
  ],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
  narrative: FAKE_NARRATIVE,
  newsTitlesById: { n1: 'NVDA news', n2: 'TSMC news', n3: 'Geopolitics news' },
}

function fakeValidPodcast(overrides: Partial<Podcast> = {}): Podcast {
  return {
    briefDate: '2026-04-30',
    hook: {
      headline: '今天聊一個你可能還沒注意到的訊號 — 不是輝達、是電力',
      body: '我胖胖、回來陪你聊本日財經。'.repeat(15),
    },
    acts: [
      {
        actTitle: 'AI 算力的真正瓶頸',
        storyline: 'ai-tech',
        body: '我們先聊聊輝達。從 brief 上看、AI 算力需求展望保持樂觀。'.repeat(20),
        citationUrls: ['https://example.com/a', 'https://example.com/b'],
        relatedNewsIds: ['n1', 'n2'],
      },
      {
        actTitle: '地緣政治的能源訊號',
        storyline: 'geopolitics',
        body: '接下來最有意思的是中東情勢、油價如何牽動產業鏈。'.repeat(20),
        citationUrls: ['https://example.com/c'],
        relatedNewsIds: ['n3'],
      },
      {
        actTitle: '對整體配置的反思與展望',
        storyline: 'other',
        body: '換個角度看、這幾條訊號其實都指向一個共同的問題。'.repeat(20),
        citationUrls: ['https://example.com/a'],
        relatedNewsIds: ['n1'],
      },
    ],
    takeaway: {
      body: '想想看、如果這些訊號是真的、我們該怎麼配置？'.repeat(10),
    },
    meta: {
      totalChars: 2200,
      persona: 'panpan',
      generatedAt: '2026-04-30T01:00:00.000Z',
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('callPodcastWriter — happy path', () => {
  it('returns parsed podcast when the model emits valid JSON', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    const result = await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })
    expect(result.podcast).not.toBeNull()
    expect(result.podcast?.acts).toHaveLength(3)
    expect(result.audit.failed).toBe(false)
  })

  it('emits non-null totalChars in result podcast.meta', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    const result = await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })
    expect(result.podcast?.meta.totalChars).toBeGreaterThanOrEqual(1800)
    expect(result.podcast?.meta.totalChars).toBeLessThanOrEqual(2800)
  })
})

describe('callPodcastWriter — edge cases', () => {
  it('filters unknown citation URLs and falls back to a valid one', async () => {
    const podcast = fakeValidPodcast({
      acts: [
        {
          actTitle: 'Some title',
          storyline: 'ai-tech',
          body: 'Body content. '.repeat(40),
          citationUrls: ['https://hallucinated.com/x', 'https://example.com/a'],
          relatedNewsIds: ['n1'],
        },
        // eslint-disable-next-line ts/no-non-null-assertion -- fakeValidPodcast always returns 3 acts
        fakeValidPodcast().acts[1]!,
        // eslint-disable-next-line ts/no-non-null-assertion -- fakeValidPodcast always returns 3 acts
        fakeValidPodcast().acts[2]!,
      ],
    })
    vi.mocked(callAgent).mockResolvedValueOnce(podcast as unknown)
    const result = await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })
    expect(result.podcast).not.toBeNull()
    expect(result.podcast?.acts[0]?.citationUrls).not.toContain('https://hallucinated.com/x')
    expect(result.podcast?.acts[0]?.citationUrls).toContain('https://example.com/a')
  })

  it('clamps body that exceeds 800 chars instead of rejecting', async () => {
    const podcast = fakeValidPodcast({
      acts: [
        {
          actTitle: 'Long body act',
          storyline: 'ai-tech',
          body: 'x'.repeat(5000), // way over 800
          citationUrls: ['https://example.com/a'],
          relatedNewsIds: ['n1'],
        },
        // eslint-disable-next-line ts/no-non-null-assertion -- fakeValidPodcast always returns 3 acts
        fakeValidPodcast().acts[1]!,
        // eslint-disable-next-line ts/no-non-null-assertion -- fakeValidPodcast always returns 3 acts
        fakeValidPodcast().acts[2]!,
      ],
    })
    vi.mocked(callAgent).mockResolvedValueOnce(podcast as unknown)
    const result = await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })
    expect(result.podcast?.acts[0]?.body.length).toBeLessThanOrEqual(800)
  })

  it('returns null + audit.failed=true when both attempts fail with zod errors', async () => {
    const broken = { briefDate: '2026-04-30', hook: { headline: 'too short', body: 'short' } }
    vi.mocked(callAgent)
      .mockResolvedValueOnce(broken as unknown)
      .mockResolvedValueOnce(broken as unknown)
    const result = await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })
    expect(result.podcast).toBeNull()
    expect(result.audit.failed).toBe(true)
    expect(result.audit.retryReason).toBe('zod-parse')
  })

  it('degrades to null when a hard forbidden phrase survives sanitize (compliance gate)', async () => {
    // 「建議買」在 FORBIDDEN_PHRASES 但不在 COMPLIANCE_REWRITE_MAP → 不被 rewriteText 改掉 → 觸發硬 gate
    const dirty = fakeValidPodcast({
      acts: [
        {
          actTitle: '硬推薦詞觸發 gate 測試',
          storyline: 'ai-tech',
          body: '我看下來啊、建議買這檔股票。'.repeat(40), // ~560 字 > min(300)，含硬禁用詞
          citationUrls: ['https://example.com/a'],
          relatedNewsIds: ['n1'],
        },
        // eslint-disable-next-line ts/no-non-null-assertion -- fakeValidPodcast always returns 3 acts
        fakeValidPodcast().acts[1]!,
        // eslint-disable-next-line ts/no-non-null-assertion -- fakeValidPodcast always returns 3 acts
        fakeValidPodcast().acts[2]!,
      ],
    })
    vi.mocked(callAgent)
      .mockResolvedValueOnce(dirty as unknown)
      .mockResolvedValueOnce(dirty as unknown)
    const result = await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })
    expect(result.podcast).toBeNull()
    expect(result.audit.failed).toBe(true)
  })

  it('sanitizes forbidden trading verbs ("看多" → "動能延續") and counts hits', async () => {
    const dirty = fakeValidPodcast({
      acts: [
        {
          actTitle: 'Some title',
          storyline: 'ai-tech',
          body: '我看下來啊、輝達看多。'.repeat(40), // 看多 = forbidden; .repeat(40) ~440 chars > min(300)
          citationUrls: ['https://example.com/a'],
          relatedNewsIds: ['n1'],
        },
        // eslint-disable-next-line ts/no-non-null-assertion -- fakeValidPodcast always returns 3 acts
        fakeValidPodcast().acts[1]!,
        // eslint-disable-next-line ts/no-non-null-assertion -- fakeValidPodcast always returns 3 acts
        fakeValidPodcast().acts[2]!,
      ],
    })
    vi.mocked(callAgent).mockResolvedValueOnce(dirty as unknown)
    const result = await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })
    expect(result.podcast?.acts[0]?.body).not.toContain('看多')
    expect(result.podcast?.acts[0]?.body).toContain('動能延續')
    expect(result.audit.forbiddenSanitized).toBeGreaterThan(0)
  })
})

describe('callPodcastWriter narrative section rendering', () => {
  it('renders narrative section heading (not newsId) in user content', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).toContain('AI 算力與半導體鏈')
    expect(args?.userContent).not.toContain('newsId=')
  })
})

describe('callPodcastWriter calendar injection', () => {
  it('podcast user content includes econ calendar when provided', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({
      briefDate: '2026-04-30',
      brief: FAKE_BRIEF,
      calendarBlock: '## 本週財經行事曆\n- 2026-06-17：FOMC 利率決策（US、high）',
    })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).toContain('# 行事曆參考（前瞻素材；只可引用列出的事件與日期）')
    expect(args?.userContent).toContain('## 本週財經行事曆')
  })

  it('podcast user content omits calendar section when null', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF, calendarBlock: null })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).not.toContain('行事曆參考')
  })
})

describe('callPodcastWriter storyline injection', () => {
  it('podcast user content includes storyline block when provided', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({
      briefDate: '2026-04-30',
      brief: FAKE_BRIEF,
      storylineBlock: '## 追蹤線\n- 半導體出口管制：本週新增禁令',
    })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).toContain('# 敘事線參考（可自然回顧這些追蹤線的進展與先前論點；只可引用列出的內容、無進展的線不要硬提）')
    expect(args?.userContent).toContain('## 追蹤線')
  })

  it('podcast user content omits storyline section when null', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF, storylineBlock: null })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).not.toContain('敘事線參考')
  })
})

describe('callPodcastWriter market snapshot injection', () => {
  it('podcast user content includes market snapshot when provided', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({
      briefDate: '2026-04-30',
      brief: FAKE_BRIEF,
      marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點（+0.8%）',
    })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).toContain('# 市場數據參考')
    expect(args?.userContent).toContain('## 今日市場數據')
    expect(args?.userContent).toContain('23,150')
  })

  it('podcast user content omits market snapshot section when null', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF, marketSnapshot: null })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).not.toContain('市場數據參考')
  })
})

describe('callPodcastWriter market-close framing injection (defense-in-depth)', () => {
  it('podcast user content includes 台股 close framing block when provided', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({
      briefDate: '2026-06-27',
      brief: FAKE_BRIEF,
      marketCloseFraming: buildMarketCloseFraming('2026-06-26', '2026-06-27'),
    })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).toContain('市場收盤時間框架')
    expect(args?.userContent).toContain('台股（加權指數）最近收盤：昨日')
  })

  it('podcast user content omits close framing when null', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    await callPodcastWriter({ briefDate: '2026-06-27', brief: FAKE_BRIEF, marketCloseFraming: null })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).not.toContain('市場收盤時間框架')
  })

  it('podcast user content omits close framing when empty string (degrade)', async () => {
    vi.mocked(callAgent).mockResolvedValueOnce(fakeValidPodcast() as unknown)
    // taiexCloseDate 為 null → buildMarketCloseFraming 回 '' → 不注入
    await callPodcastWriter({
      briefDate: '2026-06-27',
      brief: FAKE_BRIEF,
      marketCloseFraming: buildMarketCloseFraming(null, '2026-06-27'),
    })
    const args = vi.mocked(callAgent).mock.calls[0]?.[1]
    expect(args?.userContent).not.toContain('市場收盤時間框架')
  })
})

describe('callPodcastWriter — 花費閘', () => {
  it('花費閘擋下時往外丟，不當成一般失敗重試或吞掉', async () => {
    vi.mocked(callAgent).mockRejectedValueOnce(new DailyCostLimitExceededError(0.3, 0.31))
    await expect(callPodcastWriter({ briefDate: '2026-04-30', brief: FAKE_BRIEF })).rejects.toBeInstanceOf(DailyCostLimitExceededError)
    expect(callAgent).toHaveBeenCalledTimes(1)
  })
})
