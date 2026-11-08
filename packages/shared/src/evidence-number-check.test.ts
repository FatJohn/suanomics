import type { EvidenceContext } from './evidence-checks.js'
import type { EvidenceClaim } from './evidence-claim.js'
import { describe, expect, it } from 'vitest'
import { checkDatedEvent, checkNamedNumbers, extractCheckedNumbers, extractDates } from './evidence-number-check.js'

const CTX: EvidenceContext = {
  citations: [
    { url: 'https://example.com/a', quote: '台積電 8 月 4 日法說會表示，全年資本支出上修至 420 億美元' },
    { url: 'https://example.com/b', quote: '費城半導體指數收在 12,179.26 點，單日漲 4.32%' },
  ],
  seriesPoints: [
    { seriesId: 'us-sox', asOf: '2026-08-04', value: 12179.26 },
    { seriesId: 'us-nasdaq-comp', asOf: '2026-08-04', value: 26584.99 },
    { seriesId: 'tw-foreign-net', asOf: '2026-08-04', value: -15000 },
  ],
  knownSeriesIds: ['us-sox', 'us-nasdaq-comp', 'tw-foreign-net'],
  calendarDates: ['2026-08-06'],
}

function claimOf(over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    id: 'c1',
    kind: 'fact',
    claimType: 'named-number',
    claim: '費城半導體指數收在 12,179.26 點。',
    evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' }],
    asOf: '2026-08-04',
    checks: [],
    ...over,
  }
}

// 「受檢數字」的判定順序是先排除、再納入——排除項多半也是合法的數字形狀。
describe('extractCheckedNumbers — 先排除', () => {
  it('excludes four-digit calendar years in 1900–2100', () => {
    expect(extractCheckedNumbers('2026 年景氣看淡，1999 年的情況不同', 'c1')).toEqual([])
  })
  it('still counts four-digit numbers outside the year range', () => {
    expect(extractCheckedNumbers('指數來到 1850 點', 'c1').map(n => n.value)).toEqual([1850])
    expect(extractCheckedNumbers('成交量 2200 億元', 'c1').map(n => n.value)).toEqual([2200])
  })
  it('excludes ordinals such as 第 3 季', () => {
    expect(extractCheckedNumbers('第 3 季營收持平', 'c1')).toEqual([])
    expect(extractCheckedNumbers('第 4 季與第 1 季相比', 'c1')).toEqual([])
  })
  it('excludes calendar days such as 8 月 4 日 (D5 handles dates)', () => {
    expect(extractCheckedNumbers('8 月 4 日公布數據', 'c1')).toEqual([])
    expect(extractCheckedNumbers('2026-08-04 收盤', 'c1')).toEqual([])
  })
  it('excludes the claim id itself', () => {
    expect(extractCheckedNumbers('c1 指出風險升高', 'c1')).toEqual([])
  })
  // spec 只排除「claim id 本身」。句中若引用**別的** claim id，其數字部分仍會受檢。
  // 可接受：claim 是單句、可證偽的陳述，不該在句子裡討論其他 claim。
  it('only excludes this claim id, not other ids that happen to appear', () => {
    expect(extractCheckedNumbers('c2 指出 55 點的差距', 'c1').map(n => n.value)).toEqual([2, 55])
  })
  it('keeps the number when a date-like prefix does not actually form a date', () => {
    expect(extractCheckedNumbers('月增 4 個百分點', 'c1').map(n => n.value)).toEqual([4])
  })
  // 已知取捨、不是 bug：spec 定義排除項為「1900–2100 的四位數」，所以範圍內的真實數值
  // 也會被排除、不受檢（漏檢）。收窄成「後面必須接『年』」會誤放「2026 上半年」這類寫法，
  // spec 選了寧可漏檢不誤判。這條測試存在是為了讓未來踩到的人知道這是刻意的。
  it('documented trade-off: a real value inside the year range is excluded too', () => {
    expect(extractCheckedNumbers('成交 2026 億元', 'c1')).toEqual([])
  })
})

