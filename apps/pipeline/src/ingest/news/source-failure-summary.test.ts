import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendSourceFailureSummary, describeSourceError, renderSourceFailureSummary } from './source-failure-summary.js'

function row(slug: string, failed: boolean, error: string | null = null) {
  return { slug, failed, error }
}

describe('renderSourceFailureSummary', () => {
  it('列出當天失敗的來源與錯誤', () => {
    const out = renderSourceFailureSummary([
      row('cna', false),
      row('fed-press', true, 'RSS https://www.federalreserve.gov/feeds/press_all.xml HTTP 404'),
    ])
    expect(out).toContain('## 新聞來源失敗')
    expect(out).toContain('| fed-press | RSS https://www.federalreserve.gov/feeds/press_all.xml HTTP 404 |')
    expect(out).not.toContain('cna')
  })

  it('沒有來源失敗時回空字串，不誤報', () => {
    expect(renderSourceFailureSummary([row('cna', false), row('fed-press', false)])).toBe('')
    expect(renderSourceFailureSummary([])).toBe('')
  })

  it('錯誤訊息裡的直線與換行不弄壞表格', () => {
    const out = renderSourceFailureSummary([row('x', true, 'a | b\nc')])
    expect(out).toContain('| x | a \\| b c |')
  })

  it('沒有錯誤訊息時標成未知', () => {
    expect(renderSourceFailureSummary([row('x', true)])).toContain('| x | 未知錯誤 |')
    expect(renderSourceFailureSummary([row('x', true, '')])).toContain('| x | 未知錯誤 |')
  })

  it('反斜線、CR 與角括號不弄壞表格', () => {
    const out = renderSourceFailureSummary([row('x', true, 'a\\|b\r<html>')])
    expect(out).toContain('| x | a\\\\\\|b &lt;html&gt; |')
  })
})

describe('appendSourceFailureSummary', () => {
  it('有失敗才寫入 summary 檔', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'src-fail-'))
    const ok = join(dir, 'ok.md')
    await appendSourceFailureSummary(ok, [row('cna', false)])
    expect(existsSync(ok)).toBe(false)

    const bad = join(dir, 'bad.md')
    await appendSourceFailureSummary(bad, [row('fed-press', true, 'HTTP 404')])
    expect(readFileSync(bad, 'utf8')).toContain('| fed-press | HTTP 404 |')
    rmSync(dir, { recursive: true })
  })

  it('不在 Actions 裡就什麼都不做', async () => {
    await expect(appendSourceFailureSummary(undefined, [row('x', true, 'e')])).resolves.toBeUndefined()
  })

  it('寫檔失敗只 warn，不讓 run 失敗', async () => {
    await expect(appendSourceFailureSummary('/nonexistent/dir/s.md', [row('x', true, 'e')])).resolves.toBeUndefined()
  })
})

describe('describeSourceError', () => {
  it('包裝過的錯誤（drizzle 的 Failed query、fetch failed）取底層原因，不帶 SQL 與參數', () => {
    const cause = new Error('duplicate key value violates unique constraint "news_items_pkey"')
    const wrapped = new Error('Failed query: insert into "news_items" values ($1)\nparams: 很長的標題', { cause })
    expect(describeSourceError(wrapped)).toBe('Failed query: insert into "news_items" values ($1)（duplicate key value violates unique constraint "news_items_pkey"）')
    expect(describeSourceError(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND x.example') }))).toBe('fetch failed（getaddrinfo ENOTFOUND x.example）')
  })

  it('只取第一行並限制長度', () => {
    expect(describeSourceError(new Error('RSS https://a.example HTTP 404'))).toBe('RSS https://a.example HTTP 404')
    const long = describeSourceError(new Error(`${'x'.repeat(1000)}\nsecond`))
    expect(long.length).toBeLessThanOrEqual(300)
    expect(long).not.toContain('second')
  })

  it('不是 Error 的值也轉成字串', () => {
    expect(describeSourceError('boom')).toBe('boom')
  })
})
