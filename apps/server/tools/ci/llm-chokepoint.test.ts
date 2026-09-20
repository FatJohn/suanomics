import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importsProviderAdapter, LLM_CHOKEPOINT_IMPORTERS } from './llm-chokepoint.js'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

// `git ls-files` 只跑一次、整份測試共用——這支要進 CI，不要每個 it() 各自重跑一次子行程。
const TRACKED_FILES: string[] = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean)

// 排除 `*.test.ts`：測試檔 mock provider adapter 是在鏡射它所測的模組，不是新開一條
// 生產路徑；把測試也列進來只會讓「誰真的繞過 callAgentLLM」這份清單被噪音淹沒。
const CANDIDATE_FILES = TRACKED_FILES.filter((f) => {
  if (!/\.(?:ts|tsx|vue)$/.test(f))
    return false
  if (f.endsWith('.test.ts'))
    return false
  if (f.includes('/dist/') || f.startsWith('dist/'))
    return false
  return true
})

/** 讀檔＋排除 adapter 自己（它是被 import 的那一端，不是繞過 callAgentLLM 的呼叫端）。 */
function fileImportsProviderAdapter(file: string): boolean {
  if (/providers\/(?:gemini|anthropic|openai)\.ts$/.test(file))
    return false
  return importsProviderAdapter(readFileSync(`${REPO_ROOT}${file}`, 'utf-8'))
}

const ACTUAL_IMPORTERS = CANDIDATE_FILES.filter(fileImportsProviderAdapter).sort()
const ALLOWLIST_FILES = LLM_CHOKEPOINT_IMPORTERS.map(e => e.file).sort()

describe('llm-chokepoint：候選集合不是空的（負向對照）', () => {
  it('掃描到的候選檔案數量遠大於 allowlist 大小，避免掃描器壞掉時空轉出假綠燈', () => {
    expect(CANDIDATE_FILES.length).toBeGreaterThan(100)
  })
})

describe('llm-chokepoint：偵測器本身的正向／負向對照', () => {
  it('真的 import provider adapter 的檔案會被抓到（llm-wrapper.ts 本體，避免空轉）', () => {
    expect(fileImportsProviderAdapter('apps/server/src/agents/llm-wrapper.ts')).toBe(true)
  })

  it('正例：靜態 import ... from 三個 provider 名稱、.js 副檔名、多層相對路徑都抓得到', () => {
    expect(importsProviderAdapter(`import { callGemini } from './providers/gemini.js'\n`)).toBe(true)
    expect(importsProviderAdapter(`import { callAnthropic } from '../../src/agents/providers/anthropic.js'\n`)).toBe(true)
    expect(importsProviderAdapter(`import { callOpenAI } from './providers/openai.js'\n`)).toBe(true)
  })

  it('換行寫法、side-effect import、export...from 都抓得到', () => {
    expect(importsProviderAdapter(`import {\n  callGemini,\n} from './providers/gemini.js'\n`)).toBe(true)
    expect(importsProviderAdapter(`import './providers/gemini.js'\n`)).toBe(true)
    expect(importsProviderAdapter(`export { callGemini } from './providers/gemini.js'\n`)).toBe(true)
  })

  // 2026-09-14 複查抓到的漏報：反引號動態 import 沒被舊版（字元類別不含反引號）抓到。
  it('反例（漏報）：反引號動態 import 也要抓到', () => {
    expect(importsProviderAdapter('const p = import(`../../src/agents/providers/gemini.js`)\n')).toBe(true)
  })

  it('動態 import 用單引號／雙引號也抓得到', () => {
    expect(importsProviderAdapter(`const p = import('./providers/gemini.js')\n`)).toBe(true)
    expect(importsProviderAdapter(`const p = import("./providers/anthropic.js")\n`)).toBe(true)
  })

  it('行註解與區塊註解裡的 import 不算', () => {
    expect(importsProviderAdapter(`// import { x } from './providers/gemini.js'\n`)).toBe(false)
    expect(importsProviderAdapter(`/*\nimport { x } from './providers/gemini.js'\n*/\n`)).toBe(false)
  })

  // 2026-09-14 複查抓到的誤報：舊版判準是「剝註解後的原始碼裡有沒有出現這段路徑
  // 子字串」，字串字面值提到路徑也會誤判成 import。
  it('反例（誤報）：字串字面值提到路徑不算 import', () => {
    expect(importsProviderAdapter(`export const DOC_NOTE = 'see providers/gemini.ts'\n`)).toBe(false)
  })

  it('provider adapter 自己不算命中（它是被 import 的那一端，不是繞過 callAgentLLM 的呼叫端）', () => {
    expect(fileImportsProviderAdapter('apps/server/src/agents/providers/gemini.ts')).toBe(false)
  })

  it('不相關的 providers/* 檔（resolve.js／pricing.js）不會被誤抓', () => {
    expect(importsProviderAdapter(`import { resolveAgentModel } from './providers/resolve.js'\n`)).toBe(false)
    expect(importsProviderAdapter(`import { computeCost } from './providers/pricing.js'\n`)).toBe(false)
  })
})

describe('llm-chokepoint：窮舉——實際 importer 集合必須等於 allowlist', () => {
  it('沒有多、沒有少', () => {
    const extra = ACTUAL_IMPORTERS.filter(f => !ALLOWLIST_FILES.includes(f))
    const missing = ALLOWLIST_FILES.filter(f => !ACTUAL_IMPORTERS.includes(f))
    expect(
      extra,
      `這些檔案直接 import 了 provider adapter、繞過 callAgentLLM——新路徑不會印並行預算警告，
確認是否刻意（例如 model-ab --probe 直接打 SDK）後把它加進
apps/server/tools/ci/llm-chokepoint.ts 並寫明原因：\n${extra.join('\n')}`,
    ).toEqual([])
    expect(
      missing,
      `allowlist 裡這些檔案已經不再 import provider adapter 了——條目過期，該從
apps/server/tools/ci/llm-chokepoint.ts 刪掉：\n${missing.join('\n')}`,
    ).toEqual([])
  })
})

describe('llm-chokepoint：allowlist 每一筆都必須真的還命中得到', () => {
  it('每個 file 都存在於 git ls-files，且真的 import provider adapter', () => {
    const stale: string[] = []
    for (const entry of LLM_CHOKEPOINT_IMPORTERS) {
      if (!TRACKED_FILES.includes(entry.file)) {
        stale.push(`${entry.file} → 不在 git ls-files 裡`)
        continue
      }
      if (!fileImportsProviderAdapter(entry.file))
        stale.push(`${entry.file} → 已經找不到 provider adapter 的 import，這筆該刪掉`)
    }
    expect(stale, stale.join('\n')).toEqual([])
  })

  it('每一筆都有非空的 reason（禁止無理由豁免）', () => {
    const missingReason = LLM_CHOKEPOINT_IMPORTERS.filter(e => e.reason.trim().length === 0)
    expect(missingReason).toEqual([])
  })

  it('每個 file 路徑在 repo 裡真的存在（防止改名/搬移後條目過期）', () => {
    const missing = LLM_CHOKEPOINT_IMPORTERS.filter(e => !existsSync(`${REPO_ROOT}${e.file}`))
    expect(missing.map(e => e.file)).toEqual([])
  })
})
