import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../agents/news-categorizer.js', () => ({ callNewsCategorizer: vi.fn() }))
vi.mock('@suanomics/db/repos/news-repo', () => ({ updateNewsItemCategories: vi.fn() }))

const { callNewsCategorizer } = await import('../agents/news-categorizer.js')
const { updateNewsItemCategories } = await import('@suanomics/db/repos/news-repo')
const { categorizeAndStore, BATCH_SIZE } = await import('./categorize.js')

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function items(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `t${i}`, contentText: `c${i}` }))
}

describe('categorizeAndStore', () => {
  it('batches items into chunks of BATCH_SIZE and stores the merged result', async () => {
    vi.mocked(callNewsCategorizer).mockImplementation(async batch => batch.map(b => ({ id: b.id, category: 'macro' })))
    await categorizeAndStore(items(BATCH_SIZE + 3))
    expect(vi.mocked(callNewsCategorizer)).toHaveBeenCalledTimes(2) // ceil((BATCH_SIZE+3)/BATCH_SIZE)
    expect(vi.mocked(updateNewsItemCategories)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(updateNewsItemCategories).mock.calls[0]?.[0]).toHaveLength(BATCH_SIZE + 3)
    const stored = vi.mocked(updateNewsItemCategories).mock.calls[0]?.[0]
    expect(stored).toContainEqual({ id: 1, category: 'macro' })
    expect(stored).toContainEqual({ id: BATCH_SIZE + 3, category: 'macro' })
  })
  it('is a no-op for empty input', async () => {
    await categorizeAndStore([])
    expect(vi.mocked(callNewsCategorizer)).not.toHaveBeenCalled()
    expect(vi.mocked(updateNewsItemCategories)).not.toHaveBeenCalled()
  })
})
