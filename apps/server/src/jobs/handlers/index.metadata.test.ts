import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHandlers } from './index.js'
import * as newsRefreshWorker from './news-refresh-worker.js'

vi.mock('./news-refresh-worker.js')

// `metadata` 的型別是 `Record<string, unknown>`，所以漏掉一個欄位既不會讓 type-check 紅、
// 也不會讓其他測試紅。而這一行是「refresh 算出來的數字」到 `background_jobs.metadata` 的
// 必經點——`perSource[].feedSkipped` 這類計數只活在這裡，斷了就沒有任何地方看得到。
describe('news-refresh handler 的 metadata 接線', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('把 refresh 的結果完整寫進 metadata（鍵集合與值）', async () => {
    const perSource = [{ slug: 's1', inserted: 9, failed: false, bodyDenied: 0, feedSkipped: 4, scrapeFailed: 0, scrapeEmpty: 0 }]
    vi.mocked(newsRefreshWorker.processNewsRefreshJob).mockResolvedValue({
      sourcesProcessed: 3,
      sourcesFailed: 0,
      totalInserted: 9,
      perSource,
    })

    const handler = createHandlers()['news-refresh']
    const out = await handler({}, { auditId: 1, updateProgress: vi.fn() } as never)

    expect(Object.keys(out.metadata ?? {}).sort()).toEqual(['perSource', 'sourcesFailed', 'sourcesProcessed', 'totalInserted'])
    expect(out.metadata).toEqual({ sourcesProcessed: 3, sourcesFailed: 0, totalInserted: 9, perSource })
  })
})
