import { describe, expect, it } from 'vitest'
import { isMajorAnnouncement, previousReportDate, selectMajorAnnouncements } from './major-announcements.js'

function cand(sourceSlug: string, title: string, taipei: string | null, id = 1) {
  return { id, title, sourceSlug, publishedAt: taipei === null ? null : new Date(`${taipei}+08:00`) }
}

// 取自本機含完整歷史的資料庫的真實標題（`news_items` 的 `cbc-press`，2026 年 178 則裡人工讀過
// 確認的宏觀重大事件），加上獨立複查指出的漏抓。★ 引數字一律要說是哪張表：
// 同一批在 `external_articles` 是 176 則，兩張表母體不同。
// 守門用——判準改動若讓其中任一則落榜，或讓下面那組例行月報上榜，這支測試會紅。
const REAL_MAJOR = [
  '第21屆理事會第6次理監事聯席會議貨幣政策議事錄摘要',
  '115年6月18日央行理監事會後記者會簡報及外界關心之議題',
  '115年6月18日央行理監事會後記者會參考資料',
  '中央銀行理監事聯席會議決議新聞稿',
  '穆迪信評公司（Moody’s）維持我國國家主權評等為Aa3，展望穩定，並肯定央行貨幣政策表現',
  '本行發布第20期金融穩定報告',
  '第21屆理事會第5次理監事聯席會議貨幣政策議事錄摘要',
  '標準普爾信評公司(S&P)報告指出我國長期主權信用評等為AA+級，展望穩定，並肯定央行貨幣政策表現',
  '115年3月19日央行理監事會後記者會簡報及外界關心之議題',
  '115年3月19日央行理監事會後記者會參考資料',
  '本行貨幣政策架構操作策略檢視說明',
  '第21屆理事會第4次理監事聯席會議貨幣政策議事錄摘要',
  '本行調整實質換屋自住者之協處措施內容',
]

// **刻意不收**的邊際案例（真實標題）。它們是央行對外界說法的回應、不是政策動作；
// 開 `匯率`／`信用管制` 進 pattern 會一起帶進 17 則，其中多是澄清稿與闢謠稿。
// 判準若哪天放寬，這組會紅——那時要重新想「怎麼把正式回應與闢謠稿分開」。
const DELIBERATELY_EXCLUDED = [
  '新台幣匯率維持動態穩定',
  '本行對「美國財政部匯率政策報告」之說明',
  '網路社群流傳誤導民眾有關本行信用管制方向之影片，特此公告澄清',
  '近日媒體報導本行信用管制政策轉向及限縮十大建商貸款等新聞查與事實不符',
  '有關某不動產業者反映本行信用管制措施導致民眾無法申辦地上權貸款，特此說明',
  '經常帳餘額與匯率之相關性',
]

// 同一批歷史裡的例行月報與行政庶務（九成以上是這種形狀）。一則都不該上榜。
const REAL_ROUTINE = [
  '115年7月消費者貸款及建築貸款餘額統計表',
  '115年7月份台北外匯市場概況',
  '115年7月金融情況',
  '115年7月五大銀行新承做放款平均利率',
  '115年7月銀行辦理人民幣業務概況',
  '115年7月底外匯存底',
  '115年7月準備貨幣',
  '115年7月存款不足退票概況',
  '115年第2季國際收支',
  '第28期公開拍賣特殊號碼鈔券',
  '中央銀行重要人事異動',
  '115年第3季中央銀行定期存單標售發行資訊',
  '因應春節ATM跨行提款、轉帳暨新鈔兌換之相關措施',
  '「臺灣之美」系列鈔券面額主題票選活動結果',
  '115年7月銀行衍生性金融商品交易量統計',
  '115年7月全體金融機構流動準備計提情形',
]

describe('isMajorAnnouncement', () => {
  it('真實重大公告全數命中', () => {
    expect(REAL_MAJOR.filter(t => !isMajorAnnouncement(t))).toEqual([])
  })

  it('例行月報與行政庶務一則都不命中', () => {
    expect(REAL_ROUTINE.filter(t => isMajorAnnouncement(t))).toEqual([])
  })

  it('澄清稿與闢謠稿不命中（判準窄的代價是漏掉兩則正式回應，刻意接受）', () => {
    expect(DELIBERATELY_EXCLUDED.filter(t => isMajorAnnouncement(t))).toEqual([])
  })

  it('明年開會日程的預告不命中', () => {
    expect(isMajorAnnouncement('115年中央銀行理監事聯席會議預定日期')).toBe(false)
    expect(isMajorAnnouncement('114年中央銀行理監事聯席會議預定日期')).toBe(false)
    // 排除規則不可波及真正的決議
    expect(isMajorAnnouncement('中央銀行理監事聯席會議決議新聞稿')).toBe(true)
  })

  it('央行真的升降息時的標題形狀也命中（目前歷史為零、留著防未來）', () => {
    expect(isMajorAnnouncement('本行調升政策利率0.25個百分點')).toBe(true)
    expect(isMajorAnnouncement('本行調降重貼現率')).toBe(true)
  })
})

describe('previousReportDate', () => {
  it('平日就是前一天', () => {
    expect(previousReportDate('2026-06-19')).toBe('2026-06-18')
  })

  it('★ 週日往回跳過週六，接到週五——否則週五發的公告永遠沒人撿', () => {
    // 2026-05-31 是週日、05-30 週六（classifyPublicationDay 判 skip）
    expect(previousReportDate('2026-05-31')).toBe('2026-05-29')
  })
})

