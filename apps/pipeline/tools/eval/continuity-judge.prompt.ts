import type { MarketBrief } from '@suanomics/shared'
import { readerBlocks, renderBlocks } from './brief-text.js'

// 跨日連續性 checklist。v0 只給 judge「昨日一份 brief」並兩兩比較；這裡改成單份報告逐條判定，
// 素材補上前幾日報告與敘事線（storylines）的逐日進展，judge 才看得出「今天比之前多了什麼」。
// 分數由程式比對原文後計算（continuity-judge.ts 的 scoreContinuity）。
export const CONTINUITY_JUDGE_SYSTEM_PROMPT = `你是台灣總經財經日報的跨日連續性審查員。你會收到前幾個交易日的報告（由舊到新，最近一份標為昨日報告）、pipeline 追蹤中的敘事線與它們的逐日進展、以及今日報告。請逐條做下面的檢查，每一條都只依條件判定，不給整體印象分數。

# 共通規則
- 連續性要誠實：只有真的延續的主線才該回顧。前後幾天確實沒有共同主線時，今日報告不硬連才是正確的寫法，不可因為出現「延續」「持續」等連接詞就給好評。
- 所有 quote、item、todayQuote、priorQuote 欄位都要從指定的報告逐字複製一段連續文字（5 到 60 字），不可改寫、不可拼接兩處。程式會拿它去比對原文，對不上的一律不算。
- 只比較報告之間寫了什麼，不用你自己的知識判斷事實真偽。

# 檢查一：storylines
「今日有進展的敘事線」清單上的每一條各輸出一筆，id 填編號；清單以外的敘事線不要輸出。今日報告的寫作者只拿到其中最多兩條，所以 absent 是如實記錄，不代表寫作者犯錯。
- delta：今日報告提到這條線的主題（標題或論點裡的同一個事件、指標或實體），而且寫出前幾日報告沒有的新增量：新的數字、新的事件、方向改變，或明白說出今日的發展支持或挑戰了這條論點。
- restated：今日報告提到這條線，但內容前幾日報告都已經寫過，沒有新數字、新事件或新判斷。
- absent：今日報告沒有提到這條線的主題。
delta 與 restated 的 quote 逐字抄今日報告中提到這條線的那一段；absent 的 quote 填空字串。note 一句話說明新增量是什麼或為什麼判 restated。

# 檢查二：carryOver
從昨日報告找出所有明確的待觀察項，一項一筆：列在「後續觀察」「下一個驗證點」之類段落的項目、寫了日期的即將發生事件、「若……則……」形式的條件。item 逐字抄昨日報告的原文。每一項判定：
- not_due：該項寫明的日期在今日報告日期當天或之後，今天還不可能有結果。
- addressed：今日報告交代了這一項的結果或最新狀況。quote 逐字抄今日報告交代它的那一段。
- not_addressed：日期已過或沒有寫日期，但今日報告沒有交代。
not_due 與 not_addressed 的 quote 填空字串。昨日報告沒有待觀察項就回空陣列。

# 檢查三：falseContinuity
列出今日報告中宣稱與前幾日有關聯的句子（例如「延續昨日」「如前所述」「再度」「持續」），但它指的內容在前幾日報告與敘事線裡都找不到。quote 逐字抄今日報告那一句的關鍵片段，note 寫找不到的是什麼。沒有就回空陣列。

# 檢查四：restatements
列出今日報告中幾乎原樣重複前幾日報告某個論點、而且沒有新數字、新事件或新判斷的句子，最多 10 筆，挑最明顯的。todayQuote 抄今日報告，priorQuote 抄被重複的前日報告原文。同一個指標換成新的數值不算重述（那是新增量）。沒有就回空陣列。

輸出必須符合指定的 JSON schema。`

export interface StorylineView {
  id: number
  title: string
  thesis: string
  updates: readonly { briefDate: string, valence: 'support' | 'challenge' | 'extend', note: string }[]
}

export interface ContinuityJudgeInput {
  date: string
  brief: MarketBrief
  /** 由舊到新，最後一份是昨日報告。 */
  priors: readonly { date: string, brief: MarketBrief }[]
  storylines: readonly StorylineView[]
}

const NONE = '（無）'
const VALENCE_LABEL = { support: '支持', challenge: '反向訊號', extend: '進展' } as const

export function touchedStorylineIds(input: Pick<ContinuityJudgeInput, 'date' | 'storylines'>): number[] {
  return input.storylines.filter(s => s.updates.some(u => u.briefDate === input.date)).map(s => s.id)
}

// 不放 status：它是現況而非報告日當時的狀態（storylines 沒有狀態歷史），補評舊日期會洩漏之後才發生的兌現或證偽。
function storylineLines(input: ContinuityJudgeInput): string[] {
  if (input.storylines.length === 0)
    return [NONE]
  return input.storylines.flatMap(s => [
    `- #${s.id}【${s.title}】論點：${s.thesis}`,
    ...[...s.updates]
      .sort((a, b) => a.briefDate.localeCompare(b.briefDate))
      .map(u => `  - ${u.briefDate}（${VALENCE_LABEL[u.valence]}${u.briefDate === input.date ? '，今日進展' : ''}）：${u.note}`),
  ])
}

export function buildContinuityUserContent(input: ContinuityJudgeInput): string {
  const lastIndex = input.priors.length - 1
  const priors = input.priors.flatMap((p, i) => [
    `## ${p.date}${i === lastIndex ? '（昨日報告）' : ''}`,
    renderBlocks(readerBlocks(p.brief, { withAnalysis: false })),
    '',
  ])
  const touched = touchedStorylineIds(input)
  return [
    `今日報告日期：${input.date}`,
    '',
    '# 前幾日報告（由舊到新）',
    ...(priors.length === 0 ? [NONE, ''] : priors),
    '# 敘事線',
    ...storylineLines(input),
    `今日有進展的敘事線：${touched.length === 0 ? NONE : touched.map(id => `#${id}`).join('、')}`,
    '',
    '# 今日報告',
    renderBlocks(readerBlocks(input.brief)),
  ].join('\n')
}
