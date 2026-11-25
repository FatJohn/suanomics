import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendSourceFailureSummary, renderSourceFailureSummary } from './source-failure-summary.js'

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
  })

  it('不在 Actions 裡就什麼都不做', async () => {
    await expect(appendSourceFailureSummary(undefined, [row('x', true, 'e')])).resolves.toBeUndefined()
  })

  it('寫檔失敗只 warn，不讓 run 失敗', async () => {
    await expect(appendSourceFailureSummary('/nonexistent/dir/s.md', [row('x', true, 'e')])).resolves.toBeUndefined()
  })
})
