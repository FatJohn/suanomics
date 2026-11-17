import { describe, expect, it } from 'vitest'
import { buildQualityUserContent, QUALITY_JUDGE_SYSTEM_PROMPT } from './quality-judge.prompt.js'
import { makeBrief } from './test-brief.js'

describe('quality system prompt', () => {
  it('每個檢查都對應到輸出欄位', () => {
    for (const field of ['chain', 'mechanism', 'unsupported', 'boilerplate', 'falsifier'])
      expect(QUALITY_JUDGE_SYSTEM_PROMPT).toContain(field)
  })

  it('要求引文逐字抄自報告：分數由程式比對原文', () => {
    expect(QUALITY_JUDGE_SYSTEM_PROMPT).toContain('逐字')
  })

  it('只用事實底本判斷，不引入外部知識', () => {
    expect(QUALITY_JUDGE_SYSTEM_PROMPT).toContain('不得用你自己的知識')
  })

  // 合規替代詞是投信投顧法要求的寫法，當成套話扣分會逼 writer 改回禁用語。
  it('合規替代詞不算套話', () => {
    expect(QUALITY_JUDGE_SYSTEM_PROMPT).toContain('合規')
  })
})

describe('buildQualityUserContent', () => {
  const facts = {
    marketSnapshot: '美債10年期殖利率 5.1%（前值 4.98%）',
    calendar: '11/18 台指期結算',
    official: null,
    news: [{ title: 'Fed 官員示警通膨', url: 'https://example.com/fed', text: 'Fed 官員示警通膨' }],
  }

  it('依序放報告日期、待評報告、事實底本', () => {
    const out = buildQualityUserContent({ date: '2026-11-17', brief: makeBrief(), facts })
    const order = ['報告日期：2026-11-17', '# 待評報告', '[標題]', '# 事實底本', '## 市場數據快照', '美債10年期殖利率 5.1%', '## 行事曆', '## 新聞', 'Fed 官員示警通膨｜https://example.com/fed']
    const positions = order.map(s => out.indexOf(s))
    expect(positions.every(p => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('缺的底本區塊明寫「無」，judge 才不會把缺資料當成報告捏造', () => {
    const out = buildQualityUserContent({ date: '2026-11-17', brief: makeBrief(), facts })
    expect(out).toMatch(/## 主管機關公告\n（無）/)
  })

  it('新聞內文與標題相同時只印一次', () => {
    const out = buildQualityUserContent({ date: '2026-11-17', brief: makeBrief(), facts })
    expect(out.split('Fed 官員示警通膨').length - 1).toBe(1)
  })

  it('不放報告自附的引用摘錄：那是 pipeline 自己寫的，不是獨立底本', () => {
    const out = buildQualityUserContent({ date: '2026-11-17', brief: makeBrief(), facts: { ...facts, news: [] } })
    expect(out).not.toContain('Fed 官員示警通膨走錯方向')
  })
})