describe('selectMajorAnnouncements', () => {
  const opts = { reportDate: '2026-06-19' }

  it('只認 cbc-press：其餘來源即使標題像也不收', () => {
    const rows = [
      cand('google-news-cbc', '中央銀行理監事聯席會議決議新聞稿', '2026-06-18T16:23'),
      cand('cna', '央行貨幣政策轉向', '2026-06-18T16:23'),
    ]
    expect(selectMajorAnnouncements(rows, opts)).toEqual([])
  })

  it('同一台北曆日多則只留決議那一則', () => {
    const rows = [
      cand('cbc-press', '115年6月18日央行理監事會後記者會簡報及外界關心之議題', '2026-06-18T17:48', 1),
      cand('cbc-press', '115年6月18日央行理監事會後記者會參考資料', '2026-06-18T16:25', 2),
      cand('cbc-press', '中央銀行理監事聯席會議決議新聞稿', '2026-06-18T16:23', 3),
    ]
    expect(selectMajorAnnouncements(rows, opts).map(r => r.title)).toEqual(['中央銀行理監事聯席會議決議新聞稿'])
  })

  it('該日沒有決議時，取該日優先序最高的那則', () => {
    const rows = [
      cand('cbc-press', '本行發布第20期金融穩定報告', '2026-06-18T16:20', 1),
      cand('cbc-press', '第21屆理事會第6次理監事聯席會議貨幣政策議事錄摘要', '2026-06-18T16:21', 2),
    ]
    // 議事錄摘要是理監事會的產物、比金融穩定報告更貼近利率路徑
    expect(selectMajorAnnouncements(rows, opts).map(r => r.title)).toEqual(['第21屆理事會第6次理監事聯席會議貨幣政策議事錄摘要'])
  })

  it('窗是 [上一個報告日, 報告日]：決議下午發、隔天早上的報告吃得到，後天不再重複', () => {
    const rows = [cand('cbc-press', '中央銀行理監事聯席會議決議新聞稿', '2026-06-18T16:23')]
    expect(selectMajorAnnouncements(rows, { reportDate: '2026-06-19' }).length).toBe(1)
    expect(selectMajorAnnouncements(rows, { reportDate: '2026-06-22' }).length).toBe(0)
    // 也不會在發布日之前就上榜
    expect(selectMajorAnnouncements(rows, { reportDate: '2026-06-17' }).length).toBe(0)
  })

  it('★ 週五發布的公告，週日的報告撿得到（週六 skip、固定兩天窗會漏掉）', () => {
    // 2026-05-29（週五）第20期金融穩定報告——歷史真實案例
    const rows = [cand('cbc-press', '本行發布第20期金融穩定報告', '2026-05-29T16:20')]
    expect(selectMajorAnnouncements(rows, { reportDate: '2026-05-31' }).length).toBe(1)
  })

  it('★ 台北日界不是 UTC 日界：16:00Z 那批不會被算成前一天', () => {
    // 台北 2026-06-19 00:00 ＝ 2026-06-18T16:00Z。用 UTC 取曆日會判成 06-18。
    const rows = [{ id: 1, sourceSlug: 'cbc-press', title: '中央銀行理監事聯席會議決議新聞稿', publishedAt: new Date('2026-06-18T16:00:00Z') }]
    // 台北曆日 06-19 → 報告日 06-19 的窗 [06-18, 06-19] 內
    expect(selectMajorAnnouncements(rows, { reportDate: '2026-06-19' }).length).toBe(1)
    // 報告日 06-22（週一，上一個報告日是週日 06-21）→ 台北曆日 06-19 不在窗內。
    // 若誤用 UTC 曆日（06-18）同樣不在，分辨不出來——真正能分辨的是 06-19 那條。
    expect(selectMajorAnnouncements(rows, { reportDate: '2026-06-22' }).length).toBe(0)
  })

  it('沒有發布時間的候選不收（沒有時間錨點就判不出屬於哪一天的報告）', () => {
    expect(selectMajorAnnouncements([cand('cbc-press', '中央銀行理監事聯席會議決議新聞稿', null)], opts)).toEqual([])
  })

  it('保留席預設 1 格：跨兩日各有一則時，決議優先於主權評等', () => {
    const rows = [
      cand('cbc-press', '穆迪信評公司維持我國國家主權評等為Aa3', '2026-06-19T11:56', 1),
      cand('cbc-press', '中央銀行理監事聯席會議決議新聞稿', '2026-06-18T16:23', 2),
    ]
    expect(selectMajorAnnouncements(rows, opts).map(r => r.title)).toEqual(['中央銀行理監事聯席會議決議新聞稿'])
  })

  it('limit 放寬後同級按時間新到舊；limit 0 直接回空', () => {
    const rows = [
      cand('cbc-press', '穆迪信評公司維持我國國家主權評等為Aa3', '2026-06-19T11:56', 1),
      cand('cbc-press', '中央銀行理監事聯席會議決議新聞稿', '2026-06-18T16:23', 2),
    ]
    expect(selectMajorAnnouncements(rows, { ...opts, limit: 2 }).map(r => r.title))
      .toEqual(['中央銀行理監事聯席會議決議新聞稿', '穆迪信評公司維持我國國家主權評等為Aa3'])
    expect(selectMajorAnnouncements(rows, { ...opts, limit: 0 })).toEqual([])
  })

  it('沒有任何命中時回空陣列（呼叫端據此不動用保留席）', () => {
    expect(selectMajorAnnouncements([cand('cbc-press', '115年7月金融情況', '2026-06-18T16:20')], opts)).toEqual([])
  })

  it('回傳的是原候選物件（呼叫端要拿它的 id 與 url 走選稿路徑）', () => {
    const row = { id: 4242, sourceSlug: 'cbc-press', title: '中央銀行理監事聯席會議決議新聞稿', publishedAt: new Date('2026-06-18T08:23:00Z'), url: 'https://www.cbc.gov.tw/x' }
    expect(selectMajorAnnouncements([row], opts)[0]).toBe(row)
  })
})
