import type { EvidenceClaim } from '@suanomics/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as wrapper from './call-agent.js'
import { DailyCostLimitExceededError, LlmAccountError } from './cost-gate.js'
import { runViewpointsDebate } from './viewpoints-debate.js'

vi.mock('./call-agent.js')

const PARAMS = {
  thesis: '今日主線由 AI 算力與利率拉鋸主導',
  headline: 'h',
  summary: 's',
  marketSnapshot: null,
  cascadeChains: [],
}

const llm = vi.mocked(wrapper.callAgent)
// callAgent 為泛型、mock 回傳值以 as never 迴避 T 推導
function once(value: unknown) {
  llm.mockResolvedValueOnce(value as never)
}
// 3 次呼叫順序：support（Promise.all 陣列序 0）→ risk（序 1）→ net-read（await 後）
type Point = string | { text: string, section: number | null }
const asPoint = (p: Point) => (typeof p === 'string' ? { text: p, section: null } : p)
function mockDebate(support: Point[], risk: Point[], netRead: string) {
  once({ points: support.map(asPoint) })
  once({ points: risk.map(asPoint) })
  once({ netRead })
}

const SECTIONS = [
  { heading: 'AI 伺服器出貨', takeaway: '雲端資本支出續增', body: '甲段內文' },
  { heading: '利率路徑分歧', takeaway: null, body: '乙段內文' },
]

