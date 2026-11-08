// Taiwan 投信投顧法 + 金融消費者保護法 合規 helpers
// Single source of truth for Cascade / prompt-research。
// 下游 forbidden-filter / prompt builder / tool compliance scan 共用、避免規則漂移。

// ===== 禁用詞陣列 =====
export const FORBIDDEN_PHRASES: readonly string[] = Object.freeze([
  '建議買',
  '建議賣',
  '建議加碼',
  '建議減碼',
  '建議持有',
  '穩賺不賠',
  '保證獲利',
  '一定會漲',
  '一定會跌',
  // 拆成 price-prediction 專用句式、避免誤判「我一定會回覆你」這類日常語
  '一定會回升',
  '一定會回檔',
  '一定會回到',
  '建議攤平',
  '建議停損',
  '建議進場',
  '建議出場',
  // 軟推薦 / 方向性字眼（YT KOL 常用）
  '可以考慮',
  '值得考慮',
  '值得關注',
  '值得留意',
  '值得追蹤',
  '建議觀察',
  '建議留意',
  '避開',
  '少碰',
  '繞開',
  '佈局',
  '可以進場',
  '可以出場',
  '進場時機',
  '出場時機',
  '進場點',
  '出場點',
  '加碼時機',
  '減碼時機',
  '看多',
  '看空',
  '偏多',
  '偏空',
  '轉多',
  '轉空',
  '做多',
  '做空',
  '增持',
  '減持',
])

// 最長禁用詞 - 1 即為 sliding window tail 長度：確保跨 chunk 拼接後
// 仍可偵測到分割在邊界的敏感字（chunk1="建" + chunk2="議買"）
const MAX_PHRASE_LEN = Math.max(...FORBIDDEN_PHRASES.map(p => p.length))
const WINDOW = Math.max(0, MAX_PHRASE_LEN - 1)

export interface ForbiddenMatch {
  hit: boolean
  phrase?: string
}

export function containsForbiddenPhrase(text: string): ForbiddenMatch {
  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase))
      return { hit: true, phrase }
  }
  return { hit: false }
}

export interface FilterPushResult {
  hit: boolean
  safe: string
  phrase?: string
}

export interface StreamingFilter {
  push: (chunk: string) => FilterPushResult
  flush: () => string
}

export function createStreamingFilter(): StreamingFilter {
  let buffer = ''
  let hitPhrase: string | undefined
  let stopped = false

  return {
    push(chunk: string): FilterPushResult {
      if (stopped) {
        return hitPhrase !== undefined
          ? { hit: true, safe: '', phrase: hitPhrase }
          : { hit: true, safe: '' }
      }
      if (chunk.length === 0)
        return { hit: false, safe: '' }

      const combined = buffer + chunk
      const match = containsForbiddenPhrase(combined)
      if (match.hit) {
        stopped = true
        hitPhrase = match.phrase
        buffer = ''
        return match.phrase !== undefined
          ? { hit: true, safe: '', phrase: match.phrase }
          : { hit: true, safe: '' }
      }

      // 保留 tail (WINDOW chars)、其餘當安全內容輸出
      if (combined.length <= WINDOW) {
        buffer = combined
        return { hit: false, safe: '' }
      }
      const emitLen = combined.length - WINDOW
      const safe = combined.slice(0, emitLen)
      buffer = combined.slice(emitLen)
      return { hit: false, safe }
    },
    flush(): string {
      if (stopped)
        return ''
      const out = buffer
      buffer = ''
      return out
    },
  }
}

// ===== Ticker / 公司名 + 方向性動詞 組合偵測 =====

export const TW_STOCK_NAMES = Object.freeze([
  '台積電',
  '鴻海',
  '聯發科',
  '大立光',
  '台達電',
  '廣達',
  '國泰金',
  '富邦金',
  '兆豐金',
  '中信金',
  '玉山金',
  '中租',
  '統一',
  '南亞',
  '可成',
  '台塑',
  '台化',
  '中華電',
  '台灣大',
  '遠傳',
  '中鋼',
  '群創',
  '友達',
  '和碩',
  '華碩',
  '宏碁',
  '緯創',
  '仁寶',
  '英業達',
] as const)

export const DIRECTION_VERBS = Object.freeze([
  '看多',
  '看空',
  '偏多',
  '偏空',
  '做多',
  '做空',
  '轉多',
  '轉空',
  '增持',
  '減持',
  '加碼',
  '減碼',
] as const)

