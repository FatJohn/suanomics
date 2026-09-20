import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CANARY_DIR, CANARY_KIND, canaryDatePath, canaryExampleBanner, canaryExampleNotice, listCanaryDates, loadCanarySources, resolveCanaryDir } from './canary-fixtures.js'
import { isValidEvalDate } from './date.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), 'canary-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeDate(date: string, sources: unknown): void {
  mkdirSync(resolve(dir, date), { recursive: true })
  writeFileSync(resolve(dir, date, 'sources.json'), JSON.stringify(sources), 'utf8')
}

describe('listCanaryDates', () => {
  it('回傳日期子目錄、依日期排序', () => {
    makeDate('2026-08-13', [])
    makeDate('2026-07-21', [])
    expect(listCanaryDates(dir)).toEqual(['2026-07-21', '2026-08-13'])
  })

  // README.md 就住在 fixtures/canary 裡；漏掉 isDirectory 的版本會把它當成一天。
  it('略過檔案，只認目錄', () => {
    makeDate('2026-08-13', [])
    writeFileSync(resolve(dir, 'README.md'), '# canary', 'utf8')
    writeFileSync(resolve(dir, '2026-08-14'), 'not a dir', 'utf8')
    expect(listCanaryDates(dir)).toEqual(['2026-08-13'])
  })

  // 只判 isDirectory 的版本會把 _scratch 收進來，接著在 readFileSync 當場炸；
  // 只判正則的版本會放行 2026-02-30 這種格式對但不存在的日期。
  it('略過非日期目錄與不存在的日期', () => {
    makeDate('2026-08-13', [])
    mkdirSync(resolve(dir, '_scratch'))
    mkdirSync(resolve(dir, '2026-02-30'))
    expect(listCanaryDates(dir)).toEqual(['2026-08-13'])
  })

  it('目錄不存在時回空陣列，不拋錯', () => {
    expect(listCanaryDates(resolve(dir, 'nope'))).toEqual([])
  })

  // 真 canary fixtures（sources.json / brief.json）含第三方新聞全文，不隨公開 repo
  // 發佈，所以不能斷言任何具體日期或內容——這條守的是 CANARY_DIR 這個路徑常數本身
  // 沒被改壞，以及不管目錄底下有什麼（含公開 repo 常見的「什麼都沒有」），
  // listCanaryDates() 吐出來的每一項都是合法日期格式。刻意留這則註解：不然下一個人
  // 會覺得這條斷言太弱、想把它「修回」原本釘死日期的版本，但那個版本在沒有真
  // fixtures 的 clone 上永遠是紅的。
  //
  // 容許兩種結尾：本機（放了真實 fixtures）會落在 `canary`，公開 repo 的
  // clone 沒有那組目錄、會靜默退版到 `canary-example`。哪一種都合法，但退版**不能**
  // 是無聲的，所以額外釘死 CANARY_KIND 要跟實際結尾一致——這條斷言本身就是在證明
  // 「退版有沒有發生」問得到答案，不是只有 CANARY_DIR 一個路徑字串。
  it('預設基底是 CANARY_DIR、回傳的每個日期都是合法格式（不釘死具體內容）', () => {
    const isReal = CANARY_DIR.endsWith(join('eval', 'fixtures', 'canary'))
    const isExample = CANARY_DIR.endsWith(join('eval', 'fixtures', 'canary-example'))
    expect(isReal || isExample).toBe(true)
    expect(CANARY_KIND).toBe(isReal ? 'real' : 'example')
    for (const date of listCanaryDates())
      expect(isValidEvalDate(date)).toBe(true)
  })
})

describe('resolveCanaryDir', () => {
  it('真目錄存在時回傳 real、dir 是 realDir', () => {
    const result = resolveCanaryDir({ realDir: '/fake/real', exampleDir: '/fake/example', exists: p => p === '/fake/real' })
    expect(result).toEqual({ dir: '/fake/real', kind: 'real' })
  })

  it('真目錄不存在時退版到 example', () => {
    const result = resolveCanaryDir({ realDir: '/fake/real', exampleDir: '/fake/example', exists: () => false })
    expect(result).toEqual({ dir: '/fake/example', kind: 'example' })
  })
})

describe('canaryExampleNotice', () => {
  it('example 時回非空警告字串', () => {
    expect(canaryExampleNotice('example')).toBeTruthy()
  })

  it('real 時回 null', () => {
    expect(canaryExampleNotice('real')).toBeNull()
  })
})

describe('canaryExampleBanner', () => {
  it('example 時回非空字串', () => {
    expect(canaryExampleBanner('example')).toBeTruthy()
  })

  it('real 時回 null', () => {
    expect(canaryExampleBanner('real')).toBeNull()
  })
})

describe('canaryDatePath', () => {
  it('組出單日 fixture 目錄', () => {
    expect(canaryDatePath('2026-08-13', dir)).toBe(resolve(dir, '2026-08-13'))
  })

  it('預設基底是 CANARY_DIR', () => {
    expect(canaryDatePath('2026-08-13')).toBe(resolve(CANARY_DIR, '2026-08-13'))
  })
})

describe('loadCanarySources', () => {
  it('讀出該日的 sources.json', () => {
    makeDate('2026-08-13', [{ id: 1, title: 't', url: 'https://e.com', publishedAt: '2026-08-13', contentText: 'x' }])
    const rows = loadCanarySources('2026-08-13', dir)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.url).toBe('https://e.com')
  })
})
