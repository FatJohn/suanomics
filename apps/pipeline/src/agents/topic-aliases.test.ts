import { describe, expect, it, vi } from 'vitest'
import {
  buildTopicAliasMap,
  expandTopic,
  expandTopics,
  getDefaultTopicAliasMap,
  loadTopicAliasMap,
  normalizeTopicForm,
  warnIfTopicAliasMapEmpty,
} from './topic-aliases.js'

const MAP = buildTopicAliasMap([
  { canonical: 'semiconductor', aliases: ['半導體', '晶片', 'chips'] },
  { canonical: 'supply-chain', aliases: ['供應鏈', 'supply chain resilience'] },
])

describe('normalizeTopicForm', () => {
  it('英文轉小寫、空白轉 hyphen（corpus tag 的實際格式）', () => {
    expect(normalizeTopicForm('Supply Chain')).toBe('supply-chain')
    expect(normalizeTopicForm('Toy and Entertainment')).toBe('toy-and-entertainment')
  })

  it('trim 並收斂連續空白', () => {
    expect(normalizeTopicForm('  target   price  ')).toBe('target-price')
  })

  it('中文只 trim、不動內容', () => {
    expect(normalizeTopicForm(' 半導體 ')).toBe('半導體')
  })
})

describe('expandTopic', () => {
  it('未收錄的 topic 仍回原字串 + 正規化形式', () => {
    expect(expandTopic('Supply Chain', buildTopicAliasMap([]))).toEqual(['Supply Chain', 'supply-chain'])
  })

  it('原字串等於正規化形式時不重複', () => {
    expect(expandTopic('logistics', buildTopicAliasMap([]))).toEqual(['logistics'])
  })

  it('中文 topic 展開出對應的英文 corpus tag', () => {
    const out = expandTopic('半導體', MAP)
    expect(out).toContain('半導體')
    expect(out).toContain('semiconductor')
  })

  it('英文 topic 也展開出同組的中文 form（legacy 文章仍命中）', () => {
    const out = expandTopic('semiconductor', MAP)
    expect(out).toContain('semiconductor')
    expect(out).toContain('半導體')
  })

  it('查表用正規化形式、所以帶空白與大小寫的變體也命中同一組', () => {
    const out = expandTopic('Supply Chain Resilience', MAP)
    expect(out).toContain('supply-chain')
    expect(out).toContain('供應鏈')
  })

  // ★ 這條是防回歸的核心：展開是「加法」不是「取代」。corpus 裡有字面
  // 大寫的 tag（2026-08-21 prod 實測 AI:55 筆），把原字串換成正規化形式
  // 會讓現在命中的查詢反而歸零。
  //
  // map 裡刻意只放小寫的 'ai'、不放 'AI'：把原字串也列進 group 的話，改成
  // entity-aliases 那種「命中即取代」這條仍然會綠——那就等於沒有守。
  it('永遠保留原字串（corpus 有大小寫不規則的 tag，例如 AI）', () => {
    const out = expandTopic('AI', buildTopicAliasMap([{ canonical: 'artificial-intelligence', aliases: ['人工智慧', 'ai'] }]))
    expect(out).toContain('AI')
    expect(out).toContain('artificial-intelligence')
    expect(out).toContain('人工智慧')
  })

  it('空字串與純空白回空陣列', () => {
    expect(expandTopic('', MAP)).toEqual([])
    expect(expandTopic('   ', MAP)).toEqual([])
  })
})

describe('expandTopics', () => {
  it('跨 topic 去重、保留出現順序', () => {
    const out = expandTopics(['半導體', '晶片'], MAP)
    expect(out.filter(t => t === 'semiconductor')).toHaveLength(1)
    expect(out[0]).toBe('半導體')
  })

  it('丟掉空 topic', () => {
    expect(expandTopics(['', ' ', 'logistics'], MAP)).toEqual(['logistics'])
  })
})

describe('loadTopicAliasMap', () => {
  it('檔案不存在時安全降級成空 map（不拖垮檢索）', () => {
    const m = loadTopicAliasMap('/nonexistent/topic-aliases.yml')
    expect(expandTopic('半導體', m)).toEqual(['半導體'])
  })
})

// 降級是安全的，但不該是無聲的：空 map 之後檢索行為看起來與上線前一樣，
// 沒有任何測試或告警會紅。這是本 repo 記過的「失敗被寫成合法空結果」同一種病。
describe('warnIfTopicAliasMapEmpty', () => {
  it('空 map 會出聲', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      warnIfTopicAliasMapEmpty(buildTopicAliasMap([]))
      expect(warn).toHaveBeenCalledOnce()
      expect(String(warn.mock.calls[0]?.[0])).toContain('topic-aliases.yml')
    }
    finally {
      warn.mockRestore()
    }
  })

  it('非空 map 不出聲，且原樣回傳', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const m = buildTopicAliasMap([{ canonical: 'semiconductor', aliases: ['半導體'] }])
      expect(warnIfTopicAliasMapEmpty(m)).toBe(m)
      expect(warn).not.toHaveBeenCalled()
    }
    finally {
      warn.mockRestore()
    }
  })
})

// 出貨的 yml 與 corpus 詞彙的契約：canonical 必須是「corpus 實際在用的格式」
// ——英文小寫 kebab-case（enricher prompt 自 2026-08-04 起強制）。
// canonical 寫成中文或帶空白，等於這一組永遠對不到任何 corpus tag。
describe('出貨的 topic-aliases.yml', () => {
  const map = getDefaultTopicAliasMap()

  it('有載到內容（不是靜默降級成空 map）', () => {
    expect(map.formToGroup.size).toBeGreaterThan(50)
  })

  it('每個 canonical 都是英文小寫 kebab-case', () => {
    for (const forms of new Set(map.formToGroup.values())) {
      const canonical = forms[0]
      expect(canonical, `canonical: ${canonical}`).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
    }
  })

  // 同一個 form 出現在兩個 group 時，後者會靜默覆蓋前者、改變語意而不會有人發現。
  it('沒有任何 form 跨組重複', () => {
    const groups = new Set(map.formToGroup.values())
    let entries = 0
    for (const forms of groups)
      entries += forms.length
    expect(map.formToGroup.size).toBe(entries)
  })

  it('實際涵蓋 2026-08-21 prod 量到的 decomposer 中文 topic', () => {
    expect(expandTopic('供應鏈韌性', map)).toContain('supply-chain')
    expect(expandTopic('先進製程', map)).toContain('semiconductor')
    expect(expandTopic('地緣政治', map)).toContain('geopolitics')
  })
})
