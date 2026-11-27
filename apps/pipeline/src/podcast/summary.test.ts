import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { appendPodcastSummary, renderPodcastSummary } from './summary.js'

const DATE = '2026-11-27'
const LLM = { usd: 0.1444, calls: 1 }

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'podcast-summary-')), 's.md')
}

describe('renderPodcastSummary', () => {
  it('完成時列出 LLM 花費（USD）與 Azure 計費字元數', () => {
    const text = renderPodcastSummary({
      llm: LLM,
      result: { status: 'complete', date: DATE, url: 'https://a/b.mp3', segments: 7, billableChars: 4504, bytes: 10, reusedScript: false },
    })
    expect(text).toContain('## Podcast')
    expect(text).toContain(DATE)
    expect(text).toContain('$0.1444')
    expect(text).toContain('4504')
  })

  it('沿用舊稿時註明，LLM 花費照實寫', () => {
    const text = renderPodcastSummary({
      llm: { usd: 0, calls: 0 },
      result: { status: 'complete', date: DATE, url: 'u', segments: 7, billableChars: 4504, bytes: 10, reusedScript: true },
    })
    expect(text).toContain('沿用舊稿')
    expect(text).toContain('$0.0000')
  })

  it('略過時寫一行註明已略過與原因', () => {
    for (const [reason, label] of [['already-exists', '已有音檔'], ['no-brief', '沒有 complete 的 brief']] as const) {
      const text = renderPodcastSummary({ llm: { usd: 0, calls: 0 }, result: { status: 'skipped', reason, date: DATE } })
      expect(text).toContain('已略過')
      expect(text).toContain(label)
      expect(text).toContain(DATE)
    }
  })

  it('失敗時仍寫出日期與已花的 LLM 費用', () => {
    const text = renderPodcastSummary({ date: DATE, llm: LLM, result: undefined })
    expect(text).toContain('失敗')
    expect(text).toContain(DATE)
    expect(text).toContain('$0.1444')
  })

  it('tTS 已開始才失敗時寫出 Azure 計費字元', () => {
    const text = renderPodcastSummary({ date: DATE, llm: LLM, result: undefined, ttsChars: 4504 })
    expect(text).toContain('4504')
  })

  it('參數或設定錯誤時沒有日期與花費閘，仍寫失敗列', () => {
    const text = renderPodcastSummary({ llm: { usd: 0, calls: 0 }, result: undefined })
    expect(text).toContain('## Podcast')
    expect(text).toContain('失敗')
  })
})

describe('appendPodcastSummary', () => {
  it('附加到 summary 檔，不覆蓋前面步驟寫的內容', async () => {
    const path = tempPath()
    await appendPodcastSummary(path, 'first\n')
    await appendPodcastSummary(path, 'second\n')
    expect(readFileSync(path, 'utf8')).toBe('first\nsecond\n')
  })

  it('不在 Actions 裡（沒有路徑）就什麼都不做', async () => {
    await expect(appendPodcastSummary(undefined, 'x')).resolves.toBeUndefined()
  })

  it('寫檔失敗只 warn，不改 exit code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(appendPodcastSummary('/nonexistent/dir/s.md', 'x')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