// 第三方市場主體：方向詞若被這些主體歸因（前方短窗內）→ 事實陳述、非個人化指示
// 注意：只放「他方機構主體」。不可加「散戶/投資人」這種＝讀者本身的詞——
// 那會讓「建議散戶加碼台積電」這類對讀者的個人化指示漏接（且會切斷 建議加碼 連續詞偵測）。
export const ACTOR_SUBJECTS = Object.freeze([
  '外資',
  '法人',
  '投信',
  '自營商',
  '主力',
  '分析師',
  '避險基金',
  '壽險',
  '三大法人',
  '內資',
  '國安基金',
  '公股',
] as const)

const ATTRIBUTION_WINDOW = 8

const TICKER_REGEX = /(?<!\d)\d{4,6}(?!\d)/g
const PROXIMITY = 25

// 數字緊接這些單位後綴 → 是跌點/價格/年月日、不是股號、不列入 ticker
const UNIT_SUFFIXES = new Set(['點', '元', '%', '％', '年', '月', '日', '檔', '萬', '億', '倍', '季'])

export interface TickerDirectionMatch {
  hit: boolean
  ticker?: string
  company?: string
  verb?: string
  snippet?: string
}

interface Position { start: number, end: number, value: string }

function findTickers(text: string): Position[] {
  const positions: Position[] = []
  let match: RegExpExecArray | null
  TICKER_REGEX.lastIndex = 0
  // eslint-disable-next-line no-cond-assign -- canonical RegExp.exec loop idiom
  while ((match = TICKER_REGEX.exec(text)) !== null) {
    const end = match.index + match[0].length
    const nextChar = text[end]
    if (nextChar !== undefined && UNIT_SUFFIXES.has(nextChar))
      continue
    positions.push({ start: match.index, end, value: match[0] })
  }
  return positions
}

function findTerms(text: string, terms: readonly string[]): Position[] {
  const positions: Position[] = []
  for (const term of terms) {
    let idx = text.indexOf(term)
    while (idx !== -1) {
      positions.push({ start: idx, end: idx + term.length, value: term })
      idx = text.indexOf(term, idx + term.length)
    }
  }
  return positions
}

function buildSnippet(text: string, a: Position, b: Position): string {
  const start = Math.max(0, Math.min(a.start, b.start) - 10)
  const end = Math.min(text.length, Math.max(a.end, b.end) + 10)
  return text.slice(start, end)
}

// 方向詞前方 ≤ATTRIBUTION_WINDOW 字內出現任一 actor → 視為第三方歸因（事實放行）
function isAttributed(verb: Position, actors: Position[]): boolean {
  return actors.some((a) => {
    const gap = verb.start - a.end
    return gap >= 0 && gap <= ATTRIBUTION_WINDOW
  })
}

export function containsTickerDirection(text: string): TickerDirectionMatch {
  const tickers = findTickers(text)
  const companies = findTerms(text, TW_STOCK_NAMES)
  const actors = findTerms(text, ACTOR_SUBJECTS)
  const verbs = findTerms(text, DIRECTION_VERBS).filter(v => !isAttributed(v, actors))
  if (verbs.length === 0)
    return { hit: false }

  for (const verb of verbs) {
    for (const target of [...tickers, ...companies]) {
      const distance = Math.min(
        Math.abs(verb.start - target.end),
        Math.abs(target.start - verb.end),
      )
      if (distance <= PROXIMITY) {
        const isTicker = tickers.includes(target)
        return {
          hit: true,
          verb: verb.value,
          snippet: buildSnippet(text, target, verb),
          ...(isTicker ? { ticker: target.value } : { company: target.value }),
        }
      }
    }
  }
  return { hit: false }
}

// ===== Unified L3 compliance gate =====

export interface ComplianceViolation {
  violation: 'forbidden' | 'ticker-direction'
  matched: string
}

export function checkCompliance(text: string): ComplianceViolation | null {
  const f = containsForbiddenPhrase(text)
  if (f.hit)
    return { violation: 'forbidden', matched: f.phrase ?? '' }
  const t = containsTickerDirection(text)
  if (t.hit) {
    const matched = t.snippet ?? `${t.ticker ?? t.company ?? ''} ${t.verb ?? ''}`.trim()
    return { violation: 'ticker-direction', matched }
  }
  return null
}
