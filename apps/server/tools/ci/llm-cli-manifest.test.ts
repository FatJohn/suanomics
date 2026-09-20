import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LLM_CLI_MANIFEST } from './llm-cli-manifest.js'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

const TRACKED_FILES: string[] = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean)

// `tools/cli/*.{ts,mts}`，排除測試檔與 `lib/`（那是共用 helper、不是 CLI 入口）。
const CLI_ENTRY_FILES = TRACKED_FILES.filter((f) => {
  if (!f.startsWith('apps/server/tools/cli/'))
    return false
  if (!/\.(?:ts|mts)$/.test(f))
    return false
  if (f.endsWith('.test.ts'))
    return false
  if (f.startsWith('apps/server/tools/cli/lib/'))
    return false
  return true
})

/** 剝掉區塊註解與行註解（做法與取捨同 gemini-only-paths.ts / llm-chokepoint.ts）。 */
function stripComments(content: string): string {
  const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//')
      return i < 0 ? line : line.slice(0, i)
    })
    .join('\n')
}

function fileContent(file: string): string {
  return readFileSync(`${REPO_ROOT}${file}`, 'utf-8')
}

function callsEnforceLlmRunBudget(file: string): boolean {
  return stripComments(fileContent(file)).includes('enforceLlmRunBudget(')
}

const VALID_SHAPES = ['batch', 'single', 'no-llm']
const PRIVATE_DECLARATION_RE = /\/\/\s*llm-cli-manifest:\s*private\s+(\S+)/

/**
 * 不進版控的 CLI 不列在 LLM_CLI_MANIFEST（見 llm-cli-manifest.ts 檔頭說明），
 * 改在自己的檔頭用 `// llm-cli-manifest: private <shape>` 自我宣告，只掃前 20 行——
 * 要求宣告真的在「檔頭」，不是隨便塞在檔案某處都算數。
 *
 * 回傳原始字串（不驗證是否為合法 LlmCliShape）：合法性檢查交給呼叫端，這樣「宣告存在
 * 但 shape 打錯字」跟「完全沒有宣告」是兩種不同的失敗訊息，不會被這支函式吃掉差異。
 */
function findPrivateDeclaration(file: string): { shape: string } | null {
  const head = fileContent(file).split('\n').slice(0, 20).join('\n')
  const m = PRIVATE_DECLARATION_RE.exec(head)
  return m ? { shape: m[1] ?? '' } : null
}

const MANIFEST_FILES = LLM_CLI_MANIFEST.map(e => e.file).sort()

describe('llm-cli-manifest：候選集合不是空的（負向對照）', () => {
  it('掃描到的 CLI 入口數量遠大於 0，避免掃描器壞掉時空轉出假綠燈', () => {
    expect(CLI_ENTRY_FILES.length).toBeGreaterThan(20)
  })
})

describe('llm-cli-manifest：窮舉——tools/cli/ 每個入口都必須「登記在中央清單」或「檔頭有合法 private 宣告」恰好一種', () => {
  it('沒有多、沒有少、宣告也沒打錯字', () => {
    const stale = MANIFEST_FILES.filter(f => !CLI_ENTRY_FILES.includes(f))
    const violations: string[] = []
    for (const file of CLI_ENTRY_FILES) {
      const inManifest = MANIFEST_FILES.includes(file)
      const decl = findPrivateDeclaration(file)
      if (decl && !VALID_SHAPES.includes(decl.shape)) {
        violations.push(`${file}：檔頭的 private 宣告 shape 不合法（收到 "${decl.shape}"，須為 ${VALID_SHAPES.join('|')} 之一）`)
        continue
      }
      const hasValidDeclaration = decl !== null
      if (inManifest && hasValidDeclaration) {
        violations.push(`${file}：同時登記在 llm-cli-manifest.ts 又有檔頭 private 宣告，只能擇一（這支到底公不公開？）`)
        continue
      }
      if (!inManifest && !hasValidDeclaration)
        violations.push(`${file}：既沒有登記在 llm-cli-manifest.ts，檔頭也沒有合法的 private 宣告`)
    }
    expect(
      violations,
      `新增／修改 CLI 時要嘛在 llm-cli-manifest.ts 分類 shape 並決定 gated（公開檔），要嘛在檔頭寫
\`// llm-cli-manifest: private <shape>\`（不公開檔）：\n${violations.join('\n')}`,
    ).toEqual([])
    expect(
      stale,
      `llm-cli-manifest.ts 裡這些條目指向已經不存在（或已改名）的檔案，該刪掉或更新：\n${stale.join('\n')}`,
    ).toEqual([])
  })

  it('每個檔案在 manifest 裡只出現一次（防止複製貼上重複登記）', () => {
    const counts = new Map<string, number>()
    for (const f of MANIFEST_FILES) counts.set(f, (counts.get(f) ?? 0) + 1)
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([f]) => f)
    expect(duplicates).toEqual([])
  })
})

