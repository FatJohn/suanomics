import { describe, expect, it } from 'vitest'
import { containsQuote, readerBlocks, renderBlocks } from './brief-text.js'
import { makeBrief } from './test-brief.js'

const narrative = {
  intro: '今日主軸是利率。',
  sections: [
    { heading: '利率壓過 AI', body: '殖利率升至 5.1%。', takeaway: '折現率上升', relatedNewsIds: [], claimIds: [], citationUrls: ['https://example.com/fed'] },
    { heading: '台股資金', body: '法人賣超 1,144 億元。', takeaway: null, relatedNewsIds: [], claimIds: [], citationUrls: ['https://example.com/fed'] },
  ],
  outro: '後續觀察 CPI。',
}

describe('readerBlocks', () => {
  it('依讀者閱讀順序列出 reader 面欄位，段落帶小標與 takeaway', () => {
    const blocks = readerBlocks(makeBrief({ dailyThesis: '利率檢驗 AI', narrative }))
    expect(blocks.map(b => b.label)).toEqual(['標題', '本日論點', '摘要', '開場', '段落1「利率壓過 AI」', '段落2「台股資金」', '收尾', '推理鏈'])
    expect(blocks[4]?.text).toBe('殖利率升至 5.1%。\n重點：折現率上升')
    expect(blocks[5]?.text).toBe('法人賣超 1,144 億元。')
  })

  it('有 viewpoints 時列出支持、風險與綜合淨讀', () => {
    const viewpoints = { supportPoints: ['支持一', '支持二'], riskPoints: ['風險一', '風險二'], netRead: '淨讀內容' }
    const labels = readerBlocks(makeBrief({ viewpoints })).map(b => b.label)
    expect(labels).toEqual(['標題', '摘要', '支持論點', '風險論點', '綜合淨讀', '推理鏈'])
  })

  it('withAnalysis=false 只留敘事欄位，給前幾日報告省 token', () => {
    const viewpoints = { supportPoints: ['a', 'b'], riskPoints: ['c', 'd'], netRead: 'e' }
    const labels = readerBlocks(makeBrief({ narrative, viewpoints }), { withAnalysis: false }).map(b => b.label)
    expect(labels).toEqual(['標題', '摘要', '開場', '段落1「利率壓過 AI」', '段落2「台股資金」', '收尾'])
  })
})

describe('renderBlocks', () => {
  it('每個區塊以 [標籤] 起頭', () => {
    expect(renderBlocks([{ label: '標題', text: 'A' }, { label: '摘要', text: 'B\nC' }])).toBe('[標題] A\n[摘要] B\nC')
  })
})

describe('containsQuote', () => {
  const texts = ['美債 10 年期殖利率升至 5.1%，費半重挫 5.28%。', '法人賣超 1,144 億元。']

  it('忽略空白與全半形差異', () => {
    expect(containsQuote(texts, '殖利率升至5.1％')).toBe(true)
  })

  it('改了數字就對不上', () => {
    expect(containsQuote(texts, '殖利率升至 5.2%')).toBe(false)
  })

  it('空引文不算命中，免得 judge 交白卷也被當成有證據', () => {
    expect(containsQuote(texts, '  ')).toBe(false)
  })

  it('短於下限的引文不算命中：抄一個字或標點就能對上任何報告', () => {
    expect(containsQuote(texts, '。')).toBe(false)
    expect(containsQuote(texts, '億元')).toBe(false)
    expect(containsQuote(texts, '費半重挫')).toBe(false)
    expect(containsQuote(texts, '費半重挫', 4)).toBe(true)
  })

  it('只在單一區塊內比對，跨區塊拼接的引文對不上', () => {
    expect(containsQuote(texts, '5.28%。法人賣超')).toBe(false)
  })
})
