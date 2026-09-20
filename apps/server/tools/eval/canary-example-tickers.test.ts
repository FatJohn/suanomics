import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectFixtureTickers, findTickerCollisions, parseCodeQuerySuggestions } from './canary-example-tickers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANARY_EXAMPLE_DIR = resolve(HERE, './fixtures/canary-example')

describe('parseCodeQuerySuggestions', () => {
  it('乾淨回應（無符合）過濾為空陣列', () => {
    expect(parseCodeQuerySuggestions(['(無符合之代碼或名稱)'])).toEqual([])
  })

  // 逐字取自 2026-09-11 的實測：codeQuery?query=00666 對 00666R 富邦恒生國企反1。
  it('撞到真實證券時拆出 code 與 name', () => {
    expect(parseCodeQuerySuggestions(['00666R\t富邦恒生國企反1'])).toEqual([
      { code: '00666R', name: '富邦恒生國企反1' },
    ])
  })

  it('沒有 tab 的項目不會被靜默丟掉', () => {
    expect(parseCodeQuerySuggestions(['weird-response-no-tab'])).toEqual([
      { code: 'weird-response-no-tab', name: '' },
    ])
  })
})

describe('findTickerCollisions', () => {
  const ticker = { file: 'x.json', path: 'relatedETFs[0].ticker', ticker: '00666' }

  it('lookup 回真實證券 → 進 collisions', async () => {
    const { collisions, unreachable } = await findTickerCollisions(
      [ticker],
      async () => ['00666R\t富邦恒生國企反1'],
    )
    expect(unreachable).toEqual([])
    expect(collisions).toEqual([
      { ticker, matches: [{ code: '00666R', name: '富邦恒生國企反1' }] },
    ])
  })

  it('lookup 回無符合 → collisions 為空', async () => {
    const { collisions, unreachable } = await findTickerCollisions(
      [ticker],
      async () => ['(無符合之代碼或名稱)'],
    )
    expect(collisions).toEqual([])
    expect(unreachable).toEqual([])
  })

  it('lookup 打不到（回 null）→ 進 unreachable、不進 collisions', async () => {
    const { collisions, unreachable } = await findTickerCollisions(
      [ticker],
      async () => null,
    )
    expect(collisions).toEqual([])
    expect(unreachable).toEqual([ticker])
  })
})

describe('collectFixtureTickers', () => {
  // ★ 負向對照：這條斷言撈到的數量 > 0，是因為上面每一條 findTickerCollisions
  // 的測試都用手造的 ticker，撈到 0 個的話真正的 fixture 目錄從沒被掃過，
  // 上面全部測試也還是會綠——這條才是唯一會抓到「掃描邏輯對真實目錄失效」的測試。
  it('對真實的 canary-example 目錄跑，撈到的數量必須 > 0', () => {
    const found = collectFixtureTickers(CANARY_EXAMPLE_DIR)
    expect(found.length).toBeGreaterThan(0)
  })

  it('不寫死欄位名：ticker 出現在 relatedETFs 以外的位置也撈得到', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'canary-ticker-'))
    try {
      writeFileSync(join(dir, 'weird.json'), JSON.stringify({ foo: { bar: [{ ticker: '00111' }] } }), 'utf8')
      const found = collectFixtureTickers(dir)
      expect(found).toEqual([
        { file: join(dir, 'weird.json'), path: 'foo.bar[0].ticker', ticker: '00111' },
      ])
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // 壞掉的 JSON 若被靜默跳過，那個檔的 ticker 就從檢查裡消失、報告照樣全綠——
  // 這個 repo 的系統性失敗模式（外部依賴失效回傳空結果）在這裡的版本。
  it('壞掉的 JSON 會炸，不會被靜默跳過', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'canary-ticker-'))
    try {
      writeFileSync(join(dir, 'broken.json'), '{ not valid json', 'utf8')
      expect(() => collectFixtureTickers(dir)).toThrow(/不是合法 JSON/)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('也撈 affectedTickers 陣列元素', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'canary-ticker-'))
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'chain.json'), JSON.stringify({ cascadeChains: [{ affectedTickers: ['示例科技供應鏈'] }] }), 'utf8')
      const found = collectFixtureTickers(dir)
      expect(found).toEqual([
        { file: join(dir, 'chain.json'), path: 'cascadeChains[0].affectedTickers[0]', ticker: '示例科技供應鏈' },
      ])
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
