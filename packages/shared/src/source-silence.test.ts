import { describe, expect, it } from 'vitest'
import {
  classifySourceSilence,
  SOURCE_SILENCE_WINDOW_DAYS,
  summarizeSourceSilence,
} from './source-silence.js'

const NOW = new Date('2026-08-21T00:00:00Z')
const OLD = '2026-06-01T00:00:00Z'
function zero(slug: string, createdAt = OLD) {
  return { slug, articlesInWindow: 0, totalArticles: 0, createdAt }
}

describe('classifySourceSilence', () => {
  it('曾經產出、窗內也有 → ok', () => {
    expect(classifySourceSilence({ slug: 'anue', articlesInWindow: 12, totalArticles: 450 })).toBe('ok')
  })

  it('曾經產出、窗內掛零 → silent（這才是回歸訊號）', () => {
    expect(classifySourceSilence({ slug: 'eia', articlesInWindow: 0, totalArticles: 41 })).toBe('silent')
  })

  it('從未產出 → never，不是 silent', () => {
    // 兩者處置不同：never 是既有設定破損，每天告警只會稀釋真訊號；
    // silent 是「本來會動、現在不動了」。混成一類，第一天就會有 10 個來源在叫。
    expect(classifySourceSilence({ slug: 'fomc-statements', articlesInWindow: 0, totalArticles: 0 })).toBe('never')
  })

  it('never 的判定優先於 silent（totalArticles 為 0 時 window 必然也是 0）', () => {
    expect(classifySourceSilence({ slug: 'x', articlesInWindow: 0, totalArticles: 0 })).not.toBe('silent')
  })
})

describe('summarizeSourceSilence', () => {
  const fixture = [
    { slug: 'anue', articlesInWindow: 12, totalArticles: 450 },
    { slug: 'reuters-world', articlesInWindow: 30, totalArticles: 1062 },
    { slug: 'eia', articlesInWindow: 0, totalArticles: 41 },
    { slug: 'fomc-statements', articlesInWindow: 0, totalArticles: 0 },
    { slug: 'moneydj', articlesInWindow: 0, totalArticles: 0 },
  ]

  it('分成 silent 與 never 兩組，ok 的不列', () => {
    const s = summarizeSourceSilence(fixture)
    expect(s.silent).toEqual(['eia'])
    expect(s.never).toEqual(['fomc-statements', 'moneydj'])
  })

  it('回報窗口天數，讓讀的人不必去翻常數', () => {
    expect(summarizeSourceSilence(fixture).windowDays).toBe(SOURCE_SILENCE_WINDOW_DAYS)
  })

  it('slug 排序穩定，否則告警訊息每次順序不同、難以比對', () => {
    const shuffled = [...fixture].reverse()
    expect(summarizeSourceSilence(shuffled).never).toEqual(['fomc-statements', 'moneydj'])
  })

  it('全部正常時兩組都是空陣列，不是 undefined', () => {
    const s = summarizeSourceSilence([{ slug: 'a', articlesInWindow: 1, totalArticles: 1 }])
    expect(s.silent).toEqual([])
    expect(s.never).toEqual([])
  })

  it('空輸入不炸', () => {
    const s = summarizeSourceSilence([])
    expect(s.silent).toEqual([])
    expect(s.never).toEqual([])
  })
})

describe('sOURCE_SILENCE_WINDOW_DAYS', () => {
  it('是 7', () => {
    // 2026-08-17 prod 實測近 30 日各來源每日產出間隔：最大是 cnbc-markets 的 6 天，
    // 其次 ey-press／iea／liberty-international／eia 的 4 天。7 是不誤報的最小整數。
    // 多數來源的平均間隔 2.0 是 corpus 每 2 天 refresh 的節奏、不是來源自己的節奏——
    // 所以 refresh 若改成每日，要**重新量**再調這個數字，不要照推。
    expect(SOURCE_SILENCE_WINDOW_DAYS).toBe(7)
  })
})

