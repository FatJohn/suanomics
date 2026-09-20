import type { TranscriptInput } from './deep-pipeline.js'
import { describe, expect, it } from 'vitest'
import { LENS_CONCURRENCY } from '../sources/yt-transcript/lens-extractors.js'
import { EPISODE_CONCURRENCY } from './deep-pipeline.js'
import { YT_PROMPT_VARS } from './prompt-vars.js'

describe('transcriptInput shape', () => {
  it('accepts the canonical TranscriptInput shape', () => {
    const input: TranscriptInput = {
      episodeId: 'e1',
      title: 't',
      url: 'https://example.com',
      publishedAt: '2026-05-21T00:00:00.000Z',
      durationSec: 3600,
      transcriptText: 'hello',
    }
    expect(input.episodeId).toBe('e1')
  })
})

describe('runDeepPipeline export', () => {
  it('exports a function named runDeepPipeline that accepts vars param', async () => {
    const mod = await import('./deep-pipeline.js')
    expect(typeof mod.runDeepPipeline).toBe('function')
    // 4 args (inputs, spec, runDir, vars) — vars 必填
    expect(mod.runDeepPipeline.length).toBe(4)
  })

  it('yT_PROMPT_VARS is the expected import alongside', () => {
    // sanity: YT_PROMPT_VARS keys present
    expect(YT_PROMPT_VARS.sourceKindLabel).toBe('YouTube')
  })
})

describe('deep pipeline 尖峰並行上限', () => {
  // 專案規則：對 LLM 的尖峰並行不得超過 10——共用 API key 在短時間內打出高並行請求
  // 會被平台判定為異常流量而降級（甚至停用），不是單純的效能考量。deep pipeline
  // 的最壞情況尖峰＝同時在跑的 episode worker 數 × 每個 episode worker 內同時打的
  // lens 數，也就是 EPISODE_CONCURRENCY × LENS_CONCURRENCY 兩層巢狀並行相乘——這條
  // 直接鎖住這個乘積本身，改任一個常數讓乘積超過 10 都會讓這條紅，不必仰賴
  // apps/server 那邊的估算測試才發現。
  it('兩層巢狀並行（episode × lens）的乘積不超過 10', () => {
    expect(EPISODE_CONCURRENCY * LENS_CONCURRENCY).toBeLessThanOrEqual(10)
  })
})