describe('runViewpointsDebate', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns viewpoints on happy path', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.supportPoints).toEqual(['支持一', '支持二'])
    expect(out?.riskPoints).toEqual(['風險一', '風險二'])
    expect(out?.netRead.length).toBe(130)
  })

  // ledger 必須真的抵達**兩個 side** 的 userContent。只在 params 上加欄位、
  // 忘了往 buildDebateMaterial 傳，型別與其餘測試都不會紅。
  it('passes claim ledger into both support and risk material', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
    const claim: EvidenceClaim = {
      id: 'c18',
      kind: 'fact',
      claimType: 'named-number',
      claim: '2026年8月11日費城半導體指數收於12,098點。',
      evidenceRefs: [],
      asOf: '2026-08-11',
      checks: [],
    }
    await runViewpointsDebate({ ...PARAMS, claimLedger: [claim] })
    const [support, risk] = llm.mock.calls
    expect(support?.[1]?.userContent).toContain('[c18]')
    expect(support?.[1]?.userContent).toContain('12,098')
    expect(risk?.[1]?.userContent).toContain('[c18]')
    expect(risk?.[1]?.userContent).toContain('12,098')
  })

  // #122：narrative 被告知前一交易日收盤缺資料時，辯論三方也要看到同一則提示，
  // 否則讀者面觀點會把舊行情當最新走勢、與詳解矛盾。
  it('passes market close framing into support, risk and net-read material', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
    await runViewpointsDebate({ ...PARAMS, marketCloseFraming: '前一交易日（11/25）的台股收盤缺資料' })
    for (const call of llm.mock.calls)
      expect(call[1]?.userContent).toContain('前一交易日（11/25）的台股收盤缺資料')
  })

  // 亂碼防線（2026-08-12 A/B 觀察到的真實產出、當時通過了 compliance gate 與 schema）
  const GARBLED = '成由攥䍕挧攥萱刑甘成甥、嘐瀕外資售日買超台股達903.08億元。'

  it('drops a garbled point but keeps viewpoints when >=2 clean remain', async () => {
    mockDebate(['支持一', '支持二', GARBLED], ['風險一', '風險二'], 'a'.repeat(130))
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.supportPoints).toEqual(['支持一', '支持二'])
  })

  it('degrades to null when netRead is garbled', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], `${GARBLED}${'a'.repeat(130)}`)
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  it('degrades to null when garbling leaves fewer than 2 risk points', async () => {
    mockDebate(['支持一', '支持二'], [GARBLED, `${GARBLED}又一句`], 'a'.repeat(130))
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  // 句級降級：單一違規 point 被丟棄、其餘保留（只要仍 ≥2 點）
  it('strips a violating support point but keeps viewpoints when >=2 clean remain', async () => {
    mockDebate(['支持一', '支持二', '佈局科技股'], ['風險一', '風險二'], 'a'.repeat(130))
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.supportPoints).toEqual(['支持一', '支持二'])
    expect(out?.riskPoints).toEqual(['風險一', '風險二'])
  })

  it('strips violating points from both support and risk', async () => {
    mockDebate(['支持一', '看多台股', '支持三'], ['風險一', '做空科技', '風險三'], 'a'.repeat(130))
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.supportPoints).toEqual(['支持一', '支持三'])
    expect(out?.riskPoints).toEqual(['風險一', '風險三'])
  })

  // 句級降級：net-read 內的違規句被丟棄、乾淨句保留（strip 後仍 >=120 字）
  it('strips a violating sentence from net-read but keeps the clean remainder', async () => {
    const cleanSentence = '此觀點在利率穩定下成立且資金回流。' // 17 字含句號
    const clean = cleanSentence.repeat(8) // 136 字、>=120
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], `${clean}這裡建議買進股票。`)
    const out = await runViewpointsDebate(PARAMS)
    expect(out).not.toBeNull()
    expect(out?.netRead).toBe(clean)
    expect(out?.netRead).not.toContain('建議買')
  })

  // #25 實跑：netRead 超過 schema 上限 360 字，整段 viewpoints 消失。
  describe('netRead 過長', () => {
    const SENTENCE = '此觀點在利率穩定下成立且資金回流。' // 17 字含句號

    it('超過 360 字時截到句界，保留整個 viewpoints', async () => {
      mockDebate(['支持一', '支持二'], ['風險一', '風險二'], SENTENCE.repeat(25)) // 425 字
      const out = await runViewpointsDebate(PARAMS)
      expect(out?.netRead).toBe(SENTENCE.repeat(21)) // 357 字：360 內最後一個句界
    })

    it('恰好 360 字不截斷', async () => {
      const exact = `${'字'.repeat(359)}。`
      mockDebate(['支持一', '支持二'], ['風險一', '風險二'], exact)
      expect((await runViewpointsDebate(PARAMS))?.netRead).toBe(exact)
    })

    it('先移除違規句再判斷長度：移除後已在上限內就不截', async () => {
      const clean = SENTENCE.repeat(20) // 340 字
      mockDebate(['支持一', '支持二'], ['風險一', '風險二'], `${'這裡建議買進股票。'.repeat(5)}${clean}`)
      expect((await runViewpointsDebate(PARAMS))?.netRead).toBe(clean)
    })

    // 半句話上讀者面比少一個區塊糟，這兩條維持 degrade。
    it('360 字內沒有句界時 degrade，不硬切半句', async () => {
      mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(400))
      expect(await runViewpointsDebate(PARAMS)).toBeNull()
    })

    it('截到句界後不足 120 字時 degrade', async () => {
      mockDebate(['支持一', '支持二'], ['風險一', '風險二'], `短句。${'a'.repeat(400)}`)
      expect(await runViewpointsDebate(PARAMS)).toBeNull()
    })
  })

  // 丟棄違規 point 後不足 2 點 → schema invalid → degrade null
  it('degrades to null when stripping drops support below min 2', async () => {
    mockDebate(['支持一', '佈局台積電'], ['風險一', '風險二'], 'a'.repeat(130))
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  // net-read 整句皆違規（strip 後清空）→ 低於 min 120 → degrade null
  it('degrades to null when net-read strips below min length', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], `${'a'.repeat(120)}建議買`)
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  it('degrades to null when fewer than 2 points (schema invalid)', async () => {
    mockDebate(['只有一點'], ['風險一', '風險二'], 'a'.repeat(130))
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  // #133：2026-11-27 risk 給了 5 條，schema max 4 讓整包 viewpoints 消失。
  describe('論點超過 4 條', () => {
    afterEach(() => vi.restoreAllMocks())
    const five = (prefix: string) => [1, 2, 3, 4, 5].map(i => ({ text: `${prefix}${i}`, section: (i % 2) + 1 }))

    it('support 與 risk 各給 5 條時保留前 4 條，參照一起截', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockDebate(five('支持'), five('風險'), 'a'.repeat(130))
      const out = await runViewpointsDebate({ ...PARAMS, sections: SECTIONS })
      expect(out).not.toBeNull()
      expect(out?.supportPoints).toEqual(['支持1', '支持2', '支持3', '支持4'])
      expect(out?.riskPoints).toEqual(['風險1', '風險2', '風險3', '風險4'])
      expect(out?.supportRefs).toEqual([2, 1, 2, 1])
      expect(out?.riskRefs).toEqual([2, 1, 2, 1])
      expect(warn).toHaveBeenCalledWith('[viewpoints-debate] points.truncated side=support kept=4 dropped=1')
      expect(warn).toHaveBeenCalledWith('[viewpoints-debate] points.truncated side=risk kept=4 dropped=1')
    })

    // netRead 不能引用讀者看不到的論點
    it('net-read 只拿到截斷後的論點', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockDebate(five('支持'), five('風險'), 'a'.repeat(130))
      await runViewpointsDebate(PARAMS)
      const netReadInput = llm.mock.calls[2]?.[1]?.userContent
      expect(netReadInput).toContain('風險4')
      expect(netReadInput).not.toContain('支持5')
      expect(netReadInput).not.toContain('風險5')
    })

    it('只有 risk 超過時只截 risk，沒有詳解段落也照截', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockDebate(['支持一', '支持二'], five('風險'), 'a'.repeat(130))
      const out = await runViewpointsDebate(PARAMS)
      expect(out?.supportPoints).toEqual(['支持一', '支持二'])
      expect(out?.riskPoints).toEqual(['風險1', '風險2', '風險3', '風險4'])
      expect(warn).toHaveBeenCalledTimes(1)
    })

    it('先濾掉違規點再截：濾完剩 4 條就不截', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockDebate(['支持一', '佈局科技股', '支持三', '支持四', '支持五'], ['風險一', '風險二'], 'a'.repeat(130))
      const out = await runViewpointsDebate(PARAMS)
      expect(out?.supportPoints).toEqual(['支持一', '支持三', '支持四', '支持五'])
      expect(warn).not.toHaveBeenCalled()
    })
  })

  it('degrades to null when an LLM call throws', async () => {
    llm.mockRejectedValue(new Error('llm 500') as never)
    expect(await runViewpointsDebate(PARAMS)).toBeNull()
  })

  // 每個論點帶它依據的詳解段落號
  describe('段落參照', () => {
    it('詳解段落進入支持與風險兩邊的素材', async () => {
      mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
      await runViewpointsDebate({ ...PARAMS, sections: SECTIONS })
      const [support, risk] = llm.mock.calls
      for (const call of [support, risk]) {
        expect(call?.[1]?.userContent).toContain('[詳解 1] AI 伺服器出貨')
        expect(call?.[1]?.userContent).toContain('甲段內文')
        expect(call?.[1]?.userContent).toContain('[詳解 2] 利率路徑分歧')
      }
    })

    it('回傳與論點逐項對應的參照，對不到段落的改標整體性', async () => {
      mockDebate(
        [{ text: '支持一', section: 1 }, { text: '支持二', section: 9 }],
        [{ text: '風險一', section: 2 }, { text: '風險二', section: null }],
        'a'.repeat(130),
      )
      const out = await runViewpointsDebate({ ...PARAMS, sections: SECTIONS })
      expect(out?.supportRefs).toEqual([1, null])
      expect(out?.riskRefs).toEqual([2, null])
    })

    it('違規論點與它的參照一起移除', async () => {
      mockDebate(
        [{ text: '支持一', section: 1 }, { text: '佈局科技股', section: 2 }, { text: '支持三', section: 2 }],
        [{ text: '風險一', section: 1 }, { text: '風險二', section: 2 }],
        'a'.repeat(130),
      )
      const out = await runViewpointsDebate({ ...PARAMS, sections: SECTIONS })
      expect(out?.supportPoints).toEqual(['支持一', '支持三'])
      expect(out?.supportRefs).toEqual([1, 2])
    })

    // net-read 不標段落，段落本文只是多花的 token
    it('net-read 的素材不含詳解段落', async () => {
      mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
      await runViewpointsDebate({ ...PARAMS, sections: SECTIONS })
      expect(llm.mock.calls[2]?.[1]?.userContent).not.toContain('# 詳解段落')
      expect(llm.mock.calls[2]?.[1]?.userContent).toContain('# 支持論據')
    })

    it('沒有詳解段落時不帶參照欄位', async () => {
      mockDebate([{ text: '支持一', section: 1 }, '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
      const out = await runViewpointsDebate(PARAMS)
      expect(out).not.toBeNull()
      expect(out?.supportRefs).toBeUndefined()
      expect(out?.riskRefs).toBeUndefined()
      expect(llm.mock.calls[0]?.[1]?.userContent).not.toContain('# 詳解段落')
    })
  })

  it('uses agentName viewpoints-debate for all three calls', async () => {
    mockDebate(['支持一', '支持二'], ['風險一', '風險二'], 'a'.repeat(130))
    await runViewpointsDebate(PARAMS)
    const names = llm.mock.calls.map(c => c[0])
    expect(names).toEqual(['viewpoints-debate', 'viewpoints-debate', 'viewpoints-debate'])
  })

  it('花費閘超限時往外丟，不降級成 null', async () => {
    llm.mockRejectedValue(new DailyCostLimitExceededError(1, 2))
    await expect(runViewpointsDebate(PARAMS)).rejects.toBeInstanceOf(DailyCostLimitExceededError)
  })

  it('帳務錯誤同樣穿透：花費閘超限時往外丟，不降級成 null', async () => {
    llm.mockRejectedValue(new LlmAccountError('billing'))
    await expect(runViewpointsDebate(PARAMS)).rejects.toBeInstanceOf(LlmAccountError)
  })
})
