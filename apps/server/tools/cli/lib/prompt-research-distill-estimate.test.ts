import type { SourceSpec } from '@suanomics/prompt-research'
import type { LlmRunEstimate } from './llm-run-budget.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estimateTotalCalls } from './llm-run-budget.js'
import {
  estimatePromptResearchDistill,
  PROMPT_RESEARCH_CONSOLIDATOR_CALLS_PER_RUN,
  PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN,
  PROMPT_RESEARCH_DISTILL_HTTP_MULTIPLIER,
  PROMPT_RESEARCH_LENS_CALLS_PER_LENS,
  PROMPT_RESEARCH_SEGMENTER_CALLS_PER_EPISODE,
  PROMPT_RESEARCH_STT_CALLS_PER_EPISODE,
} from './prompt-research-distill-estimate.js'

function podcastSpec(count: number, slug = 'podcast'): SourceSpec {
  return { kind: 'podcast-rss', slug, displayName: slug, pipeline: 'deep', config: { rssUrl: 'https://x/feed.xml', count } }
}
function ytSpec(count: number, slug = 'yt'): SourceSpec {
  return { kind: 'yt-transcript', slug, displayName: slug, pipeline: 'deep', config: { playlistUrl: 'https://x/streams', count } }
}
function skillSpec(slug = 'skill'): SourceSpec {
  return { kind: 'skill-markdown', slug, displayName: slug, pipeline: 'light', config: { repoOwner: 'o', repoName: 'r', skillPath: 'p', ref: 'main' } }
}
/** custom-text 用真的本機檔案（readCustomText 同步讀檔，不用另外 mock 網路）。 */
function customTextSpec(filePath: string, slug = 'custom'): SourceSpec {
  return { kind: 'custom-text', slug, displayName: slug, pipeline: 'light', config: { filePath } }
}

/**
 * terms 的 HTTP 最壞值（units × callsPerUnit × httpMultiplier 加總）；llm-run-budget.ts 內部
 * 沒 export 這個算法，這裡直接照它的公式重算一次，只為了在測試裡斷言 formatLlmRunBudgetReport
 * 會印出的那個數字，不代表本檔認為它該被 export。
 */
function httpWorstCase(e: LlmRunEstimate): number {
  return e.terms.reduce((sum, t) => sum + t.units * t.callsPerUnit * t.httpMultiplier, 0)
}

describe('estimatePromptResearchDistill：公式（參照值：podcast count=5 約 86 次）', () => {
  it('podcast-rss count=5 → 86（= 5 × (2 segmenter + 12 lens + 2 STT) + 3 consolidator + 3 distill）', () => {
    expect(estimateTotalCalls(estimatePromptResearchDistill([podcastSpec(5)]))).toBe(86)
  })

  it('yt-transcript count=5 → 76（同 podcast 但無 STT）', () => {
    expect(estimateTotalCalls(estimatePromptResearchDistill([ytSpec(5)]))).toBe(76)
  })

  it('skill-markdown／custom-text 固定 3 次（distillSkillToDigest 的外層業務重試）', () => {
    expect(estimateTotalCalls(estimatePromptResearchDistill([skillSpec()]))).toBe(3)
  })

  it('config 沒帶合法 count 時 fallback 到 YtSourceConfigSchema/PodcastRssConfigSchema 的預設值 5', () => {
    const specWithoutCount: SourceSpec = { kind: 'podcast-rss', slug: 'p', displayName: 'p', pipeline: 'deep', config: { rssUrl: 'https://x/feed.xml' } }
    expect(estimateTotalCalls(estimatePromptResearchDistill([specWithoutCount]))).toBe(86)
  })

  it('多個 source 加總（1 個 podcast count=5 + 2 個 skill）', () => {
    const e = estimatePromptResearchDistill([podcastSpec(5), skillSpec('a'), skillSpec('b')])
    expect(estimateTotalCalls(e)).toBe(86 + 3 + 3)
  })

  // segmenter／lens／STT 直接呼叫 GoogleGenAI、沒有 gemini-client.ts callGemini() 那層
  // transport retry，httpMultiplier 應為 1，不是 DEFAULT_HTTP_MULTIPLIER=3——套錯會讓
  // formatLlmRunBudgetReport 印出的「HTTP 最壞值」失真（曾經誤印 252，真值 92）。
  it('podcast count=5 的 HTTP 最壞值 = 92（80 個直接呼叫 + 3 consolidator + 9 distill 的 outer×inner）', () => {
    expect(httpWorstCase(estimatePromptResearchDistill([podcastSpec(5)]))).toBe(92)
  })
})

