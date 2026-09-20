import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 守門測試：斷言實際被呼叫的那一層（tagAndStore），不是只斷言分類函式的回傳值——只 mock
// 掉整條呼叫鏈裡某一層、卻拿它當「已驗證整條路徑」的證據，是這類測試最容易犯的錯。這裡刻意
// 走 CLI 真正 export 的 runBackfillTags，mock 掉它下游唯一的 DB／LLM 呼叫點
// （getUntaggedNewsItems／tagAndStore），不 mock runBackfillTags 本身。

function FAKE_ITEM(id: number): { id: number, title: string, contentText: string | null } {
  return {
    id,
    title: `title-${id}`,
    contentText: null,
  }
}

function makeItems(n: number): ReturnType<typeof FAKE_ITEM>[] {
  return Array.from({ length: n }, (_, i) => FAKE_ITEM(i))
}

const { getUntaggedNewsItemsMock } = vi.hoisted(() => ({
  getUntaggedNewsItemsMock: vi.fn(),
}))

vi.mock('@suanomics/db/repos/news-repo', () => ({
  getUntaggedNewsItems: getUntaggedNewsItemsMock,
}))

const { tagAndStoreMock } = vi.hoisted(() => ({
  tagAndStoreMock: vi.fn(async () => {}),
}))

// 只 mock tagAndStore（下游的 LLM 呼叫點）；BATCH_SIZE 保留真的——llm-run-estimates.ts 的
// estimateNewsBackfillTags 直接 import 這個 module 的 BATCH_SIZE（估算跟 tag.ts 綁同一個
// binding），完全 mock 掉整個 module 會讓它變 undefined、算出 NaN 批次。
vi.mock('../../src/news/tag.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/news/tag.js')>()
  return {
    ...actual,
    tagAndStore: tagAndStoreMock,
  }
})

class FakeProcessExit extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

describe('news-backfill-tags：預算閘門擋下 tagAndStore（不是只擋分類函式）', () => {
  beforeEach(() => {
    getUntaggedNewsItemsMock.mockReset()
    tagAndStoreMock.mockReset().mockResolvedValue(undefined)
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new FakeProcessExit(code)
    }) as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('7501 則未標記（ceil(7501/15)=501 批 > 500 門檻）且沒有 --yes → exit(3)、tagAndStore 呼叫 0 次', async () => {
    getUntaggedNewsItemsMock.mockResolvedValue(makeItems(7501))
    const { runBackfillTags } = await import('./news-backfill-tags.js')

    await expect(runBackfillTags(['30'])).rejects.toThrow(FakeProcessExit)

    expect(tagAndStoreMock).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(3)

    // 這支腳本沒有 --limit／--dates／--replicates，縮小範圍的提示要指向真正存在的參數
    // （sinceDays），不能沿用其他腳本的預設提示字串。
    const errLines = vi.mocked(console.error).mock.calls.map(c => String(c[0]))
    expect(errLines.some(l => l.includes('sinceDays') && l.includes('30'))).toBe(true)
    expect(errLines.some(l => l.includes('--limit'))).toBe(false)
  })

  it('同樣超標但帶 --yes → 放行，tagAndStore 依批次數被呼叫', async () => {
    getUntaggedNewsItemsMock.mockResolvedValue(makeItems(7501))
    const { runBackfillTags } = await import('./news-backfill-tags.js')

    await runBackfillTags(['30', '--yes'])

    // CHUNK=150、7501 筆 → ceil(7501/150)=51 個 chunk，每個 chunk 呼叫一次 tagAndStore
    expect(tagAndStoreMock).toHaveBeenCalledTimes(51)
  })

  it('未超標（100 則、ceil(100/15)=7 批）沒有 --yes 也會正常放行、呼叫 tagAndStore', async () => {
    getUntaggedNewsItemsMock.mockResolvedValue(makeItems(100))
    const { runBackfillTags } = await import('./news-backfill-tags.js')

    await runBackfillTags(['30'])

    expect(tagAndStoreMock).toHaveBeenCalledTimes(1)
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('--yes 不會被誤當成 sinceDays：sinceDays 落回預設 30 天', async () => {
    getUntaggedNewsItemsMock.mockResolvedValue(makeItems(1))
    const { runBackfillTags } = await import('./news-backfill-tags.js')

    await runBackfillTags(['--yes'])

    expect(getUntaggedNewsItemsMock).toHaveBeenCalledWith(30)
  })
})
