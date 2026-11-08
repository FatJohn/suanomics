import type { EvidenceContext } from './evidence-checks.js'
import type { EvidenceClaim } from './evidence-claim.js'

// D4／D5：claim 句中的數字與日期是否真的落在它宣稱的證據裡。
// 「受檢數字」與「日期」的定義都寫死在這裡——不定義就是空話，兩個實作者會寫出不同東西。

export interface CheckedNumber {
  /** 句中原樣，供 findings 訊息用（如 `11,430.35`） */
  raw: string
  /** 去千分位、全形轉半形後的字串（如 `11430.35`）；citation 比對用它做字串相等 */
  normalized: string
  value: number
}

export interface NumberCheckResult {
  passed: boolean
  unmatched: CheckedNumber[]
}

export interface DateCheckResult {
  passed: boolean
  unmatched: string[]
}

/**
 * 與 `apps/server/src/market-data/nasdaq-client.ts` 的 `closeEnough` 同式。
 * 絕對下限吸收兩位小數的末位進位，相對項讓大指數（如 25,913.90）也有合理餘裕。
 *
 * 在此重寫而非 import：`apps/server` 依賴 `@suanomics/shared`，反向 import 會成套件循環。
 * 要收攏的話方向是 worker 改用本函式——所以它是 export 的，那條路才走得通。
 */
export function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 1e-6)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 全形數字（U+FF10–U+FF19）與全形符號轉半形。
 *
 * 全形逗號**只在夾在數字之間時**才視為千分位。無條件轉換會把中文句讀也變成逗號；完全不轉則會讓「１２，３４５」
 * 裂成兩個假數字 12 與 345，再誤判成 D4 失敗。
 */
export function normalizeText(s: string): string {
  return s
    .replace(/[\uFF10-\uFF19]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/％/g, '%')
    .replace(/．/g, '.')
    .replace(/－/g, '-')
    .replace(/(?<=\d)，(?=\d{3}(?!\d))/g, ',')
    // 中文「負」＝負號的合法寫法。**要求緊接數字**（可跨空白），否則「負債 5000 億」
    // 的詞彙用法會被讀成 -5000。連同空白一起吃掉是必要的——只換成 `-` 會留下
    // 「- 88924」，而 NUMBER_RE 的 `-?` 要求符號緊貼數字，結果仍抽成 +88924。
    //
    // 不處理**語意**負值（賣超／減少／下跌）：那需要領域知識、有歧義，機械化會滑坡。
    // 對應處置在 prompt——要求 claim 用阿拉伯數字帶符號輸出。
    .replace(/負\s*(?=\d)/g, '-')
}

/** 遮蔽用的等長佔位符。用半形空白——切勿改成字面控制字元（如 NUL），git 會把整份檔案當 binary、PR 上就讀不到了。 */
const PLACEHOLDER = ' '

// 判定順序是**先排除、再納入**，因為排除項多半也是合法的數字形狀。
// 長 pattern 必須排在短的前面：`8 月 4 日` 要先整段遮掉，否則 `8 月` 先命中會留下孤兒 `4 日`。
const EXCLUSION_PATTERNS: readonly RegExp[] = Object.freeze([
  /\d{4}-\d{2}-\d{2}/g, //                        ISO 日期
  /\d{1,2}\s*月\s*\d{1,2}\s*日/g, //              8 月 4 日
  /\d{1,2}\s*月/g, //                             8 月（後面接「份/底/初」不影響，那些不是數字）
  /第\s*\d+\s*[季度期章節條大日次]/g, //           第 3 季、第 4 大、第 2 日
  // 單獨的「N 日」是曆日 → 排除；但「連 5 日」「近 3 日」「逾 7 日」是**次數**，那是資料、要受檢。
  /(?<![連近逾]\s{0,2})\d{1,2}\s*日(?![圓元])/g,
  // 四位數西元年。
  // **已知取捨**：範圍內的四位數即使真的是數值（「成交 2026 億元」）也會被排除、不受檢。
  // 收窄成「後面必須接『年』」會漏掉「2026 上半年」這類寫法，寧可漏檢不誤判。
  /(?<![\d.,])(?:19\d{2}|20\d{2}|2100)(?![\d.,])/g,
  // 券別（tenor）是名稱的一部分、不是資料：「美債 10 年期殖利率為 4.32%」的 10 不該受檢，
  // 否則每一條殖利率 claim 都永遠過不了 D4（2026-08-05 對真實樣本乾跑實測：30/127 → 50/127）。
  // **刻意取窄**——只排 `N 年期`，不排一般的 `N 年`，避免誤傷「年增 20%」這類真資料。
  //
  // 位置與 lookbehind 缺一不可，兩者都是為了不咬穿更長的數字：排在四位數年份**之後**，
  // 且要求前面不是數字。第一版放在年份之前又沒有 lookbehind，「2026 年期貨結算」會被吃成
  // 「26 年期」而留下幻影 `20`（獨立複查 2026-08-05 實測），幻影數字永遠掛不上 ref，
  // 於是系統性壓低這次改動要拿去做決定的 D4——而且不會有任何測試變紅。
  /(?<![\d.,])\d{1,2}\s*年期/g, //                 10 年期、2 年期
])

