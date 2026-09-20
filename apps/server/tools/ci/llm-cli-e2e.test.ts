import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SERVER_DIR = `${REPO_ROOT}apps/server`
const TSX_BIN = `${SERVER_DIR}/node_modules/.bin/tsx`
const SCRIPT = `${SERVER_DIR}/tools/cli/viewpoints-smoke.ts`
const FIXTURE = `${SERVER_DIR}/tools/eval/fixtures/canary-example/2026-03-03/brief.json`

/**
 * 用 viewpoints-smoke.ts 當閘門的真子行程 e2e：估 100 runs × 2 臂 × 3 = 600 次，
 * 遠超 500 次門檻。選它是因為在閘門之前**不連 DB、不需要 GEMINI_API_KEY 就能跑到
 * 閘門那一行**（讀本機 fixture JSON、直接呼叫 runViewpointsDebate）——其餘五支批次
 * 腳本閘門前都會先 requireGeminiKeyOrExit 或連 DB，子行程裡沒有真的 key／DB 會在
 * 閘門之前就已經退出，測不到「閘門本身擋下來」這件事。
 *
 * env 從零組（只給 PATH／HOME）、不 spread process.env：CI 的 GEMINI_API_KEY=test-key
 * 若被繼承，閘門之後的 runViewpointsDebate 會真的嘗試打 Gemini（stub key 換得到
 * DNS／HTTP 失敗，仍是零合法呼叫，但會拖慢／不確定；反正閘門本來就該在它之前擋下）。
 */
function runViewpointsSmoke(extraArgs: readonly string[]): { status: number | null, stdout: string, stderr: string } {
  try {
    const stdout = execFileSync(TSX_BIN, [SCRIPT, FIXTURE, '100', ...extraArgs], {
      cwd: SERVER_DIR,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
      timeout: 30_000,
    })
    return { status: 0, stdout, stderr: '' }
  }
  catch (err) {
    const e = err as { status: number | null, stdout?: string, stderr?: string }
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe('llm-cli-e2e：viewpoints-smoke.ts 的批次預算閘門（真子行程，零 LLM 請求）', () => {
  it('超過門檻且沒有 --yes → exit(3)、明細在 stderr、stdout 不含明細（不拖慢 45 分鐘才發現）', () => {
    const { status, stdout, stderr } = runViewpointsSmoke([])
    expect(status).toBe(3)
    expect(stderr).toContain('[llm-run-budget] viewpoints-smoke')
    expect(stderr).toContain('超出門檻')
    expect(stderr).toContain('--yes')
    expect(stdout).not.toContain('[llm-run-budget]')
  }, 30_000)
})
