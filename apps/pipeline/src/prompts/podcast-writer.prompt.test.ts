import { containsForbiddenPhrase, FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { PODCAST_WRITER_SYSTEM_PROMPT } from './podcast-writer.prompt.js'
import { FORBIDDEN_PHRASES_LINE } from './source-authority.js'

describe('podcastWriter prompt — 子軸2 兜底保留（防誤刪）', () => {
  it('keeps the de-jargon framing + denylist interpolation', () => {
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('白話優先')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('嚴禁')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('抽象評價贅詞')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('資本配置效率')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('營運效率指標趨於穩健')
  })
  it('keeps the 絕對禁止 compliance block', () => {
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('絕對禁止')
  })
  it('帶入 shared 的 compliance 禁用語清單', () => {
    for (const phrase of FORBIDDEN_PHRASES)
      expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain(phrase)
  })
  // prompt 不另抄一份清單，也不拿禁用語當反例：shared 清單更新時抄本不會跟著變，模型也會照範例寫。
  it('只在 shared 清單那一行出現禁用語', () => {
    const outsideList = PODCAST_WRITER_SYSTEM_PROMPT.replaceAll(FORBIDDEN_PHRASES_LINE, '')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain(FORBIDDEN_PHRASES_LINE)
    expect(containsForbiddenPhrase(outsideList)).toEqual({ hit: false })
  })
})

describe('podcastWriter prompt — 賽博半仙人設', () => {
  it('introduces the new persona + show + slogan', () => {
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('賽博半仙')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('掐指連總經')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('算命不如算力')
  })
  it('drops the old 胖胖 persona from the prompt body', () => {
    expect(PODCAST_WRITER_SYSTEM_PROMPT).not.toContain('胖胖')
  })
  it('frames fortune-telling as compliant (連動 not 明牌, no prediction)', () => {
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('連動')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('不預測')
  })
})

describe('podcastWriter prompt — 台詞感指引', () => {
  it('instructs spoken texture and names the written-prose tells to avoid', () => {
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('台詞感')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('反問')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('換句話說') // listed as a tell to avoid
  })
})

// 防回歸：台詞感「寧短勿長」曾把 Gemini 推到 schema 硬下限以下（act<300 / total<1800）、
// 整集 zod-parse degrade 成 null。長度指引必須點明 schema 下限、不可只說「短」。
describe('podcastWriter prompt — 長度下限守衛（schema 對齊）', () => {
  it('states the act floor and total floor so output passes PodcastSchema', () => {
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('1800') // totalChars 下限
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('300') // act.body 下限
  })
})

describe('podcastWriter prompt — 具名數字紀律', () => {
  it('含具名數字規則 + 禁推算/編造', () => {
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('具名數字')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('禁止自行推算')
    expect(PODCAST_WRITER_SYSTEM_PROMPT).toContain('阿拉伯數字')
  })
})
