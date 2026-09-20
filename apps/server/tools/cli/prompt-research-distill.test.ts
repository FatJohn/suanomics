import type { Digest } from '@suanomics/prompt-research'
import type { DistillOpts } from './prompt-research-distill.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDistillSpecs } from './prompt-research-distill.js'

// 守門測試：斷言實際被呼叫的那一層（dispatchSource／mergeDigests），不是只斷言
// resolveDistillSpecs 的分類結果——同 news-backfill-tags.test.ts 的取捨。mock
// @suanomics/prompt-research 整包，只覆寫 dispatchSource／mergeDigests，DEFAULT_SOURCES 用真的
// （決定「不帶任何 flag 時到底跑幾個 source」也是本測試要鎖住的事）。

const { dispatchSourceMock, mergeDigestsMock } = vi.hoisted(() => ({
  dispatchSourceMock: vi.fn(),
  mergeDigestsMock: vi.fn(() => ({ markdown: '# merged', draft: { sources: [] } })),
}))

vi.mock('@suanomics/prompt-research', async () => {
  const actual = await vi.importActual<typeof import('@suanomics/prompt-research')>('@suanomics/prompt-research')
  return {
    ...actual,
    dispatchSource: dispatchSourceMock,
    mergeDigests: mergeDigestsMock,
  }
})

class FakeProcessExit extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

function fakeDigest(slug: string): Digest {
  return {
    sourceSlug: slug,
    sourceKind: 'skill-markdown',
    generatedAt: new Date().toISOString(),
    analystFrames: [{ id: 'frame-1', name: 'n', description: 'd', whenToApply: 'w', questions: ['q'] }],
    analysisChecks: [],
    vocabulary: [],
    rawSourceRef: {},
  }
}

function baseOpts(out: string, over: Partial<DistillOpts> = {}): DistillOpts {
  return { out, dryRun: false, mergeOnly: false, ...over }
}

describe('prompt-research-distill：預算閘門擋下 dispatchSource（不是只擋 resolveDistillSpecs）', () => {
  let outDir: string

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'prd-cli-test-'))
    dispatchSourceMock.mockReset().mockImplementation(async (spec: { slug: string }) => fakeDigest(spec.slug))
    mergeDigestsMock.mockReset().mockReturnValue({ markdown: '# merged', draft: { sources: [] } })
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new FakeProcessExit(code)
    }) as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(outDir, { recursive: true, force: true })
  })

  it('--rss + --count=100（估算 1606 次超標；尖峰 9 未超標，門檻判定靠呼叫數）且沒有 --yes → exit(3)、dispatchSource 呼叫 0 次', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')
    const opts = baseOpts(outDir, { rss: 'https://example.com/feed.xml', count: 100 })

    await expect(runDistill(opts)).rejects.toThrow(FakeProcessExit)

    expect(dispatchSourceMock).not.toHaveBeenCalled()
    expect(mergeDigestsMock).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(3)

    // 這支腳本沒有 --limit／--dates／--replicates，縮小範圍的提示要指向真正存在的
    // 參數（--count），不能沿用其他腳本的預設提示字串。
    const errLines = vi.mocked(console.error).mock.calls.map(c => String(c[0]))
    expect(errLines.some(l => l.includes('--count'))).toBe(true)
    expect(errLines.some(l => l.includes('--replicates'))).toBe(false)
  })

  it('--rss + --count=5（預設情境，估算 86 次、尖峰 9，皆在門檻內）沒有 --yes 也正常放行', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')
    const opts = baseOpts(outDir, { rss: 'https://example.com/feed.xml', count: 5 })

    await runDistill(opts)

    expect(dispatchSourceMock).toHaveBeenCalledTimes(1)
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('同樣超標但帶 --yes → 放行，dispatchSource／mergeDigests 依 specs 被呼叫', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')
    const opts = baseOpts(outDir, { rss: 'https://example.com/feed.xml', count: 100, yes: true })

    await runDistill(opts)

    expect(dispatchSourceMock).toHaveBeenCalledTimes(1)
    expect(mergeDigestsMock).toHaveBeenCalledTimes(1)
  })

  it('不帶任何 flag（DEFAULT_SOURCES 3 個 skill-markdown，估算 9 次）沒有 --yes 也正常放行', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')
    const opts = baseOpts(outDir)

    await runDistill(opts)

    expect(dispatchSourceMock).toHaveBeenCalledTimes(3)
  })

  it('--dry-run 不受閘門管、也不呼叫 dispatchSource——跟 model-ab.ts 的 --analyze／--probe 同一類', async () => {
    const { runDistill } = await import('./prompt-research-distill.js')
    const opts = baseOpts(outDir, { rss: 'https://example.com/feed.xml', count: 100, dryRun: true })

    await runDistill(opts)

    expect(dispatchSourceMock).not.toHaveBeenCalled()
  })
})

describe('resolveDistillSpecs：純函式，不受這份測試的 mock 影響', () => {
  it('預設（無 flag）回傳 DEFAULT_SOURCES 原封不動', () => {
    const specs = resolveDistillSpecs(baseOpts('/tmp/x'))
    expect(specs.every(s => s.kind === 'skill-markdown')).toBe(true)
    expect(specs.length).toBeGreaterThan(0)
  })

  it('--rss + --count 覆寫 config.count', () => {
    const specs = resolveDistillSpecs(baseOpts('/tmp/x', { rss: 'https://example.com/feed.xml', count: 7 }))
    expect(specs).toEqual([
      expect.objectContaining({ kind: 'podcast-rss', config: expect.objectContaining({ count: 7 }) }),
    ])
  })
})