describe('estimatePromptResearchDistill：peak（deep-pipeline pMap(EPISODE_CONCURRENCY=3) × lens-extractors pMap(LENS_CONCURRENCY=3) 兩層巢狀）', () => {
  it('count=1 → peak=3（min(1,3)×min(6,3)）', () => {
    expect(estimatePromptResearchDistill([podcastSpec(1)]).peak).toBe(3)
  })

  it('count=2 → peak=6（min(2,3)×min(6,3)，在 MAX_SAFE_LLM_PEAK=10 門檻內）', () => {
    expect(estimatePromptResearchDistill([podcastSpec(2)]).peak).toBe(6)
  })

  it('count=3 與 count=100 peak 相同 = 9（min(count,3) 封頂在 3，未超過 MAX_SAFE_LLM_PEAK=10）', () => {
    expect(estimatePromptResearchDistill([podcastSpec(3)]).peak).toBe(9)
    expect(estimatePromptResearchDistill([podcastSpec(100)]).peak).toBe(9)
  })

  it('skill-markdown 無扇出，peak=1', () => {
    expect(estimatePromptResearchDistill([skillSpec()]).peak).toBe(1)
  })

  it('多個 source 的 peak 取最大值、不是加總（podcast count=1 peak=3 + skill peak=1 → 仍是 3）', () => {
    expect(estimatePromptResearchDistill([podcastSpec(1), skillSpec()]).peak).toBe(3)
  })
})

// ── mock 邊界：只 mock @google/genai 與 fetch 這兩個外部邊界，真的呼叫 @suanomics/prompt-research 的
// dispatchSource（真 segmenter/lens-extractors/consolidator/transcript-to-digest/gemini-stt 邏輯）。
//
// 教訓：如果每個 stage「該重試幾次才成功」是測試自己決定的（例如寫死一張
// `{segmenter: 2, consolidator: 3, ...}` 的表），那麼改套件本身的 MAX_ATTEMPTS 不會讓任何
// 測試變紅——測試鎖住的是自己那張表，不是套件行為。下面分兩種用法：
//
// 1. `behaviors` 設 'succeed-after'：模擬「重試到最後一次才成功」，`failsBefore` 直接讀
//    exported 常數（不是另外複製一份數字），驗證「假設常數正確，估算的加總邏輯／wiring
//    對不對」——這是「整條 pipeline 有沒有漏接某個 stage」的檢查。
// 2. 探針（'always-*'）：讓目標分類永遠回壞回應，逼套件自己的重試迴圈跑到 throw 為止，
//    數「丟出例外那一刻」目標分類被呼叫幾次——這個數字完全由套件程式碼決定，測試只是
//    數數，鎖的是「係數常數 === 套件真實行為」，改套件 MAX_ATTEMPTS 這裡就會紅。

type StageBehavior
  = | { kind: 'succeed-after', failsBefore: number }
    | { kind: 'always-empty' }
    | { kind: 'always-bad-json' }
    | { kind: 'always-throw' }

interface GenerateContentParams {
  config?: { responseSchema?: { properties?: Record<string, unknown> } }
  contents?: unknown
}

const geminiState = vi.hoisted(() => ({
  calls: {} as Record<string, number>,
  behaviors: {} as Record<string, StageBehavior>,
}))

function classifyGeminiCall(params: GenerateContentParams): string {
  const props = params.config?.responseSchema?.properties
  if (props) {
    const keys = Object.keys(props)
    if (keys.includes('segments'))
      return 'segmenter'
    if (keys.includes('analystFrames'))
      return 'distill'
    if (keys.includes('events'))
      return 'lens:events'
    if (keys.includes('sources'))
      return 'lens:sources'
    if (keys.includes('entities'))
      return 'lens:entities'
    if (keys.includes('chains'))
      return 'lens:chains'
    if (keys.includes('impacts'))
      return 'lens:impacts'
    if (keys.includes('frames'))
      return 'lens:frames'
  }
  if (Array.isArray(params.contents))
    return 'stt'
  return 'consolidator'
}