// 2026-08-21：把 udn-money／udn-main 換了新 feed，本機驗到 20／93 則，
// 但部署環境打同一個 feed 回 403。它們換完仍是 total=0，
// 因此會**永遠**留在只註記不告警的 never 類——換 feed 是一次明確的介入，
// 之後仍零產出應該要叫。缺的就是這條。
describe('summarizeSourceSilence 的預期外零產出', () => {
  it('沒給 opts 時維持原行為：全部歸 never、neverUnexpected 為空', () => {
    const r = summarizeSourceSilence([zero('a'), zero('b')])
    expect(r.never).toEqual(['a', 'b'])
    expect(r.neverUnexpected).toEqual([])
  })

  it('在接受清單裡的只註記，不進 neverUnexpected', () => {
    const r = summarizeSourceSilence([zero('moneydj'), zero('cbc-press')], {
      acceptedZeroOutput: ['moneydj'],
      now: NOW,
    })
    expect(r.never).toEqual(['cbc-press', 'moneydj'])
    expect(r.neverUnexpected).toEqual(['cbc-press'])
  })

  it('剛啟用還沒跑過 refresh 的來源有寬限期、不誤報', () => {
    const fresh = { slug: 'brand-new', articlesInWindow: 0, totalArticles: 0, createdAt: '2026-08-19T00:00:00Z' }
    const r = summarizeSourceSilence([fresh], { acceptedZeroOutput: [], now: NOW })
    expect(r.never).toEqual(['brand-new'])
    expect(r.neverUnexpected).toEqual([])
  })

  it('寬限期用 SOURCE_SILENCE_WINDOW_DAYS、邊界含當日', () => {
    const justOut = { slug: 'x', articlesInWindow: 0, totalArticles: 0, createdAt: '2026-08-13T00:00:00Z' }
    const r = summarizeSourceSilence([justOut], { acceptedZeroOutput: [], now: NOW })
    expect(r.neverUnexpected).toEqual(['x'])
  })

  it('曾經產出過的來源永遠不進 neverUnexpected（那是 silent 的地盤）', () => {
    const r = summarizeSourceSilence(
      [{ slug: 'eia', articlesInWindow: 0, totalArticles: 40, createdAt: OLD }],
      { acceptedZeroOutput: [], now: NOW },
    )
    expect(r.silent).toEqual(['eia'])
    expect(r.neverUnexpected).toEqual([])
  })

  it('neverUnexpected 也排序，兩天的輸出才比對得出差異', () => {
    const r = summarizeSourceSilence([zero('z'), zero('a')], { acceptedZeroOutput: [], now: NOW })
    expect(r.neverUnexpected).toEqual(['a', 'z'])
  })
})

// 有列 ≠ 可用。html-selector 的 excerpt 曾經寫死 null，於是 fsc-news 修好 selector
// 之後真的抓到 15 篇，15 篇卻一篇都沒 enrich——contentSummary/entities/topicTags 全空，
// 在 retriever 的 jsonb containment 底下永不命中。而它因為「有列」而離開了 never 類，
// SLO 顯示健康，比修之前更難發現。
describe('summarizeSourceSilence 的 zeroUsable', () => {
  const accepted = ['reuters-biz']
  const opts = { acceptedZeroOutput: [], acceptedZeroUsable: accepted, now: NOW }

  it('窗內有列、但一篇都沒 enrich → 進 zeroUsable', () => {
    const r = summarizeSourceSilence([
      { slug: 'fsc-news', articlesInWindow: 15, totalArticles: 15, usableInWindow: 0, createdAt: OLD },
    ], opts)
    expect(r.zeroUsable).toEqual(['fsc-news'])
  })

  it('在明示接受清單裡的來源不進（Google News 代理是規則一本來就要擋的）', () => {
    const r = summarizeSourceSilence([
      { slug: 'reuters-biz', articlesInWindow: 216, totalArticles: 715, usableInWindow: 0, createdAt: OLD },
    ], opts)
    expect(r.zeroUsable).toEqual([])
  })

  it('窗內只要有一篇 enrich 過就不進', () => {
    const r = summarizeSourceSilence([
      { slug: 'cnbc-markets', articlesInWindow: 12, totalArticles: 183, usableInWindow: 1, createdAt: OLD },
    ], opts)
    expect(r.zeroUsable).toEqual([])
  })

  it('窗內零列的來源不進——那是 silent／never 的事，不該重複叫', () => {
    const r = summarizeSourceSilence([
      { slug: 'liberty-finance', articlesInWindow: 0, totalArticles: 0, usableInWindow: 0, createdAt: OLD },
    ], opts)
    expect(r.zeroUsable).toEqual([])
    expect(r.never).toEqual(['liberty-finance'])
  })

  // 保守方向與 neverUnexpected 一致：拿不到這個數字時不叫，而不是當成 0 亂叫。
  it('沒有 usableInWindow 這個數字時不進', () => {
    const r = summarizeSourceSilence([
      { slug: 'x', articlesInWindow: 10, totalArticles: 10, createdAt: OLD },
    ], opts)
    expect(r.zeroUsable).toEqual([])
  })

  it('沒傳 opts 時恆為空陣列', () => {
    const r = summarizeSourceSilence([
      { slug: 'fsc-news', articlesInWindow: 15, totalArticles: 15, usableInWindow: 0, createdAt: OLD },
    ])
    expect(r.zeroUsable).toEqual([])
  })

  it('slug 升冪排序（兩天的輸出要能用肉眼比對）', () => {
    const r = summarizeSourceSilence([
      { slug: 'zeta', articlesInWindow: 3, totalArticles: 3, usableInWindow: 0, createdAt: OLD },
      { slug: 'alpha', articlesInWindow: 3, totalArticles: 3, usableInWindow: 0, createdAt: OLD },
    ], opts)
    expect(r.zeroUsable).toEqual(['alpha', 'zeta'])
  })
})
