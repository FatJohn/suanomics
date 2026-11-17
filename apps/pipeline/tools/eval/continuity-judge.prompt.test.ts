import type { ContinuityJudgeInput } from './continuity-judge.prompt.js'
import { describe, expect, it } from 'vitest'
import { buildContinuityUserContent, CONTINUITY_JUDGE_SYSTEM_PROMPT } from './continuity-judge.prompt.js'
import { makeBrief } from './test-brief.js'

const narrative = {
  intro: '開場',
  sections: [{ heading: '利率', body: '內文', takeaway: null, relatedNewsIds: [], claimIds: [], citationUrls: ['https://example.com/fed'] }],
  outro: '收尾',
}
const viewpoints = { supportPoints: ['支持甲', '支持乙'], riskPoints: ['風險甲', '風險乙'], netRead: '今日淨讀' }

const input: ContinuityJudgeInput = {
  date: '2026-11-17',
  brief: makeBrief({ headline: '今日標題', narrative, viewpoints }),
  priors: [
    { date: '2026-11-12', brief: makeBrief({ headline: '前天標題', narrative, viewpoints: { ...viewpoints, netRead: '前天淨讀' } }) },
    { date: '2026-11-13', brief: makeBrief({ headline: '昨天標題' }) },
  ],
  storylines: [
    { id: 5, title: '利率主軸', thesis: '殖利率壓估值', updates: [{ briefDate: '2026-11-13', valence: 'support', note: '4.98%' }, { briefDate: '2026-11-17', valence: 'challenge', note: '殖利率回落' }] },
    { id: 3, title: 'AI 電力', thesis: '電力瓶頸', updates: [{ briefDate: '2026-11-12', valence: 'extend', note: '電價' }] },
  ],
}

describe('continuity system prompt', () => {
  it('每個檢查都對應到輸出欄位', () => {
    for (const field of ['storylines', 'carryOver', 'falseContinuity', 'restatements'])
      expect(CONTINUITY_JUDGE_SYSTEM_PROMPT).toContain(field)
  })

  // v0 的鐵律：稀疏日不硬連才是對的，不能因為出現連接詞就加分。
  it('明講不偏好硬連', () => {
    expect(CONTINUITY_JUDGE_SYSTEM_PROMPT).toContain('不硬連')
  })

  it('說明 writer 最多只拿到兩條敘事線，未提不等於錯', () => {
    expect(CONTINUITY_JUDGE_SYSTEM_PROMPT).toContain('最多兩條')
  })
})

describe('buildContinuityUserContent', () => {
  const out = buildContinuityUserContent(input)

  it('前幾日報告由舊到新，最近一份標成昨日報告，最後才是今日報告', () => {
    const order = ['今日報告日期：2026-11-17', '## 2026-11-12', '前天標題', '## 2026-11-13（昨日報告）', '昨天標題', '# 敘事線', '# 今日報告', '今日標題']
    const positions = order.map(s => out.indexOf(s))
    expect(positions.every(p => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('前幾日報告只放敘事欄位，今日報告保留 viewpoints', () => {
    expect(out).not.toContain('前天淨讀')
    expect(out).toContain('今日淨讀')
  })

  it('敘事線列出論點與逐日進展，今日的進展另外標記；不放現況 status 以免洩漏未來', () => {
    expect(out).toContain('#5【利率主軸】論點：殖利率壓估值')
    expect(out).toContain('  - 2026-11-13（支持）：4.98%')
    expect(out).toContain('  - 2026-11-17（反向訊號，今日進展）：殖利率回落')
  })

  it('明列今日有進展的敘事線編號', () => {
    expect(out).toContain('今日有進展的敘事線：#5')
  })

  it('沒有今日進展的敘事線時明寫無', () => {
    const none = buildContinuityUserContent({ ...input, storylines: input.storylines.slice(1) })
    expect(none).toContain('今日有進展的敘事線：（無）')
  })
})
