import { describe, expect, it } from 'vitest'
import { parseAnalyzeArgs } from './args.js'

describe('parseAnalyzeArgs', () => {
  it('解析 --url', () => {
    expect(parseAnalyzeArgs(['--url', 'https://example.com/a'])).toEqual({ source: 'url', url: 'https://example.com/a' })
  })

  it('解析 --text 與 --title', () => {
    expect(parseAnalyzeArgs(['--text', '聯準會宣布降息一碼', '--title', '降息'])).toEqual({ source: 'text', text: '聯準會宣布降息一碼', title: '降息' })
  })

  it('--url 也可帶 --title', () => {
    expect(parseAnalyzeArgs(['--title', 'T', '--url', 'https://example.com/a'])).toEqual({ source: 'url', url: 'https://example.com/a', title: 'T' })
  })

  it('略過 pnpm 轉傳的 -- 分隔符', () => {
    expect(parseAnalyzeArgs(['--', '--url', 'http://example.com/a'])).toEqual({ source: 'url', url: 'http://example.com/a' })
  })

  it.each([[[]], [['--title', 'T']]])('沒有 --url 也沒有 --text 時拒絕 %j', (argv) => {
    expect(() => parseAnalyzeArgs(argv)).toThrow('--url 或 --text')
  })

  it('--url 與 --text 同時給時拒絕', () => {
    expect(() => parseAnalyzeArgs(['--url', 'https://example.com/a', '--text', 'x'])).toThrow('只能擇一')
  })

  it.each([[['--url']], [['--url', 'example.com/a']], [['--url', 'ftp://example.com/a']], [['--url', 'not a url']]])('拒絕不是 http(s) 的 url %j', (argv) => {
    expect(() => parseAnalyzeArgs(argv)).toThrow('--url')
  })

  it.each([[['--text']], [['--text', '   ']]])('拒絕空白的 --text %j', (argv) => {
    expect(() => parseAnalyzeArgs(argv)).toThrow('--text')
  })

  it('拒絕空白的 --title', () => {
    expect(() => parseAnalyzeArgs(['--text', 'x', '--title', ' '])).toThrow('--title')
  })

  it('拒絕未知參數', () => {
    expect(() => parseAnalyzeArgs(['--url', 'https://example.com/a', '--dry'])).toThrow('--dry')
  })
})
