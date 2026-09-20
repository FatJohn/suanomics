import type { MarketBrief } from '@suanomics/shared'
import type { LlmCallRecord } from '../../src/agents/llm-wrapper.js'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { MarketBriefSchema } from '@suanomics/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as briefGenerate from '../../src/jobs/handlers/brief-generate.js'
import {
  buildRerunMeta,
  generateReplicateToFiles,
  RerunDirExistsError,
  rerunOutputDir,
  RerunSkippedError,
  toSourcesJson,
} from './brief-rerun.js'

vi.mock('../../src/jobs/handlers/brief-generate.js')

const sampleBrief: MarketBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [{ url: 'https://x/1', title: 't', quote: 'q' }],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
}

const sampleNews = [
  { id: 1, title: 'T1', url: 'https://x/1', text: 'body one', publishedAt: '2026-06-12T00:00:00.000Z' },
  { id: 2, title: 'T2', url: 'https://x/2', text: 'body two', publishedAt: null },
]

function callRecord(overrides: Partial<LlmCallRecord> = {}): LlmCallRecord {
  return { agentName: 'editor', tokensIn: 10, tokensOut: 20, costUsd: 0.01, latencyMs: 100, attempts: 1, ...overrides }
}

describe('rerunOutputDir', () => {
  it('組出 <out>/<date>/<label>-<replicate>', () => {
    expect(rerunOutputDir('/tmp/out', '2026-06-12', 'rerun', 1)).toBe(resolve('/tmp/out', '2026-06-12', 'rerun-1'))
  })
})

describe('toSourcesJson', () => {
  it('把 BriefNews 轉成 { id, title, url, contentText, publishedAt }', () => {
    expect(toSourcesJson(sampleNews)).toEqual([
      { id: 1, title: 'T1', url: 'https://x/1', contentText: 'body one', publishedAt: '2026-06-12T00:00:00.000Z' },
      { id: 2, title: 'T2', url: 'https://x/2', contentText: 'body two', publishedAt: null },
    ])
  })
})

describe('buildRerunMeta', () => {
  it('把 llmCalls 轉成摘要並加總 cost/latency', () => {
    const meta = buildRerunMeta({
      date: '2026-06-12',
      label: 'rerun',
      replicate: 1,
      generatedAt: '2026-06-13T00:00:00.000Z',
      selectedNewsIds: [1, 2],
      headline: 'h',
      pubDayKind: 'weekday-brief',
      llmCalls: [callRecord({ costUsd: 0.01, latencyMs: 100 }), callRecord({ agentName: 'narrative-writer', costUsd: 0.05, latencyMs: 900 })],
      historicalAsOf: null,
    })
    expect(meta.totalCostUsd).toBeCloseTo(0.06)
    expect(meta.totalLatencyMs).toBe(1000)
    expect(meta.llmCalls).toHaveLength(2)
    expect(meta.llmCalls[0]).toMatchObject({ agent: 'editor', costUsd: 0.01, latencyMs: 100, tokensIn: 10, tokensOut: 20 })
    expect(meta.llmCalls[0]?.model).toBeTruthy()
    expect(meta.date).toBe('2026-06-12')
    expect(meta.selectedNewsIds).toEqual([1, 2])
  })

  it('沒有任何 llm call 時總計為 0（skip 之外的邊界，不代表真的會發生）', () => {
    const meta = buildRerunMeta({
      date: '2026-06-12',
      label: 'rerun',
      replicate: 1,
      generatedAt: '2026-06-13T00:00:00.000Z',
      selectedNewsIds: [],
      headline: 'h',
      pubDayKind: 'weekday-brief',
      llmCalls: [],
      historicalAsOf: null,
    })
    expect(meta.totalCostUsd).toBe(0)
    expect(meta.totalLatencyMs).toBe(0)
  })

  // meta.json 是事後判讀「這次比較能不能比 grounding」的唯一憑據，
  // historicalAsOf 為 null（找不到原版 dataFreshness）與有值（已重建）兩種狀態都要留痕。
  it('historicalAsOf 為 null 時 seriesAsOf.source 為 null、covered 為 0', () => {
    const meta = buildRerunMeta({
      date: '2026-06-12',
      label: 'rerun',
      replicate: 1,
      generatedAt: '2026-06-13T00:00:00.000Z',
      selectedNewsIds: [1],
      headline: 'h',
      pubDayKind: 'weekday-brief',
      llmCalls: [],
      historicalAsOf: null,
    })
    expect(meta.seriesAsOf).toEqual({
      source: null,
      covered: 0,
      missing: [],
      note: 'as-of 未重建：快照可能含報告日之後才抓到的資料，grounding 維度的比較不可信',
    })
  })

  it('historicalAsOf 有值時 seriesAsOf 記錄 covered/missing', () => {
    const meta = buildRerunMeta({
      date: '2026-08-24',
      label: 'rerun',
      replicate: 1,
      generatedAt: '2026-08-25T00:00:00.000Z',
      selectedNewsIds: [1],
      headline: 'h',
      pubDayKind: 'weekday-brief',
      llmCalls: [],
      historicalAsOf: { seriesAsOf: { 'taiex-close': '2026-08-24' }, covered: ['taiex-close'], missing: ['us-nonfarm-payrolls'] },
    })
    expect(meta.seriesAsOf).toEqual({
      source: 'original-brief',
      covered: 1,
      missing: ['us-nonfarm-payrolls'],
      // 射程說明要逐字落進 meta.json：covered 讀起來像素材完全還原、實際只還原日期。
      note: '只還原逐序列的 as-of 日期；數值是現在 DB 的最新值，修正型序列（CPI、非農）可能是後來的修正版',
    })
  })
})

