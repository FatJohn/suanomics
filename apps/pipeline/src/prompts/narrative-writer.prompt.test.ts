import type { MarketBrief } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { formatUserContent } from '../agents/narrative-writer.js'
import { NARRATIVE_WRITER_SYSTEM_PROMPT, NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT } from './narrative-writer.prompt.js'

describe('跨日連續性節', () => {
  it('含跨日連續性節 + 三動作關鍵字', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('跨日連續性')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('接回昨天')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('相較昨日')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('兌現')
  })
  it('含誠實鐵律（禁硬連 / 稀疏日冷開場）', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('誠實鐵律')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('攀附')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('冷開場')
  })
})

describe('時間框架節', () => {
  it('含時間框架 + 禁止照抄來源今日 + 昨日', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('時間框架')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('禁止照抄')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('昨日')
  })
})

describe('時間框架節 台股對照表規則', () => {
  it('含對照表 + 台股 + 其他市場用發布時間', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('對照表')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('台股')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('發布時間')
  })
})

describe('narrative writer system prompt (主題式)', () => {
  it('不再強制逐則新聞一段', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).not.toContain('每則 news 一段')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).not.toContain('與輸入 newsId 數對齊')
  })
  it('含主題式 + 當日主軸 + 過場指示', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('當日主軸')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('主題段')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('承接')
  })
  it('保留合規鐵律', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('建議買')
  })
  it('指示每段務必完整句收尾', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('完整句')
  })
})

describe('具名數字紀律節', () => {
  it('含具名數字規則 + 禁推算/編造', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('具名數字')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('禁止自行推算')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('阿拉伯數字')
  })
})

describe('週末 prompt', () => {
  it('含本週回顧 + 下週前瞻結構關鍵字', () => {
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('本週回顧')
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('下週前瞻')
  })
  it('保留合規鐵律 + 具名數字（阿拉伯）紀律', () => {
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('建議買')
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('具名數字')
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('阿拉伯數字')
  })
})

describe('narrative writer weekday thesis spine + outlook', () => {
  it('intro 明確採用輸入本日論點立論', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('本日論點')
  })
  it('sections 須扣回本日論點（脊椎）', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('扣回')
  })
  it('outro 給觀察框架 + 下一個驗證點（前瞻）', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('觀察框架')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('下一個驗證點')
  })
  it('保留合規鐵律與具名數字紀律', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('建議買')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('阿拉伯數字')
  })
  it('前瞻用語不得引入 FORBIDDEN_PHRASES', () => {
    for (const bad of ['值得留意', '建議觀察', '建議留意'])
      expect(NARRATIVE_WRITER_SYSTEM_PROMPT).not.toContain(bad)
  })
  it('weekend prompt 未被動到（仍含下週前瞻）', () => {
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('下週前瞻')
  })
})

describe('時間框架節 總括泛稱禁令 (2026-07-31)', () => {
  // baseline 實跑顯示 intro/section/outro 三處都中招、且 outro 冒出「今日市場」
  // 這個 intro 以外的變體。規則層本身刻意拆寫成「「今日」或「今天」搭配…」、不含這些連續
  // 字串。
  //
  // 已知限制（review 揭露、刻意接受）：這是**封閉清單**、只擋得住列出的組合。它防的是
  // 「後人把規則寫直白」與「few-shot 又冒出同款措辭」，不是 LLM 產出層的守衛——產出層
  // 靠規則本身的通則陳述 + narrative-smoke 人工看。真正的回歸偵測缺口。
  it('weekday prompt 全文不含總括泛稱', () => {
    const banned = [
      '今日盤面',
      '今天盤面',
      '今日大盤',
      '今天大盤',
      '今日市場',
      '今天市場',
      '今日行情',
      '今天行情',
      '今日台股',
      '今天台股',
    ]
    for (const word of banned)
      expect(NARRATIVE_WRITER_SYSTEM_PROMPT).not.toContain(word)
  })

  it('含前瞻框架用語（改規則時不得把 few-shot 落下）', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('今日觀察主軸')
  })

  // review 揭露的繞道：editor 產的 dailyThesis 輸出空間可能自帶總括泛稱
  // （`editor-output.test.ts` 的 fixture 就是「…是今日台股結構性關注升溫的核心」），
  // 而 narrative 被指示「明確採用輸入本日論點」——不擋就會原樣照抄繞過本修復。
  it('明確要求改寫自帶總括泛稱的本日論點（堵 editor thesis 繞道）', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('改寫掉再用')
  })

  it('週末 prompt 不受本次改動影響（仍有既有的今日/今天禁令）', () => {
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('不要用「今日/今天」')
  })
})

