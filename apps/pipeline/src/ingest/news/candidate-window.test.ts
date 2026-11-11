import type { ItemCategory } from '../../db/news-categories.js'
import { describe, expect, it } from 'vitest'
import { candidateWindowDays, MAX_CANDIDATE_WINDOW_DAYS, selectAcrossClosure, spreadAcrossClosure, windowDaysForGap } from './candidate-window.js'
import { selectWithCategoryFloors } from './selection.js'

describe('candidateWindowDays', () => {
  it('一般交易日維持原本的 2 天窗（涵蓋上一次執行抓到的新聞）', () => {
    expect(candidateWindowDays('2026-09-15')).toBe(2)
  })

  it('週一往回涵蓋到週五那次執行：曆日差 3 + 1', () => {
    expect(candidateWindowDays('2026-09-14')).toBe(4)
  })

  it('連假後第一個交易日涵蓋整段連假：09-24 到 09-29 曆日差 5 + 1', () => {
    expect(candidateWindowDays('2026-09-29')).toBe(6)
  })

  it('超長休市時窗有上限，與 getRelevanceCandidates 的預設 sanity cap 相同', () => {
    expect(MAX_CANDIDATE_WINDOW_DAYS).toBe(14)
    expect(windowDaysForGap(20)).toBe(14)
    expect(windowDaysForGap(13)).toBe(14)
    expect(windowDaysForGap(1)).toBe(2)
  })
})

interface Item { id: number, category: ItemCategory, publishedAt: Date | null, fetchedAt: Date }

// 台北 05:00 = 前一天 21:00 UTC；發布時間取台北白天，避免換日邊界干擾。
function item(id: number, taipeiDate: string, category: ItemCategory = 'macro', hour = 12): Item {
  const at = new Date(`${taipeiDate}T${String(hour).padStart(2, '0')}:00:00+08:00`)
  return { id, category, publishedAt: at, fetchedAt: at }
}

describe('spreadAcrossClosure', () => {
  it('不是休市後第一個交易日時原樣回傳', () => {
    const items = [item(1, '2026-09-15'), item(2, '2026-09-14')]
    expect(spreadAcrossClosure(items, '2026-09-15')).toBe(items)
  })

  it('休市期間逐日輪流排前，上一個交易日之前的舊聞排最後', () => {
    // 輸入依發布時間新到舊，與 getRelevanceCandidates 的順序相同。
    const items = [
      item(1, '2026-09-14', 'macro', 4),
      item(2, '2026-09-14', 'macro', 3),
      item(3, '2026-09-13'),
      item(4, '2026-09-12'),
      item(5, '2026-09-11'),
      item(6, '2026-09-10'),
    ]
    expect(spreadAcrossClosure(items, '2026-09-14').map(i => i.id)).toEqual([1, 3, 4, 5, 2, 6])
  })

  it('沒有發布時間時以抓取時間的台北日期歸日', () => {
    const noPub = { ...item(7, '2026-09-12'), publishedAt: null }
    const items = [item(1, '2026-09-14'), item(2, '2026-09-14'), noPub]
    expect(spreadAcrossClosure(items, '2026-09-14').map(i => i.id)).toEqual([1, 7, 2])
  })
})

describe('selectAcrossClosure：休市期間新聞不被當日新聞擠掉', () => {
  const monday = Array.from({ length: 40 }, (_, i) => item(100 + i, '2026-09-14', 'macro', 5 - (i % 5)))
  const weekend = [item(201, '2026-09-13'), item(202, '2026-09-12'), item(203, '2026-09-11')]
  const candidates = [...monday, ...weekend]
  const options = { total: 36, floors: { macro: 6 } }

  it('週一當日 40 則全數排在前面時，週五與週末的新聞仍各自入選', () => {
    // 對照組：不分散時 36 個名額全被週一吃掉。
    expect(selectWithCategoryFloors(candidates, options).some(c => c.id > 200)).toBe(false)

    const picked = selectAcrossClosure(candidates, '2026-09-14', options)
    expect(picked).toHaveLength(36)
    expect(picked.map(c => c.id)).toEqual(expect.arrayContaining([201, 202, 203]))
  })

  it('入選結果維持輸入的時間順序，editor 看到的候選仍是新到舊', () => {
    const picked = selectAcrossClosure(candidates, '2026-09-14', options)
    const order = picked.map(c => candidates.indexOf(c))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('一般交易日與原本的 selectWithCategoryFloors 結果相同', () => {
    const tuesday = [...Array.from({ length: 40 }, (_, i) => item(300 + i, '2026-09-15')), item(400, '2026-09-14')]
    expect(selectAcrossClosure(tuesday, '2026-09-15', options)).toEqual(selectWithCategoryFloors(tuesday, options))
  })
})
