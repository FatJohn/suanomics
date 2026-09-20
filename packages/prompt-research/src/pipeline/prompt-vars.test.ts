import { describe, expect, it } from 'vitest'
import { PODCAST_PROMPT_VARS, YT_PROMPT_VARS } from './prompt-vars.js'

describe('yT_PROMPT_VARS', () => {
  it('declares sourceKindLabel as "YouTube" (platform-only, episode-type suffix supplied by episodeWord)', () => {
    // 此值為「平台名」、不含 episode-type 後綴。原 yt prompts 中 segmenter 用
    // 「YouTube 直播」、consolidator 用「YouTube」、為求 byte-for-byte 保留兩處字面、
    // sourceKindLabel 設成 'YouTube'、segmenter 模板額外串上 episodeWord。
    expect(YT_PROMPT_VARS.sourceKindLabel).toBe('YouTube')
  })

  it('declares episodeWord as "直播"', () => {
    expect(YT_PROMPT_VARS.episodeWord).toBe('直播')
  })

  it('declares digestTitlePrefix as "YT Analyst Digest"', () => {
    expect(YT_PROMPT_VARS.digestTitlePrefix).toBe('YT Analyst Digest')
  })
})

describe('pODCAST_PROMPT_VARS', () => {
  // 與 YT_PROMPT_VARS 同紀律：sourceKindLabel 只放平台名、episodeWord 補上 unit 後綴。
  // 原 yt prompts 模板組裝後在 yt path 產出 `財經 YouTube 直播` / `這集直播`、
  // 注入 podcast vars 後產出 `財經 Podcast 節目` / `這集節目`。
  it('declares sourceKindLabel as "Podcast" (platform-only)', () => {
    expect(PODCAST_PROMPT_VARS.sourceKindLabel).toBe('Podcast')
  })

  it('declares episodeWord as "節目"', () => {
    expect(PODCAST_PROMPT_VARS.episodeWord).toBe('節目')
  })

  it('declares digestTitlePrefix as "Podcast Analyst Digest"', () => {
    expect(PODCAST_PROMPT_VARS.digestTitlePrefix).toBe('Podcast Analyst Digest')
  })

  it('does not share field values with YT_PROMPT_VARS', () => {
    expect(PODCAST_PROMPT_VARS.sourceKindLabel).not.toBe(YT_PROMPT_VARS.sourceKindLabel)
    expect(PODCAST_PROMPT_VARS.episodeWord).not.toBe(YT_PROMPT_VARS.episodeWord)
    expect(PODCAST_PROMPT_VARS.digestTitlePrefix).not.toBe(YT_PROMPT_VARS.digestTitlePrefix)
  })
})