// 脊椎指示把「扣回本日論點」寫成可照抄的宣告句型、模型跟著 few-shot 逐字
// 複誦到 production（「收束回本日論點」「這正支撐了本日論點所說的」等）。規則節本身**允許**
// 出現這些句子（它們在規則節是負面示例、用來告訴模型不要這樣寫），所以只鎖定 few-shot 範圍、
// 不能對整份 prompt 做 not.toContain——那樣規則節裡的負面示例反而會讓測試自己紅。
describe('段落收尾式宣告句已從 few-shot 移除', () => {
  const shots = NARRATIVE_WRITER_SYSTEM_PROMPT.split('# 範例（few-shot）')[1] ?? ''

  it('few-shot 不含已知的模板宣告句', () => {
    const banned = ['收束回本日論點', '這正支撐了本日論點', '這一段把本日論點', '順著本日論點的邏輯']
    for (const phrase of banned)
      expect(shots).not.toContain(phrase)
  })

  // ★ 斷言鎖的是**散文裡的指代**（`如本日論點所述`），不是「本日論點」四個字。
  // 只斷言四個字時，few-shot 的輸入示例標題「## 本日論點：」會讓它永遠綠——把 intro 裡
  // 唯一那句正常指代整句刪掉仍然全綠（2026-09-08 驗收實測），等於這條邊界沒有防線。
  it('few-shot 的輸出示例仍保留「本日論點」的正常指代（沒有把指代整段砍掉）', () => {
    expect(shots).toContain('如本日論點所述')
  })

  // 同一條指示有第二個現場：user content 在 dailyThesis 有值時也會給一句脊椎指示。
  // 兩邊措辭不一致時，離模型更近的 user content 會把模板句拉回來，而 system prompt 的
  // 測試全綠、沒有人會被告知（同一句規則被分別維護在兩處、只改一處的典型疏漏）。
  it('user content 的脊椎指示不給可照抄的宣告動詞', () => {
    const userContent = formatUserContent({
      brief: { headline: 'h', summary: 's', citations: [] } as unknown as MarketBrief,
      analystOutputs: [],
      news: [],
      citations: [],
      briefDate: '2026-09-08',
      dailyThesis: '今日主線是 X。',
    }, false)
    expect(userContent).toContain('本日論點')
    expect(userContent).not.toContain('收束回它')
    expect(userContent).not.toContain('扣回它')
  })
})

// 讀者面「一句話結論」（reader-redesign C 方案的三裝置之一）
describe('takeaway 一句話結論', () => {
  it('平日 prompt 要求每段產一句自足的結論句', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('takeaway')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('自足')
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('過場句')
  })
  it('平日 prompt 的 schema 區塊列出 takeaway', () => {
    expect(NARRATIVE_WRITER_SYSTEM_PROMPT).toContain('"takeaway"')
  })
  it('平日 prompt 的 few-shot 兩段都示範 takeaway（指示與範例必須同步、否則範例的錨定力會壓過指示）', () => {
    const shots = NARRATIVE_WRITER_SYSTEM_PROMPT.split('# 範例（few-shot）')[1] ?? ''
    expect(shots.split('"takeaway"').length - 1).toBe(2)
  })
  it('週末 prompt 同樣要求 takeaway 並列進 schema', () => {
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('takeaway')
    expect(NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT).toContain('"takeaway"')
  })
})