describe('generateReplicateToFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'brief-rerun-'))
    vi.resetAllMocks()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('寫出 brief.json / sources.json / meta.json，brief.json 過 MarketBriefSchema', async () => {
    vi.mocked(briefGenerate.generateDailyBrief).mockResolvedValue({
      kind: 'generated',
      pubDay: { kind: 'weekday-brief' },
      news: sampleNews,
      selection: null,
      storyline: null,
      storylineBlock: null,
      continuityHint: null,
      brief: sampleBrief,
      summaryText: 'h\n\ns',
    } as never)

    const meta = await generateReplicateToFiles({ date: '2026-06-12', out: dir, label: 'rerun' }, 1)

    const outDir = rerunOutputDir(dir, '2026-06-12', 'rerun', 1)
    expect(existsSync(resolve(outDir, 'brief.json'))).toBe(true)
    expect(existsSync(resolve(outDir, 'sources.json'))).toBe(true)
    expect(existsSync(resolve(outDir, 'meta.json'))).toBe(true)

    const briefJson: unknown = JSON.parse(readFileSync(resolve(outDir, 'brief.json'), 'utf8'))
    const parsed = MarketBriefSchema.safeParse(briefJson)
    expect(parsed.success).toBe(true)

    const sourcesJson: unknown = JSON.parse(readFileSync(resolve(outDir, 'sources.json'), 'utf8'))
    expect(sourcesJson).toEqual(toSourcesJson(sampleNews))

    const metaJson: unknown = JSON.parse(readFileSync(resolve(outDir, 'meta.json'), 'utf8'))
    expect(metaJson).toMatchObject({ date: '2026-06-12', label: 'rerun', replicate: 1, headline: 'h', pubDayKind: 'weekday-brief' })
    expect(meta.headline).toBe('h')
  })

  // generateReplicateToFiles 收到 historicalAsOf 時要轉成 opts.seriesAsOf 轉發給
  // generateDailyBrief——這是 brief-rerun 這條線唯一把重建結果接進 pipeline 的地方，
  // 漏接的話 meta.json 會誠實記錄「已重建」，但 brief 實際上仍是用 reportDate 產的。
  it('historicalAsOf 有值時把 seriesAsOf 轉發給 generateDailyBrief', async () => {
    vi.mocked(briefGenerate.generateDailyBrief).mockResolvedValue({
      kind: 'generated',
      pubDay: { kind: 'weekday-brief' },
      news: sampleNews,
      selection: null,
      storyline: null,
      storylineBlock: null,
      continuityHint: null,
      brief: sampleBrief,
      summaryText: 'h\n\ns',
    } as never)

    await generateReplicateToFiles(
      { date: '2026-08-24', out: dir, label: 'rerun' },
      1,
      { seriesAsOf: { 'taiex-close': '2026-08-24' }, covered: ['taiex-close'], missing: [] },
    )

    expect(briefGenerate.generateDailyBrief).toHaveBeenCalledWith(
      '2026-08-24',
      expect.any(Function),
      { seriesAsOf: { 'taiex-close': '2026-08-24' } },
    )
  })

  it('輸出目錄已存在時拒絕覆蓋、不呼叫 generateDailyBrief（fail-fast、不浪費 LLM 呼叫）', async () => {
    const outDir = rerunOutputDir(dir, '2026-06-12', 'rerun', 1)
    mkdirSync(outDir, { recursive: true })

    await expect(generateReplicateToFiles({ date: '2026-06-12', out: dir, label: 'rerun' }, 1))
      .rejects
      .toThrow(RerunDirExistsError)
    expect(briefGenerate.generateDailyBrief).not.toHaveBeenCalled()
  })

  it('generateDailyBrief 回 skip 時拋 RerunSkippedError、不寫任何檔案', async () => {
    vi.mocked(briefGenerate.generateDailyBrief).mockResolvedValue({ kind: 'skip', reason: 'saturday' } as never)

    await expect(generateReplicateToFiles({ date: '2026-07-11', out: dir, label: 'rerun' }, 1))
      .rejects
      .toThrow(RerunSkippedError)
    expect(existsSync(rerunOutputDir(dir, '2026-07-11', 'rerun', 1))).toBe(false)
  })
})