function geminiSuccessText(kind: string): string {
  switch (kind) {
    case 'segmenter':
      return JSON.stringify({
        episodeId: 'ep1',
        durationSec: 600,
        segments: [{ startSec: 0, endSec: 10, topic: 'other', headline: 'h', relevance: 0.5 }],
        keptTopics: [],
        droppedMinutes: { joke: 0, ad: 0, chitchat: 0, other: 0 },
      })
    case 'lens:events':
      return JSON.stringify({ episodeId: 'ep1', events: [] })
    case 'lens:sources':
      return JSON.stringify({ episodeId: 'ep1', sources: [] })
    case 'lens:entities':
      return JSON.stringify({ episodeId: 'ep1', entities: [] })
    case 'lens:chains':
      return JSON.stringify({ episodeId: 'ep1', chains: [] })
    case 'lens:impacts':
      return JSON.stringify({ episodeId: 'ep1', impacts: [] })
    case 'lens:frames':
      return JSON.stringify({ episodeId: 'ep1', frames: [] })
    case 'distill':
      return JSON.stringify({ analystFrames: [{ name: 'a', description: 'd', whenToApply: 'w', questions: ['q'] }] })
    case 'consolidator':
      return '測試 consolidated markdown output，無違規字眼'
    case 'stt':
      return '逐字稿內容，無違規字眼'
    default:
      throw new Error(`unclassified gemini call in test mock: ${kind}`)
  }
}

/**
 * empty text 觸發 stt／consolidator 的「empty response」重試分支；非空但不是合法 JSON 觸發
 * segmenter／lens／distill 的 extractJson SyntaxError 重試分支——兩者觸發的重試分支不同，
 * 不能共用同一種壞回應（詳見各檔的 catch 分支：segmenter 只認 ZodError/SyntaxError，
 * consolidator 只認 empty response，見 packages/prompt-research 對應檔案）。
 */
function badResponseFor(kind: string): string {
  return kind === 'stt' || kind === 'consolidator' ? '' : 'not-json'
}

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor(_opts: unknown) {}

    models = {
      generateContent: async (params: GenerateContentParams): Promise<{ text: string }> => {
        const kind = classifyGeminiCall(params)
        geminiState.calls[kind] = (geminiState.calls[kind] ?? 0) + 1
        const behavior = geminiState.behaviors[kind] ?? { kind: 'succeed-after', failsBefore: 0 }
        if (behavior.kind === 'succeed-after') {
          const attemptNo = geminiState.calls[kind]
          if (attemptNo <= behavior.failsBefore)
            return { text: badResponseFor(kind) }
          return { text: geminiSuccessText(kind) }
        }
        if (behavior.kind === 'always-empty')
          return { text: '' }
        if (behavior.kind === 'always-bad-json')
          return { text: 'not-json' }
        // always-throw：模擬 transport 失敗，只有 distill／skill 那層的 gemini-client.ts
        // callGemini() 自己有內層重試會接住這個；其餘 stage 直接呼叫 GoogleGenAI、
        // 這個例外會直接冒出去（沒有內層 wrapper 再重試）。
        throw new Error('simulated transport failure (probe)')
      },
    }
  },
}))

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Test Podcast</title>
    <item>
      <title>Ep 1</title>
      <guid isPermaLink="false">ep-1</guid>
      <pubDate>Mon, 01 Sep 2026 00:00:00 GMT</pubDate>
      <link>https://example.com/podcast/ep-1</link>
      <itunes:duration>600</itunes:duration>
      <enclosure url="https://example.com/audio/ep1.mp3" type="audio/mpeg" length="1000" />
    </item>
  </channel>
