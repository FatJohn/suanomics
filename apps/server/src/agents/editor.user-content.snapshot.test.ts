import { describe, expect, it } from 'vitest'
import { formatUserContent } from './editor.js'

// Characterization test：在把 editor.ts 的 user content 字面值搬到
// prompts/editor.user-content.ts 之前，先把目前送給 LLM 的 user content 逐位元組釘住。
// 覆蓋：5 個 item category、多條/零條敘事線、updates 寫入序亂掉（觸發排序）、
// 空的/非空的近三日 brief、有/無 calendarBlock/marketSnapshot/officialBlock、
// 會觸發 clampString 截斷的長字串。搬移過程中這份 snapshot 不准變。
describe('editor formatUserContent snapshot (characterization)', () => {
  it('captures full path: all 5 item categories, multi storylines with unsorted updates, non-empty recent briefs, all optional blocks present', () => {
    const content = formatUserContent({
      candidates: [
        { id: 1, title: '台積電法說會上修資本支出指引', excerpt: '公司預期明年資本支出將顯著成長', category: 'tech-semi' },
        { id: 2, title: '大立光第三季營收公布', excerpt: '光學鏡頭需求回升', category: 'tw-equity-other' },
        { id: 3, title: '美國CPI數據優於預期', excerpt: '通膨降溫速度加快', category: 'macro' },
        { id: 4, title: '國際油價因地緣衝突走高', excerpt: '布蘭特原油站上每桶90美元', category: 'energy' },
        { id: 5, title: '歐洲央行維持利率不變', excerpt: '市場預期年底前開始降息', category: 'international' },
      ],
      storylines: [
        {
          id: 10,
          title: 'Fed 降息路徑',
          thesis: '年內降息兩碼',
          status: 'open',
          entities: [],
          lastTouchedBriefDate: '2026-06-23',
          // 刻意寫入序亂掉：補跑造出的形狀，驗證輸出仍照 briefDate 排序取最近 3 筆
          updates: [
            { briefDate: '2026-06-23', valence: 'extend', note: '最新一筆' },
            { briefDate: '2026-06-20', valence: 'support', note: '應被排除的最舊一筆' },
            { briefDate: '2026-06-22', valence: 'challenge', note: '次新一筆' },
            { briefDate: '2026-06-21', valence: 'support', note: '第三新一筆' },
          ],
        },
        {
          id: 11,
          title: '尚無進展的敘事線',
          thesis: '仍在觀察階段',
          status: 'open',
          entities: [],
          lastTouchedBriefDate: '2026-06-23',
          updates: [],
        },
      ],
      recentBriefs: [
        { briefDate: '2026-06-22', headline: '昨日盤勢回顧', summary: '大盤震盪整理，成交量縮' },
        { briefDate: '2026-06-21', headline: '前日盤勢', summary: '外資大幅買超台股' },
      ],
      calendarBlock: '## 本週重要事件\n- 週四：美國PCE公布',
      marketSnapshot: '## 今日市場數據\n- 加權指數：23,150 點',
      officialBlock: '## 官方公告\n- 央行召開理監事會議',
    })
    expect(content).toMatchSnapshot()
  })

  it('captures empty path: zero candidates untouched but zero storylines and zero recent briefs, all optional blocks omitted', () => {
    const content = formatUserContent({
      candidates: [{ id: 1, title: '單一候選新聞標題', excerpt: '單一候選新聞摘要內容', category: 'macro' }],
      storylines: [],
      recentBriefs: [],
    })
    expect(content).toMatchSnapshot()
  })

  it('captures clampString truncation for overlong candidate title/excerpt', () => {
    const content = formatUserContent({
      candidates: [{ id: 12, title: '標'.repeat(200), excerpt: '述'.repeat(300), category: 'tw-equity-other' }],
      storylines: [],
      recentBriefs: [],
    })
    expect(content).toMatchSnapshot()
  })
})
