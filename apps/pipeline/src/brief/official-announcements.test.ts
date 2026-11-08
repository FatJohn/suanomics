import { describe, expect, it } from 'vitest'
import { buildOfficialAnnouncementsBlock, isRoutineIndexPost, OFFICIAL_BLOCK_SLUGS } from './official-announcements.js'

const NOW = new Date('2026-08-28T00:00:00Z')

function item(over: Partial<Parameters<typeof buildOfficialAnnouncementsBlock>[0][number]> = {}) {
  return {
    slug: 'cbc-press',
    title: '115年7月金融情況',
    summary: '7 月貨幣總計數 M2 年增率 4.2%，較上月上升 0.1 個百分點。',
    publishedAt: new Date('2026-08-27T02:00:00Z'),
    ...over,
  }
}

describe('oFFICIAL_BLOCK_SLUGS', () => {
  // 收四個政府來源。**排除 fomc-statements**：它的 description 逐字等於 title，
  // 塞了沒有資訊（不是雜訊比的問題，是零資訊）。
  //
  // ★ 一度想排除 ey-press，理由是「政治公關太多」——那個判斷用了不對稱的證據，
  // 驗收指出來後重量過（實際資料、2026-08-20 起）：ey-press 17 則、其中至少 3 則是
  // 財政題（116年度總預算案收支平衡／116年度施政計畫草案／115年度總預算遭大幅刪凍），
  // 而留下來的 fsc-news（11 則、其中 8 則是「每日新聞」索引）與 twse-announcements
  // （16 則、多為上市審議與宣導活動）雜訊比**並不比它低**。用一套判準量一個來源、
  // 用印象量另外兩個，那是不對稱的證據。四個一起收，靠 per-source 上限防洗版。
  it('收四個政府來源，不含 FOMC', () => {
    expect([...OFFICIAL_BLOCK_SLUGS].sort()).toEqual(['cbc-press', 'ey-press', 'fsc-news', 'twse-announcements'])
  })
})

describe('isRoutineIndexPost', () => {
  it('金管會的「每日新聞（日期）」是索引貼文、沒有內容', () => {
    expect(isRoutineIndexPost('金融監督管理委員會證券期貨局每日新聞（115年8月26日）')).toBe(true)
    expect(isRoutineIndexPost('金融監督管理委員會證券期貨局每日新聞(115年8月26日)')).toBe(true)
  })

  it('真正的公告不會被誤判', () => {
    expect(isRoutineIndexPost('金管會擬開放證券商受託買賣外國有價證券得辦理外幣融資業務')).toBe(false)
    expect(isRoutineIndexPost('115年7月金融情況')).toBe(false)
    expect(isRoutineIndexPost('全體證券商115年7月稅後淨利109.61億元')).toBe(false)
  })
})