describe('extractCheckedNumbers — 再納入', () => {
  it('includes percentages, thousand separators, units, negatives, decimals and bare integers', () => {
    expect(extractCheckedNumbers('單日漲 4.32%', 'c1').map(n => n.value)).toEqual([4.32])
    expect(extractCheckedNumbers('收在 11,430.35 點', 'c1').map(n => n.value)).toEqual([11430.35])
    expect(extractCheckedNumbers('買超 120 億元', 'c1').map(n => n.value)).toEqual([120])
    expect(extractCheckedNumbers('淨部位 -15,000 口', 'c1').map(n => n.value)).toEqual([-15000])
    expect(extractCheckedNumbers('比值為 2.05', 'c1').map(n => n.value)).toEqual([2.05])
    expect(extractCheckedNumbers('報 23150', 'c1').map(n => n.value)).toEqual([23150])
  })
  it('keeps the raw form alongside the normalized value for findings', () => {
    const [n] = extractCheckedNumbers('收在 11,430.35 點', 'c1')
    expect(n?.raw).toBe('11,430.35')
    expect(n?.normalized).toBe('11430.35')
  })
  // 中文數字無法與 evidence 做精確比對，刻意不檢查；對應處置在 prompt（要求輸出阿拉伯數字）
  it('does not check Chinese numerals', () => {
    expect(extractCheckedNumbers('外資買超逾千億，三大法人同步站上兩成', 'c1')).toEqual([])
  })
  it('normalizes full-width digits and the full-width percent sign', () => {
    expect(extractCheckedNumbers('漲幅 ４.３２％', 'c1').map(n => n.value)).toEqual([4.32])
  })
})

// 中文「負」是負號的合法寫法，與 ASCII `-`／全形 `－` 等價。
//
// 為什麼非修不可（2026-08-12 prod 實例）：narrative 寫「淨部位維持負 88,924 口」、
// claim 寫「淨部位為 -88924 口」，同一個事實、同一個數字，但抽取器只認 `-`，於是
// 一邊抽出 +88924、一邊抽出 -88924，closeEnough 判不相等 → binding gate 誤判 unbound。
//
// 更嚴重的是反向：若某天 narrative 真的把「負 429 億」寫成「正 429 億」，改之前的
// 抽取器兩邊都會抽成 +429、**gate 反而不會叫**——正負號正是這條線最該敏感的維度。
describe('extractCheckedNumbers — 中文負號', () => {
  it('treats 負 immediately before a number as a minus sign', () => {
    expect(extractCheckedNumbers('淨部位維持負 88,924 口', 'c1').map(n => n.value)).toEqual([-88924])
    expect(extractCheckedNumbers('淨部位為負88924口', 'c1').map(n => n.value)).toEqual([-88924])
  })

  it('matches the ASCII form so the two writings compare equal', () => {
    const a = extractCheckedNumbers('外資台指期淨部位為負88,924口', 'c1').map(n => n.value)
    const b = extractCheckedNumbers('外資台指期淨部位為-88924口', 'c2').map(n => n.value)
    expect(a).toEqual(b)
  })

  it('handles full-width digits after 負', () => {
    expect(extractCheckedNumbers('淨部位負８８９２４口', 'c1').map(n => n.value)).toEqual([-88924])
  })

  // 「負」只在**緊接數字**時才是負號。「負債 5000 億」的負屬於詞彙、不是符號，
  // 這是這次改動不誤傷既有正數的關鍵。
  it('does not treat 負 as a sign when a word intervenes', () => {
    expect(extractCheckedNumbers('負債 5000 億元', 'c1').map(n => n.value)).toEqual([5000])
    expect(extractCheckedNumbers('負面因素影響 3 檔個股', 'c1').map(n => n.value)).toEqual([3])
  })

  // 已知取捨（比照本檔其他排除規則的處理方式）：「勝負2比1」這種寫法會被讀成 -2。
  // 財經總經語境下幾乎不出現，而漏抓負號的代價（gate 在正負號上失明）大得多。
  it('documented trade-off: 勝負2 is read as -2', () => {
    expect(extractCheckedNumbers('勝負2比1', 'c1').map(n => n.value)).toEqual([-2, 1])
  })

  // 語意上的負值（賣超／減少／下跌）**不在這次改動範圍**：那需要領域知識、且有歧義，
  // 機械處理會滑坡。對應處置在 prompt（要求 claim 用阿拉伯數字帶符號輸出）。
  it('does not infer sign from semantics such as 賣超', () => {
    expect(extractCheckedNumbers('賣超 120 億元', 'c1').map(n => n.value)).toEqual([120])
  })
})