</rss>`

async function runProbe(spec: SourceSpec = podcastSpec(1)): Promise<unknown> {
  const { dispatchSource } = await import('@suanomics/prompt-research')
  const runDir = mkdtempSync(join(tmpdir(), 'prd-estimate-test-'))
  try {
    return await dispatchSource(spec, runDir)
  }
  finally {
    rmSync(runDir, { recursive: true, force: true })
  }
}

describe('estimatePromptResearchDistill：mock 邊界（@google/genai + fetch），真跑 dispatchSource', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    geminiState.calls = {}
    geminiState.behaviors = {}
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const s = String(url)
      if (s.includes('ep1.mp3'))
        return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
      return new Response(RSS_XML, { status: 200 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GEMINI_API_KEY
  })

  it('wiring 檢查：假設常數正確、每個 stage 都重試到最後一次才成功，總呼叫數與加總公式一致（podcast count=1 → 22）', async () => {
    geminiState.behaviors = {
      'stt': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_STT_CALLS_PER_EPISODE - 1 },
      'segmenter': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_SEGMENTER_CALLS_PER_EPISODE - 1 },
      'lens:events': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_LENS_CALLS_PER_LENS - 1 },
      'lens:sources': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_LENS_CALLS_PER_LENS - 1 },
      'lens:entities': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_LENS_CALLS_PER_LENS - 1 },
      'lens:chains': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_LENS_CALLS_PER_LENS - 1 },
      'lens:impacts': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_LENS_CALLS_PER_LENS - 1 },
      'lens:frames': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_LENS_CALLS_PER_LENS - 1 },
      'consolidator': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_CONSOLIDATOR_CALLS_PER_RUN - 1 },
      'distill': { kind: 'succeed-after', failsBefore: PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN - 1 },
    }

    const digest = await runProbe() as { analystFrames: unknown[] }
    expect(digest.analystFrames.length).toBeGreaterThan(0)

    const total = Object.values(geminiState.calls).reduce((a, b) => a + b, 0)
    expect(total).toBe(estimateTotalCalls(estimatePromptResearchDistill([podcastSpec(1)])))
    expect(total).toBe(22)
  })

  it('探針｜segmenter：目標永遠回壞 JSON → 套件的 MAX_ATTEMPTS 決定丟例外前打幾次', async () => {
    geminiState.behaviors = { segmenter: { kind: 'always-bad-json' } }
    await expect(runProbe()).rejects.toThrow()
    expect(geminiState.calls.segmenter).toBe(PROMPT_RESEARCH_SEGMENTER_CALLS_PER_EPISODE)
  })

  it('探針｜lens（events，6 個 lens 共用同一個 MAX_ATTEMPTS）：目標永遠回壞 JSON', async () => {
    geminiState.behaviors = { 'lens:events': { kind: 'always-bad-json' } }
    await expect(runProbe()).rejects.toThrow()
    expect(geminiState.calls['lens:events']).toBe(PROMPT_RESEARCH_LENS_CALLS_PER_LENS)
  })

  it('探針｜consolidator：目標永遠回空字串（empty response 分支）', async () => {
    geminiState.behaviors = { consolidator: { kind: 'always-empty' } }
    await expect(runProbe()).rejects.toThrow()
    expect(geminiState.calls.consolidator).toBe(PROMPT_RESEARCH_CONSOLIDATOR_CALLS_PER_RUN)
  })

  it('探針｜STT：目標永遠回空字串', async () => {
    geminiState.behaviors = { stt: { kind: 'always-empty' } }
    await expect(runProbe()).rejects.toThrow()
    expect(geminiState.calls.stt).toBe(PROMPT_RESEARCH_STT_CALLS_PER_EPISODE)
  })

  it('探針｜distill 外層業務重試：目標永遠回壞 JSON（callGemini() 本身不 throw，只有 distill 外層在重試）', async () => {
    geminiState.behaviors = { distill: { kind: 'always-bad-json' } }
    await expect(runProbe()).rejects.toThrow()
    expect(geminiState.calls.distill).toBe(PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN)
  })

  it('探針｜distill 內層 transport retry：目標永遠 throw → outer(distill) × inner(callGemini) 兩層都被逼到底', async () => {
    geminiState.behaviors = { distill: { kind: 'always-throw' } }
    await expect(runProbe()).rejects.toThrow()
    // gemini-client.ts callGemini() 的重試有指數 backoff（500ms/1000ms），outer 3 次 × inner
    // 3 次全部重試到底，真實跑起來要幾秒——這是測到真的 backoff 邏輯的代價，不是測試寫錯。
    expect(geminiState.calls.distill).toBe(PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN * PROMPT_RESEARCH_DISTILL_HTTP_MULTIPLIER)
  }, 20_000)

  // skill-to-digest.ts 的 distillSkillToDigest 也經 gemini-client.ts 的 callGemini()，跟
  // transcript-to-digest.ts 共用同一個函式（同一份 transport retry 邏輯，上面的探針已經
  // 逼過一次），但它自己另外宣告了一個獨立的 `const MAX_ATTEMPTS = 3`（skill-to-digest.ts:9）
  // ——跟 transcript-to-digest.ts 的 MAX_ATTEMPTS 只是恰好同值，改其中一個不會動到另一個。
  // custom-text／skill-markdown 那組 PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN 係數在此之前完全
  // 沒有探針鎖住，改 skill-to-digest.ts 的 MAX_ATTEMPTS 不會讓任何測試變紅。
  it('探針｜skill/custom-text distill 外層業務重試：目標永遠回壞 JSON（skill-to-digest.ts 自己的 MAX_ATTEMPTS，獨立於 transcript-to-digest.ts）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prd-custom-text-'))
    const filePath = join(dir, 'source.txt')
    writeFileSync(filePath, '測試素材：分析框架的原始內容', 'utf8')
    try {
      geminiState.behaviors = { distill: { kind: 'always-bad-json' } }
      await expect(runProbe(customTextSpec(filePath))).rejects.toThrow()
      expect(geminiState.calls.distill).toBe(PROMPT_RESEARCH_DISTILL_CALLS_PER_RUN)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
