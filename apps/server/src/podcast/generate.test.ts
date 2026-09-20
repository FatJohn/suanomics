import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPodcastGenerate } from './generate.js'

vi.mock('@suanomics/db/client')
vi.mock('@suanomics/db/schema')
vi.mock('@suanomics/db/repos/storylines-repo')
vi.mock('../agents/podcast-writer.js')
// 隔離 Stage 0 市場 context、避免測試走真實 DB/FS（generate.ts 在生成路徑前 loadMarketContext）
vi.mock('../market-data/context.js')

describe('runPodcastGenerate', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    // resetAllMocks 會把 auto-mock 的 loadMarketContext 還原成回傳 undefined、
    // 而 generate.ts 對其結果呼叫 .catch()，undefined.catch() 會 TypeError。
    // 釘住明確的 resolved value、讓走完整 generate 路徑的測試不會炸在 Stage 0。
    const { loadMarketContext } = await import('../market-data/context.js')
    vi.mocked(loadMarketContext).mockResolvedValue({ snapshotBlock: null, calendarBlock: null, taiexCloseDate: null })
    // podcast 是獨立 queue job、storyline block 從 DB 還原；預設無 touch、走完整路徑的測試自行覆寫
    const { getStorylinesTouchedOn } = await import('@suanomics/db/repos/storylines-repo')
    vi.mocked(getStorylinesTouchedOn).mockResolvedValue([])
  })

  it('throws when no brief row exists for date', async () => {
    const { getDb } = await import('@suanomics/db/client')
    const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) })) }))
    vi.mocked(getDb).mockReturnValue({ select } as never)
    await expect(runPodcastGenerate({ date: '2026-05-17', force: false }))
      .rejects
      .toThrow(/no brief found/i)
  })

  it('throws on invalid date format', async () => {
    await expect(runPodcastGenerate({ date: '5/17/2026' })).rejects.toThrow(/invalid date format/i)
    await expect(runPodcastGenerate({ date: '2026-5-17' })).rejects.toThrow(/invalid date format/i)
    await expect(runPodcastGenerate({ date: 'abc' })).rejects.toThrow(/invalid date format/i)
  })

  it('returns skipped=true when podcast already exists without force', async () => {
    const { getDb } = await import('@suanomics/db/client')
    const existingRow = {
      briefDate: '2026-05-17',
      briefJson: { narrative: 'some narrative' },
      podcastJson: {
        acts: [{ id: 1 }, { id: 2 }],
        meta: { totalChars: 1500 },
        hook: { headline: 'Market Update' },
      },
    }
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([existingRow])),
        })),
      })),
    }))
    vi.mocked(getDb).mockReturnValue({ select } as never)

    const result = await runPodcastGenerate({ date: '2026-05-17', force: false })
    expect(result.skipped).toBe(true)
    expect(result.briefDate).toBe('2026-05-17')
    expect(result.elapsedMs).toBe(0)
    expect(result.acts).toBe(2)
    expect(result.totalChars).toBe(1500)
    expect(result.hookHeadline).toBe('Market Update')
  })

  // podcast 路徑從 DB 還原當日 touch 的敘事線、組 storylineBlock 傳給 writer
  function mockBriefRowDb() {
    const briefJson = {
      narrative: 'some narrative',
      // MarketBriefSchema 的其餘欄位由實際 parse 驗、這裡靠 spyOn parse 略過
    }
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ briefDate: '2026-06-12', briefJson, podcastJson: null }])),
        })),
      })),
    }))
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) }))
    return { select, update }
  }

  async function stubWriterAndParse() {
    const { MarketBriefSchema } = await import('@suanomics/shared')
    vi.spyOn(MarketBriefSchema, 'parse').mockReturnValue({ narrative: 'some narrative' } as never)
    const { callPodcastWriter } = await import('../agents/podcast-writer.js')
    vi.mocked(callPodcastWriter).mockResolvedValue({
      podcast: {
        acts: [{ id: 1 }],
        meta: { totalChars: 1200 },
        hook: { headline: 'H' },
      },
      audit: { failed: false, retryReason: null, forbiddenSanitized: 0 },
    } as never)
    return callPodcastWriter
  }

  it('passes storylineBlock containing touched line title to callPodcastWriter', async () => {
    const { getDb } = await import('@suanomics/db/client')
    const { update, select } = mockBriefRowDb()
    vi.mocked(getDb).mockReturnValue({ select, update } as never)

    const { getStorylinesTouchedOn } = await import('@suanomics/db/repos/storylines-repo')
    vi.mocked(getStorylinesTouchedOn).mockResolvedValue([
      {
        id: 1,
        title: 'Fed 升息路徑',
        thesis: '本輪終端利率高於市場預期',
        status: 'open',
        entities: ['Fed'],
        updates: [
          { briefDate: '2026-06-11', kind: 'advance', note: '舊進展' },
          { briefDate: '2026-06-12', kind: 'confirm', note: 'CPI 超預期、驗證' },
        ],
        lastTouchedBriefDate: '2026-06-12',
      },
    ])

    const callPodcastWriter = await stubWriterAndParse()
    await runPodcastGenerate({ date: '2026-06-12', force: false })

    const arg = vi.mocked(callPodcastWriter).mock.calls[0]?.[0]
    expect(arg?.storylineBlock).toBeTruthy()
    expect(arg?.storylineBlock).toContain('Fed 升息路徑')
    expect(arg?.storylineBlock).toContain('CPI 超預期、驗證')
  })

  it('passes storylineBlock=null and still generates podcast when getStorylinesTouchedOn throws', async () => {
    const { getDb } = await import('@suanomics/db/client')
    const { update, select } = mockBriefRowDb()
    vi.mocked(getDb).mockReturnValue({ select, update } as never)

    const { getStorylinesTouchedOn } = await import('@suanomics/db/repos/storylines-repo')
    vi.mocked(getStorylinesTouchedOn).mockRejectedValue(new Error('db down'))

    const callPodcastWriter = await stubWriterAndParse()
    const result = await runPodcastGenerate({ date: '2026-06-12', force: false })

    const arg = vi.mocked(callPodcastWriter).mock.calls[0]?.[0]
    expect(arg?.storylineBlock).toBeNull()
    expect(result.skipped).toBe(false)
    expect(result.totalChars).toBe(1200)
  })
})