describe('checkNamedNumbers — D4', () => {
  it('passes when a series ref carries the exact value', () => {
    expect(checkNamedNumbers(claimOf(), CTX).passed).toBe(true)
  })
  // 容差：Math.abs(a-b) <= Math.max(0.01, Math.abs(b)*1e-6)，吸收兩位小數末位進位
  it('passes within the series tolerance', () => {
    expect(checkNamedNumbers(claimOf({ claim: '費半收在 12,179.265 點。' }), CTX).passed).toBe(true)
  })
  it('fails outside the series tolerance', () => {
    const r = checkNamedNumbers(claimOf({ claim: '費半收在 12,180.99 點。' }), CTX)
    expect(r.passed).toBe(false)
    expect(r.unmatched.map(n => n.value)).toEqual([12180.99])
  })
  it('matches a negative series value', () => {
    const claim = claimOf({
      claim: '外資台指期淨部位 -15,000 口。',
      evidenceRefs: [{ kind: 'series', seriesId: 'tw-foreign-net', asOf: '2026-08-04' }],
    })
    expect(checkNamedNumbers(claim, CTX).passed).toBe(true)
  })
  it('passes when the number appears in a citation quote', () => {
    const claim = claimOf({
      claim: '台積電全年資本支出上修至 420 億美元。',
      evidenceRefs: [{ kind: 'citation', url: 'https://example.com/a' }],
    })
    expect(checkNamedNumbers(claim, CTX).passed).toBe(true)
  })
  it('fails when the number is absent from the citation quote', () => {
    const claim = claimOf({
      claim: '台積電全年資本支出上修至 999 億美元。',
      evidenceRefs: [{ kind: 'citation', url: 'https://example.com/a' }],
    })
    expect(checkNamedNumbers(claim, CTX).passed).toBe(false)
  })
  // citation 是文字比對、無容差：正規化後字串相等才算命中
  it('does not apply numeric tolerance to citation quotes', () => {
    const claim = claimOf({
      claim: '費半收在 12,179.27 點。',
      evidenceRefs: [{ kind: 'citation', url: 'https://example.com/b' }],
    })
    expect(checkNamedNumbers(claim, CTX).passed).toBe(false)
  })
  it('passes when any one of several refs matches', () => {
    const claim = claimOf({
      claim: '費半收在 12,179.26 點。',
      evidenceRefs: [
        { kind: 'citation', url: 'https://example.com/a' },
        { kind: 'series', seriesId: 'us-sox', asOf: '2026-08-04' },
      ],
    })
    expect(checkNamedNumbers(claim, CTX).passed).toBe(true)
  })
  it('requires every checked number to be supported, not just one', () => {
    const claim = claimOf({ claim: '費半收在 12,179.26 點，漲 99.9%。' })
    const r = checkNamedNumbers(claim, CTX)
    expect(r.passed).toBe(false)
    expect(r.unmatched.map(n => n.value)).toEqual([99.9])
  })
  it('passes vacuously when the sentence has no checked numbers', () => {
    expect(checkNamedNumbers(claimOf({ claim: '半導體族群走強。' }), CTX).passed).toBe(true)
  })
  // series ref 比對 (seriesId, asOf) 唯一決定的那一筆，不做鄰近日回退
  it('does not fall back to a neighbouring day', () => {
    const claim = claimOf({ evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-08-03' }] })
    expect(checkNamedNumbers(claim, CTX).passed).toBe(false)
  })
})

describe('extractDates / checkDatedEvent — D5', () => {
  // 中文日期沒帶年份，用 claim 的 asOf 年份補全（跨年報告的邊界目前不處理）
  it('extracts ISO dates and normalizes Chinese-style dates with the reference year', () => {
    expect(extractDates('2026-08-04 與 8 月 6 日', 2026)).toEqual(['2026-08-04', '2026-08-06'])
  })
  it('zero-pads single-digit Chinese months and days', () => {
    expect(extractDates('3 月 7 日', 2026)).toEqual(['2026-03-07'])
  })
  it('returns an empty array when there is no date', () => {
    expect(extractDates('費半收紅', 2026)).toEqual([])
  })
  it('passes when the date matches a series asOf', () => {
    const claim = claimOf({ claimType: 'dated-event', claim: '2026-08-04 費半收紅。' })
    expect(checkDatedEvent(claim, CTX).passed).toBe(true)
  })
  it('passes when the date appears in a calendar event', () => {
    const claim = claimOf({ claimType: 'dated-event', claim: '2026-08-06 公布 CPI。', evidenceRefs: [] })
    expect(checkDatedEvent(claim, CTX).passed).toBe(true)
  })
  it('fails when the date is supported by nothing', () => {
    const claim = claimOf({ claimType: 'dated-event', claim: '2026-12-25 將公布財報。' })
    expect(checkDatedEvent(claim, CTX).passed).toBe(false)
  })
  it('passes vacuously when the sentence carries no date', () => {
    expect(checkDatedEvent(claimOf({ claimType: 'dated-event', claim: '費半收紅。' }), CTX).passed).toBe(true)
  })
})

// 以下每一條都對應 2026-08-05 驗收實測出來的缺陷，修了要有測試釘住、否則下次照樣壞。
describe('extractCheckedNumbers — 驗收抓到的回歸', () => {
  it('does not invent a negative number from a hyphenated date fragment', () => {
    // `08-04` 曾被讀成 08 與 -04（假負數 -4）
    expect(extractCheckedNumbers('08-04 收盤', 'c1').map(n => n.value)).toEqual([8, 4])
  })
  it('still parses a real negative number', () => {
    expect(extractCheckedNumbers('淨部位 -15,000 口', 'c1').map(n => n.value)).toEqual([-15000])
  })
  it('treats 連/近/逾 + N 日 as a count, not a calendar day', () => {
    // 「連 5 日買超」的 5 是資料，曾被當曆日整個排除掉
    expect(extractCheckedNumbers('外資連 5 日買超', 'c1').map(n => n.value)).toEqual([5])
    expect(extractCheckedNumbers('近 3 日震盪', 'c1').map(n => n.value)).toEqual([3])
  })
  it('still excludes a bare calendar day', () => {
    expect(extractCheckedNumbers('4 日公布數據', 'c1')).toEqual([])
  })
  it('still excludes an ordinal day', () => {
    expect(extractCheckedNumbers('第 2 日回測', 'c1')).toEqual([])
  })
  it('reads a full-width comma between digits as a thousands separator', () => {
    // 「１２，３４５」曾裂成 12 與 345 兩個假數字
    expect(extractCheckedNumbers('成交 １２，３４５ 億元', 'c1').map(n => n.value)).toEqual([12345])
  })
  it('does not turn a full-width comma between non-digits into a separator', () => {
    expect(extractCheckedNumbers('漲 4，跌 3', 'c1').map(n => n.value)).toEqual([4, 3])
  })
  it('does not let a short claim id eat the prefix of a longer token', () => {
    // id `c1` 曾咬掉 `c10` 的前兩字、殘留假數字 0（結果是 [0, 55]）。
    // 現在 `c10` 完整保留、其數字部分照既有原則受檢——重點是那個 0 不該存在。
    const values = extractCheckedNumbers('c10 指出 55 點', 'c1').map(n => n.value)
    expect(values).toEqual([10, 55])
    expect(values).not.toContain(0)
  })
  it('does not shred the sentence when the claim id is purely numeric', () => {
    // id `1` 曾把 `12,179.26` 切成 `2,` 與 `79.26`
    expect(extractCheckedNumbers('費半收在 12,179.26 點', '1').map(n => n.value)).toEqual([12179.26])
  })
})

describe('extractCheckedNumbers — 全形逗號只在千分位位置生效', () => {
  it('does not merge a Chinese enumeration into one fabricated number', () => {
    // 曾把「5，3，2」併成 532——假數字會讓 D4 必然失敗、fact 被連帶降級，比裂開更難察覺
    expect(extractCheckedNumbers('分別為 5，3，2 檔', 'c1').map(n => n.value)).toEqual([5, 3, 2])
  })
  it('still reads a genuine full-width thousands separator', () => {
    expect(extractCheckedNumbers('成交 １２，３４５ 億元', 'c1').map(n => n.value)).toEqual([12345])
    expect(extractCheckedNumbers('收在 １１，４３０．３５ 點', 'c1').map(n => n.value)).toEqual([11430.35])
  })
  it('leaves a full-width comma followed by Chinese text alone', () => {
    expect(extractCheckedNumbers('漲 4，跌 3', 'c1').map(n => n.value)).toEqual([4, 3])
  })
})

// 以下兩條是**刻意留著、之後用真實樣本再收斂**的已知限制，方向都是漏檢而非誤判。
// 標成測試而不是留在腦子裡，理由與年份那條相同：讓限制是被知道的，不是被發現的。
describe('extractCheckedNumbers — documented limitations', () => {
  it('a year-less hyphenated date still yields two spurious numbers', () => {
    expect(extractCheckedNumbers('08-04 收盤', 'c1').map(n => n.value)).toEqual([8, 4])
  })
  it('multi-character count prefixes are not covered, so the number is dropped', () => {
    // 「連 5 日」有涵蓋，「連續 5 日」「逾期 7 日」沒有——lookbehind 只擋單字前綴
    expect(extractCheckedNumbers('連續 5 日買超', 'c1')).toEqual([])
    expect(extractCheckedNumbers('連 5 日買超', 'c1').map(n => n.value)).toEqual([5])
  })
})

// 稽核要比對「模型實際被給的那些表示法」，不是只比對原始值。
describe('券別不是資料', () => {
  it('drops the tenor in 10 年期 but keeps the yield', () => {
    expect(extractCheckedNumbers('美債10年期殖利率為4.32%', 'c1').map(n => n.value)).toEqual([4.32])
  })
  it('drops the tenor when written with spaces（series-config 的寫法）', () => {
    expect(extractCheckedNumbers('美債 10 年期殖利率為 4.32%', 'c1').map(n => n.value)).toEqual([4.32])
  })
  it('keeps 年增率 numbers——排除項刻意取窄，只排 N 年期', () => {
    expect(extractCheckedNumbers('CPI 年增 20%', 'c1').map(n => n.value)).toEqual([20])
    expect(extractCheckedNumbers('近 3 年累計成長 15%', 'c1').map(n => n.value)).toEqual([3, 15])
  })
})

describe('d4 的序列錨點 ＝ 原始值與顯示值兩者', () => {
  // 費半 10447.49 在快照 block 印成「10,447 點」——模型只看得到後者。
  const CTX_DISPLAY: EvidenceContext = {
    citations: [],
    seriesPoints: [{ seriesId: 'us-sox', asOf: '2026-07-24', value: 10447.49, displayValue: 10447 }],
    knownSeriesIds: ['us-sox'],
    calendarDates: [],
  }
  const ref = { kind: 'series' as const, seriesId: 'us-sox', asOf: '2026-07-24' }
  const sox = (text: string): EvidenceClaim =>
    claimOf({ claim: text, evidenceRefs: [ref], asOf: '2026-07-24' })

  it('passes when the model copies the rendered value', () => {
    expect(checkNamedNumbers(sox('費城半導體指數收在 10,447 點。'), CTX_DISPLAY).passed).toBe(true)
  })
  it('passes when the model uses the raw value', () => {
    expect(checkNamedNumbers(sox('費城半導體指數收在 10,447.49 點。'), CTX_DISPLAY).passed).toBe(true)
  })
  it('still fails a number the model rounded itself', () => {
    expect(checkNamedNumbers(sox('費城半導體指數收在 10,450 點。'), CTX_DISPLAY).passed).toBe(false)
  })
  it('still fails a number the model invented decimals for', () => {
    expect(checkNamedNumbers(sox('費城半導體指數收在 10,447.9 點。'), CTX_DISPLAY).passed).toBe(false)
  })
  // 10,447.5 對原值 10,447.49 只差 0.01 ＝ 容差下限，本來就該過——那個下限的存在理由
  // 正是吸收兩位小數的末位進位。寫成 FAIL 是誤解，不是這次改動要改的事。
  it('keeps absorbing last-digit rounding（容差下限不變）', () => {
    expect(checkNamedNumbers(sox('費城半導體指數收在 10,447.5 點。'), CTX_DISPLAY).passed).toBe(true)
  })
  it('falls back to the raw value when displayValue is absent', () => {
    const noDisplay: EvidenceContext = { ...CTX_DISPLAY, seriesPoints: [{ seriesId: 'us-sox', asOf: '2026-07-24', value: 10447.49 }] }
    expect(checkNamedNumbers(sox('費城半導體指數收在 10,447.49 點。'), noDisplay).passed).toBe(true)
    expect(checkNamedNumbers(sox('費城半導體指數收在 10,447 點。'), noDisplay).passed).toBe(false)
  })
})

describe('前值點是自己的錨點、帶自己的 asOf', () => {
  const CTX_PREV: EvidenceContext = {
    citations: [],
    seriesPoints: [
      { seriesId: 'us-sox', asOf: '2026-07-24', value: 10447.49, displayValue: 10447 },
      { seriesId: 'us-sox', asOf: '2026-07-23', value: 10910.2, displayValue: 10910 },
    ],
    knownSeriesIds: ['us-sox'],
    calendarDates: [],
  }
  it('backs 前值 only through a ref carrying the previous as-of', () => {
    const withBoth = claimOf({
      claim: '費城半導體指數為 10,447 點，前值為 10,910 點。',
      evidenceRefs: [
        { kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' },
        { kind: 'series', seriesId: 'us-sox', asOf: '2026-07-23' },
      ],
      asOf: '2026-07-24',
    })
    expect(checkNamedNumbers(withBoth, CTX_PREV).passed).toBe(true)
  })
  it('does not let the latest-day ref back the previous value（不做鄰近日回退）', () => {
    const onlyLatest = claimOf({
      claim: '費城半導體指數為 10,447 點，前值為 10,910 點。',
      evidenceRefs: [{ kind: 'series', seriesId: 'us-sox', asOf: '2026-07-24' }],
      asOf: '2026-07-24',
    })
    const r = checkNamedNumbers(onlyLatest, CTX_PREV)
    expect(r.passed).toBe(false)
    expect(r.unmatched.map(n => n.normalized)).toEqual(['10910'])
  })
})
