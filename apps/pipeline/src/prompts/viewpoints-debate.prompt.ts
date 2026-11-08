import type { CascadeChain, EvidenceClaim } from '@suanomics/shared'
import { formatClaimLedgerBlock } from '@suanomics/shared'

// 三個辯論 agent 的 system prompt（移植 bounded-debate spike、標籤對齊「支持論點/風險與反證/綜合淨讀」）。
// 合規鐵律內建：禁買賣 / 進出場 / 目標價 / 明牌、以及方向性部位用語（看多看空 / 佈局等）；呈現兩面非推薦。
export const SUPPORT_PROMPT = `你是台灣總經財經日報的分析師。給你今日核心論點（thesis）與當日素材、請列出「支持這個核心論點成立」的最強論據（2-4 點、每點一句、有據、指到素材裡的實際事實或連動、每點 60 字內）。
你的任務是強化今日這個論點本身、順著它的判斷方向找佐證——不論這個論點偏樂觀或偏保守、都要給支持它成立的證據；不要一律往正向 / 機會面倒。
鐵律：只做事實與情境分析、不得出現任何買賣 / 進出場 / 目標價 / 明牌建議；亦不得使用「看多 / 看空 / 偏多 / 偏空 / 做多 / 做空 / 增持 / 減持 / 佈局」等方向性部位用語——改以「此因素支撐該論點成立、因為…」的分析框架陳述。`

export const RISK_PROMPT = `你是台灣總經財經日報的分析師。給你今日核心論點（thesis）與當日素材、請列出「這個核心論點的風險、反方、可能證偽」的最強論據（2-4 點、每點一句、有據、指到素材裡的實際事實或連動、每點 60 字內）。找真實的破口與反證、不要為反對而反對、也不要泛泛喊風險。
你的任務是質疑並證偽今日這個論點、站到它的對立面——不論這個論點偏樂觀或偏保守、都要給挑戰它的反證；方向必須與支持方相反。
鐵律：只做事實與情境分析、不得出現任何買賣 / 進出場 / 目標價 / 明牌建議；亦不得使用「看多 / 看空 / 偏多 / 偏空 / 做多 / 做空 / 增持 / 減持 / 佈局」等方向性部位用語——改以「此因素削弱該論點、因為…」的分析框架陳述。`

export const NET_READ_PROMPT = `你是台灣總經財經日報的總編審。給你今日核心論點、支持論據、風險論據。請收斂成一段「綜合淨讀」（120-300 字、繁體中文台灣用語、連貫文字非條列）：
- 核心論點在什麼條件下成立（吸收支持論據）；
- 有哪些須留意的風險 / 證偽條件（吸收風險論據）；
- 綜合後的淨讀（傾向哪邊、為什麼、但這是情境判斷、不是投資建議）。
鐵律：必須同時反映兩面、不得偏廢一方變成單向背書、也不得空泛對沖（要具體到今日素材的實際論點）。不得出現任何買賣 / 進出場 / 目標價 / 明牌建議；亦不得使用「看多 / 看空 / 偏多 / 偏空 / 做多 / 做空 / 增持 / 減持 / 佈局」等方向性部位用語、改以情境條件與分析框架陳述。`

// Gemini responseSchema（plain JSON schema、非 Zod）
export const POINTS_GEMINI_SCHEMA = {
  type: 'object',
  properties: { points: { type: 'array', items: { type: 'string' } } },
  required: ['points'],
}

export const NET_READ_GEMINI_SCHEMA = {
  type: 'object',
  properties: { netRead: { type: 'string' } },
  required: ['netRead'],
}

export interface DebateMaterialArgs {
  thesis: string
  headline: string
  summary: string
  marketSnapshot: string | null
  cascadeChains: CascadeChain[]
  claimLedger?: readonly EvidenceClaim[]
}

// 辯論素材（thesis + synthesizer headline/summary + 市場數據 + 連動鏈 + claim ledger）、兩個 side 共用。
//
// ledger 是 2026-08-12 補的：在那之前辯論 agent 只看得到 headline/summary/snapshot/chains，
// 於是 analyst 已經抽出來、還帶著 evidenceRef 的反向數字**兩個讀者面欄位都到不了**——
// 08-12 的費半 12,098（c18）與三大法人買超 280 億（c12）就是這樣掉的，risk 那邊只好去撈
// 貝萊德的 Q2 季末持倉當反證。
//
// 刻意不截斷：反向事實可能落在任何一條，cascadeChains 那種 slice(0, 20) 會把它丟掉，
// 而 ledger 的長度已由 analyst 上游收斂（實測 35-45 條）。
//
// 兩個 side 都給同一份素材：支持方與風險方的方向差異由各自的 system prompt 承擔，
// 在素材層做不對稱餵食等於預先替辯論選邊。
export function buildDebateMaterial(args: DebateMaterialArgs): string {
  const lines: string[] = []
  lines.push(`# 今日核心論點（thesis）\n${args.thesis}`)
  lines.push(`\n# Synthesizer\nheadline：${args.headline}\nsummary：${args.summary}`)
  if (args.marketSnapshot)
    lines.push(`\n# 市場數據\n${args.marketSnapshot}`)
  lines.push('\n# 連動鏈（analyst）')
  for (const c of args.cascadeChains.slice(0, 20))
    lines.push(`- ${c.industry}｜${c.mechanism}｜${c.direction}`)
  const ledger = args.claimLedger ?? []
  if (ledger.length > 0) {
    lines.push(`\n# 本日已核對的證據（claim ledger、共 ${ledger.length} 條）`)
    lines.push(formatClaimLedgerBlock(ledger))
  }
  return lines.join('\n')
}
