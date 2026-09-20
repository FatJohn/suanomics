import { describe, expect, it } from 'vitest'
import { PODCAST_PROMPT_VARS, YT_PROMPT_VARS } from '../pipeline/prompt-vars.js'
import { buildTranscriptToDigestPrompt, extractVideoIdsFromEpisodes } from './transcript-to-digest.js'

// Pre-refactor baseline — captured BEFORE 把 yt 字眼參數化、用來保 yt path
// byte-for-byte 不變。同 segmenter / lens / consolidator 紀律。
const YT_DISTILLER_PROMPT_BASELINE = `你收到一份來自 YT KOL 直播 7 集的「萬言 Digest」markdown、由 consolidator 產出。
你的任務：把這份 markdown 萃取成嚴格符合 DigestSchema 的 JSON。

抽取原則：
1. analystFrames：把 digest Section 2 的 10-15 條「Frame N」mapping 成 DigestSchema.analystFrames
   - 每個 frame 的 name 取自 Section 2 的「Frame N：<招式一句話命名>」
   - description 從「邏輯敘事」段落節錄（≤ 200 字）
   - whenToApply 從「適用情境」節錄
   - questions：從 frame 的內容改寫成 3-5 條具體可執行 questions（針對單則新聞事件）
2. vocabulary：從 digest 全文抽出中性分析詞 vs KOL 口語對照、最多 10 組
3. compliance.redFlags：digest Section 6 的合規重點
4. 回應嚴格 DigestSchema JSON。

【禁止】輸出含「建議買/賣/持有」等指令式；不得含個股 ticker + 方向性動詞組合。`

describe('buildTranscriptToDigestPrompt', () => {
  it('matches yt baseline byte-for-byte when given YT_PROMPT_VARS', () => {
    // Invariance gate：注入 yt vars 後輸出必須與 pre-refactor baseline 完全一致、
    // 避免 podcast 參數化時意外改動 yt prompt 字面。
    expect(buildTranscriptToDigestPrompt(YT_PROMPT_VARS)).toBe(YT_DISTILLER_PROMPT_BASELINE)
  })

  it('mentions DigestSchema regardless of source', () => {
    expect(buildTranscriptToDigestPrompt(YT_PROMPT_VARS)).toContain('DigestSchema')
    expect(buildTranscriptToDigestPrompt(PODCAST_PROMPT_VARS)).toContain('DigestSchema')
  })

  it('frames source kind from vars (yt → YT KOL 直播, podcast → Podcast KOL 節目)', () => {
    expect(buildTranscriptToDigestPrompt(YT_PROMPT_VARS)).toContain('YT KOL 直播')
    expect(buildTranscriptToDigestPrompt(PODCAST_PROMPT_VARS)).toContain('Podcast KOL 節目')
  })

  it('does not leak yt vocab into podcast prompt', () => {
    const podcastPrompt = buildTranscriptToDigestPrompt(PODCAST_PROMPT_VARS)
    expect(podcastPrompt).not.toContain('YT KOL')
    expect(podcastPrompt).not.toContain('直播')
  })
})

describe('buildTranscriptToDigestPrompt additional coverage', () => {
  it('keeps digestTitlePrefix-derived word for distiller source label', () => {
    // yt: digestTitlePrefix='YT Analyst Digest' → first word 'YT'
    // podcast: digestTitlePrefix='Podcast Analyst Digest' → first word 'Podcast'
    expect(buildTranscriptToDigestPrompt(YT_PROMPT_VARS).split('\n')[0]).toContain('YT')
    expect(buildTranscriptToDigestPrompt(PODCAST_PROMPT_VARS).split('\n')[0]).toContain('Podcast')
  })
})

describe('extractVideoIdsFromEpisodes', () => {
  it('pulls out episodeIds', () => {
    type MinimalEpisode = Parameters<typeof extractVideoIdsFromEpisodes>[0][0]
    const result = extractVideoIdsFromEpisodes([
      { episodeId: 'abc' } as unknown as MinimalEpisode,
      { episodeId: 'def' } as unknown as MinimalEpisode,
    ])
    expect(result).toEqual(['abc', 'def'])
  })
})