// 負號前面若緊接數字或小數點，它是連字號不是負號（`08-04` 的 `-04` 不是 -4）。
const NUMBER_RE = /(?<![\d.,])-?\d[\d,]*(?:\.\d+)?/g

/**
 * 抽出 claim 句中的「受檢數字」。
 *
 * 中文數字（`兩成`、`逾千億`、`三大法人`）**不檢查**：它們無法與 evidence 做精確比對。
 * 對應的處置不在 D4 而在 prompt——要求具名數字一律用阿拉伯數字輸出。這是刻意的範圍決定。
 */
export function extractCheckedNumbers(sentence: string, claimId: string): CheckedNumber[] {
  let masked = normalizeText(sentence)
  // claim id 本身不是資料（`c1 指出…`）。要求前後皆非英數才遮，否則 id `c1` 會咬掉
  // `c10` 的前綴、殘留一個假數字 `0`；等長替換則保證不動到句中其他位置的比對結果。
  if (claimId) {
    const idRe = new RegExp(`(?<![0-9A-Za-z])${escapeRegExp(claimId)}(?![0-9A-Za-z])`, 'g')
    masked = masked.replace(idRe, m => PLACEHOLDER.repeat(m.length))
  }
  for (const re of EXCLUSION_PATTERNS)
    masked = masked.replace(re, m => PLACEHOLDER.repeat(m.length))

  const out: CheckedNumber[] = []
  for (const m of masked.matchAll(NUMBER_RE)) {
    const raw = m[0]
    // 尾隨的千分位逗號（`4,` 出現在「漲 4，跌 3」正規化後）不是數字的一部分
    const trimmed = raw.replace(/,+$/, '')
    const normalized = trimmed.replace(/,/g, '')
    const value = Number(normalized)
    if (Number.isFinite(value))
      out.push({ raw: trimmed, normalized, value })
  }
  return out
}

/** ISO 日期照收；中文日期沒帶年份，用 refYear 補全並補零。 */
export function extractDates(text: string, refYear: number): string[] {
  const s = normalizeText(text)
  const out: string[] = []
  for (const m of s.matchAll(/\d{4}-\d{2}-\d{2}/g))
    out.push(m[0])
  for (const m of s.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    const mm = String(Number(m[1])).padStart(2, '0')
    const dd = String(Number(m[2])).padStart(2, '0')
    out.push(`${refYear}-${mm}-${dd}`)
  }
  return out
}

function numberBackedByRef(n: CheckedNumber, ref: EvidenceClaim['evidenceRefs'][number], ctx: EvidenceContext): boolean {
  if (ref.kind === 'series') {
    // (seriesId, asOf) 唯一決定的那一筆，不做鄰近日回退——序列靜默沿用前一交易日
    // 正是要抓的失效模式，放寬回退等於把那個 bug 當成合法證據。
    const point = ctx.seriesPoints.find(p => p.seriesId === ref.seriesId && p.asOf === ref.asOf)
    if (!point)
      return false
    // 原始值與顯示值都算數：模型只看得到快照印出來的那個（費半 10447.49 → 10,447），
    // 照抄它天經地義。兩者都是**精確錨點**、不是放寬的區間，所以「自己約略化」仍抓得到。
    return closeEnough(n.value, point.value)
      || (point.displayValue != null && closeEnough(n.value, point.displayValue))
  }
  const cite = ctx.citations.find(c => c.url === ref.url)
  if (!cite)
    return false
  // citation 比對的是 quote 文字，要求正規化後**字串相等**、無容差：
  // quote 是別人寫的句子，不是量測值，沒有「末位進位」這回事。
  return extractCheckedNumbers(cite.quote, '').some(q => q.normalized === n.normalized)
}

/**
 * D4：claim 句中每個受檢數字都要能在它的 evidence 中找到。
 *
 * 多個 ref 時**任一命中即通過**（一個數字只需要一個來源支持），但**每個**數字都要有支持。
 */
export function checkNamedNumbers(claim: EvidenceClaim, ctx: EvidenceContext): NumberCheckResult {
  const numbers = extractCheckedNumbers(claim.claim, claim.id)
  const unmatched = numbers.filter(n => !claim.evidenceRefs.some(ref => numberBackedByRef(n, ref, ctx)))
  return { passed: unmatched.length === 0, unmatched }
}

/**
 * D5：claim 句中每個日期都要存在於 evidence——citation `quote`、series `asOf`
 * 或當日 calendar events 三者之一。
 *
 * calendarDates 不依附任何 ref：行事曆是當日全域事實，不是某一則引用的附屬品。
 */
export function checkDatedEvent(claim: EvidenceClaim, ctx: EvidenceContext): DateCheckResult {
  const refYear = Number(claim.asOf.slice(0, 4))
  const supported = new Set<string>(ctx.calendarDates)
  for (const ref of claim.evidenceRefs) {
    if (ref.kind === 'series') {
      supported.add(ref.asOf)
      continue
    }
    const cite = ctx.citations.find(c => c.url === ref.url)
    if (cite) {
      for (const d of extractDates(cite.quote, refYear))
        supported.add(d)
    }
  }
  const unmatched = extractDates(claim.claim, refYear).filter(d => !supported.has(d))
  return { passed: unmatched.length === 0, unmatched }
}