describe('buildOfficialAnnouncementsBlock', () => {
  it('沒有任何公告時回 null，不是空字串（呼叫端據此整段不放進 prompt）', () => {
    expect(buildOfficialAnnouncementsBlock([], { now: NOW })).toBeNull()
  })

  it('每則一行，帶日期、機關與標題', () => {
    const block = buildOfficialAnnouncementsBlock([item()], { now: NOW })
    expect(block).toContain('2026-08-27')
    expect(block).toContain('央行')
    expect(block).toContain('115年7月金融情況')
  })

  // ★★ 日期一律台北曆日。證交所的 published_at **550/550 筆都正好是 16:00Z**
  // （＝台北隔日 00:00），用 toISOString() 取日期會把台北 8/28 的公告印成 8/27——
  // 差一天，而且是系統性的、每一則都錯。這個 repo 的 report-date.ts 檔頭就在講這件事：
  // 「UTC 曆日在本系統中不是任何東西的報告日」。
  it('日期用台北曆日，不是 UTC 曆日', () => {
    const block = buildOfficialAnnouncementsBlock([item({
      slug: 'twse-announcements',
      title: '全體證券商115年7月稅後淨利',
      publishedAt: new Date('2026-08-27T16:00:00Z'),
    })], { now: NOW })
    expect(block).toContain('2026-08-28')
    expect(block).not.toContain('2026-08-27')
  })

  it('帶得出摘要就一起給——這個 block 的價值是具名數據，不是標題清單', () => {
    const block = buildOfficialAnnouncementsBlock([item()], { now: NOW })
    expect(block).toContain('M2 年增率 4.2%')
  })

  it('沒有摘要的公告仍然列出（標題本身就是資訊）', () => {
    const block = buildOfficialAnnouncementsBlock([item({ summary: null })], { now: NOW })
    expect(block).toContain('115年7月金融情況')
  })

  // ★ 佔位摘要不可進 prompt。本機 dev DB 有 664 筆 content_summary 是 `[STUB-NO-LLM]`
  // 這種舊跑留下的佔位字串（prod 是 0、現行 code 也不再產生），而我們現在 local-first
  // 在跑——夾帶進 prompt 就是餵 LLM 一句沒有意義的話。判準只認「整串就是一個全大寫
  // 中括號 token」，不會誤傷任何真的中文摘要。
  it('佔位摘要當成沒有摘要，不印進 block', () => {
    const block = buildOfficialAnnouncementsBlock([item({ summary: '[STUB-NO-LLM]' })], { now: NOW })
    expect(block).not.toContain('STUB')
    expect(block).toContain('115年7月金融情況')
  })

  it('真摘要不會被佔位判準誤傷', () => {
    const block = buildOfficialAnnouncementsBlock([item({ summary: '[央行] 7 月 M2 年增率 4.2%' })], { now: NOW })
    expect(block).toContain('M2 年增率 4.2%')
  })

  it('濾掉例行索引貼文', () => {
    const block = buildOfficialAnnouncementsBlock([
      item({ slug: 'fsc-news', title: '金融監督管理委員會證券期貨局每日新聞（115年8月26日）', summary: null }),
      item(),
    ], { now: NOW })
    expect(block).not.toContain('每日新聞')
    expect(block).toContain('115年7月金融情況')
  })

  it('全部被濾掉時回 null', () => {
    const block = buildOfficialAnnouncementsBlock([
      item({ slug: 'fsc-news', title: '金融監督管理委員會證券期貨局每日新聞（115年8月26日）', summary: null }),
    ], { now: NOW })
    expect(block).toBeNull()
  })

  it('依發布時間新到舊排序', () => {
    const block = buildOfficialAnnouncementsBlock([
      item({ title: '舊的', publishedAt: new Date('2026-08-25T00:00:00Z') }),
      item({ title: '新的', publishedAt: new Date('2026-08-27T00:00:00Z') }),
    ], { now: NOW })
    expect(block ?? '').toMatch(/新的[\s\S]*舊的/)
  })

  // ★ per-source 上限：四個機關的發布量差很多（twse 2.2/日、ey 1.9、cbc 0.6、fsc 0.4），
  // 只有總數上限的話，發最多的那一個會把整個 block 佔滿——而它剛好也是例行公告最多的。
  it('單一機關最多佔幾則，不讓發布量大的把 block 佔滿', () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => item({
        slug: 'twse-announcements',
        title: `證交所 ${i}`,
        publishedAt: new Date(Date.UTC(2026, 7, 27, 10, 59 - i)),
      })),
      item({ slug: 'cbc-press', title: '央行的', publishedAt: new Date(Date.UTC(2026, 7, 27, 1)) }),
    ]
    const block = buildOfficialAnnouncementsBlock(items, { now: NOW, limit: 10, perSourceLimit: 3 })
    const lines = (block ?? '').split('\n')
    expect(lines.filter(l => l.includes('證交所'))).toHaveLength(3)
    // 央行只有一則、時間也最舊，但不該被證交所擠掉
    expect(block).toContain('央行的')
  })

  // ★ prompt 預算：官方公告合計每天約 5 則，但窗一拉長就會塞爆。上限是硬的。
  it('超過總數上限只留最新的幾則（跨來源）', () => {
    const slugs = ['cbc-press', 'ey-press', 'fsc-news', 'twse-announcements']
    const many = slugs.flatMap((slug, si) => Array.from({ length: 5 }, (_, i) => item({
      slug,
      title: `公告 ${si}-${i}`,
      publishedAt: new Date(Date.UTC(2026, 7, 27, 0, si * 5 + i)),
    })))
    const block = buildOfficialAnnouncementsBlock(many, { now: NOW, limit: 5, perSourceLimit: 5 })
    expect((block ?? '').split('\n').filter(l => l.startsWith('- ')).length).toBe(5)
    expect(block).toContain('公告 3-4') // 最新的
    expect(block).not.toContain('公告 0-0') // 最舊的
  })

  it('摘要過長會截斷，不讓單一則吃掉整個 block 的預算', () => {
    const block = buildOfficialAnnouncementsBlock([item({ summary: 'x'.repeat(500) })], { now: NOW })
    expect((block ?? '').length).toBeLessThan(400)
    expect(block).not.toBeNull()
  })
})