describe('llm-cli-manifest：檔頭 private 宣告的 gated 一致性（跟中央清單套同一條規則）', () => {
  it('private batch 必須真的呼叫 enforceLlmRunBudget(；private single/no-llm 不可以', () => {
    const violations: string[] = []
    for (const file of CLI_ENTRY_FILES) {
      if (MANIFEST_FILES.includes(file))
        continue // 中央清單那條已由上面「gated 欄位必須反映檔案內容」核對過
      const decl = findPrivateDeclaration(file)
      if (!decl || !VALID_SHAPES.includes(decl.shape))
        continue // 宣告缺失／格式錯誤由上一個 it() 抓，這裡不重複噪音
      const actuallyGated = callsEnforceLlmRunBudget(file)
      if (decl.shape === 'batch' && !actuallyGated)
        violations.push(`${file}：private 宣告 shape=batch，但沒有呼叫 enforceLlmRunBudget(`)
      if (decl.shape !== 'batch' && actuallyGated)
        violations.push(`${file}：private 宣告 shape=${decl.shape}，卻呼叫了 enforceLlmRunBudget(`)
    }
    expect(violations, violations.join('\n')).toEqual([])
  })
})

describe('llm-cli-manifest：gated 欄位必須反映檔案內容（不是手動宣告就算數）', () => {
  it('gated === true 若且唯若檔案真的呼叫 enforceLlmRunBudget(（雙向：漏接或誤標都會紅）', () => {
    const mismatched: string[] = []
    for (const entry of LLM_CLI_MANIFEST) {
      if (!existsSync(`${REPO_ROOT}${entry.file}`))
        continue // 已由上面「不能登記不存在的檔」那條 catch，這裡跳過避免重複噪音
      const actuallyGated = callsEnforceLlmRunBudget(entry.file)
      if (actuallyGated !== entry.gated)
        mismatched.push(`${entry.file}：manifest 標 gated=${entry.gated}，實際${actuallyGated ? '有' : '沒有'}呼叫 enforceLlmRunBudget(`)
    }
    expect(mismatched, mismatched.join('\n')).toEqual([])
  })
})

describe('llm-cli-manifest：分類一致性規則', () => {
  it('shape === "batch" 且 gated === false 時，reason 不可為空（拔掉閘門卻沒寫理由會紅）', () => {
    const violations = LLM_CLI_MANIFEST
      .filter(e => e.shape === 'batch' && !e.gated && e.reason.trim().length === 0)
      .map(e => e.file)
    expect(violations).toEqual([])
  })

  it('shape !== "batch" 不可為 gated（把閘門加到 single/no-llm 腳本會紅）', () => {
    const violations = LLM_CLI_MANIFEST
      .filter(e => e.shape !== 'batch' && e.gated)
      .map(e => e.file)
    expect(violations).toEqual([])
  })

  it('每一筆都有非空 reason（禁止無理由分類）', () => {
    const missingReason = LLM_CLI_MANIFEST.filter(e => e.reason.trim().length === 0).map(e => e.file)
    expect(missingReason).toEqual([])
  })
})

describe('llm-cli-manifest：核定的批次腳本確實 gated=true（防止之後被靜默拔掉）', () => {
  it.each([
    'apps/server/tools/cli/brief-rerun.ts',
    'apps/server/tools/cli/brief-canary.ts',
    'apps/server/tools/cli/model-ab.ts',
    'apps/server/tools/cli/narrative-ledger-ab.ts',
    'apps/server/tools/cli/claim-yield-smoke.ts',
    'apps/server/tools/cli/viewpoints-smoke.ts',
    'apps/server/tools/cli/news-backfill-tags.ts',
    'apps/server/tools/cli/prompt-research-distill.ts',
  ])('%s：shape=batch、gated=true', (file) => {
    const entry = LLM_CLI_MANIFEST.find(e => e.file === file)
    expect(entry?.shape).toBe('batch')
    expect(entry?.gated).toBe(true)
  })
})
