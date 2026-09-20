import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GEMINI_ONLY_PATHS } from './gemini-only-paths.js'
import { stripComments } from './strip-comments.js'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

// `git ls-files` 只跑一次、整份測試共用——這支要進 CI，不要每個 it() 各自重跑一次子行程。
const TRACKED_FILES: string[] = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean)

/**
 * 抓的是「真的 import `@google/genai`」的檔案，不是提到這個字串的檔案——
 * `apps/server/src/corpus/entity-summary-response-schema.ts` 的註解就提到它，
 * 但沒有 import，不該被抓到（下面有一條測試直接拿它當負向對照）。
 *
 * 排除 `*.test.ts`：測試檔 import SDK 是在鏡射它所測的模組（例如替 gemini-stt.ts
 * 寫測試會 mock `@google/genai`），那個模組本身已經在清單裡了；把測試也列進來只會讓
 * 「哪些路徑綁死 Gemini」這份清單被噪音淹沒，看不出真正的生產路徑有幾條。
 * 排除 `dist/`：建置產物，來源已經在清單裡，不需要重複列。
 */
const CANDIDATE_FILES = TRACKED_FILES.filter((f) => {
  if (!/\.(?:ts|tsx|vue)$/.test(f))
    return false
  if (f.endsWith('.test.ts'))
    return false
  if (f.includes('/dist/') || f.startsWith('dist/'))
    return false
  return true
})

const SDK_SPECIFIERS: readonly string[] = [`'@google/genai'`, `"@google/genai"`]

/**
 * 判準是**去掉註解之後，原始碼裡有沒有出現這個套件的 specifier 字串**。
 *
 * ★ **不要改回「逐行比對 `from '@google/genai'`」。** 那是第一版，漏掉三種寫法：
 *   ① 換行寫法 `import {\n  GoogleGenAI,\n} from '@google/genai'`——formatter 對長
 *      import 清單就會那樣排，而 `from …` 那一行沒有 `import` 字樣；
 *   ② side-effect import `import '@google/genai'`，根本沒有 `from`；
 *   ③ specifier 自己換到下一行 `from`⏎`  '@google/genai'`。
 *   2026-09-11 實測：①的情況下這支反過來報「已經找不到 import，這筆該刪掉」，方向正好
 *   相反；對既有條目會紅，但對**新增**的檔就是靜默漏掉，而那正是它要守的方向。
 *
 * ★ **誤報側是刻意 fail-closed 的，不要為了消除它而放寬。** 純字串字面值
 *   （`const note = "from '@google/genai'"`）會被算成命中，因為分辨字串與 import
 *   需要真的 parse。被誤叫時正確的處理是改那一行，或把該檔加進 allowlist 並寫清楚
 *   理由——不是把判準放寬到漏掉真的 import。相對地，**被註解掉的 import 不算**
 *   （行註解與區塊註解都先剝掉），那種誤叫沒有任何價值。
 */
function contentImportsGeminiSdk(content: string): boolean {
  const code = stripComments(content)
  return SDK_SPECIFIERS.some(spec => code.includes(spec))
}

function importsGeminiSdk(file: string): boolean {
  return contentImportsGeminiSdk(readFileSync(`${REPO_ROOT}${file}`, 'utf-8'))
}

const ACTUAL_GEMINI_FILES = CANDIDATE_FILES.filter(importsGeminiSdk).sort()
const ALLOWLIST_FILES = GEMINI_ONLY_PATHS.map(e => e.file).sort()

describe('gemini-only-paths：候選集合不是空的（負向對照）', () => {
  it('掃描到的候選檔案數量遠大於 allowlist 大小，避免掃描器壞掉時空轉出假綠燈', () => {
    expect(CANDIDATE_FILES.length).toBeGreaterThan(100)
  })
})

describe('gemini-only-paths：檢測器本身的正向／負向對照', () => {
  it('真的 import @google/genai 的檔案會被抓到', () => {
    expect(importsGeminiSdk('packages/prompt-research/src/gemini-client.ts')).toBe(true)
  })

  // 見 contentImportsGeminiSdk 的 ★ 註解。這幾條直接餵內容給真正的判定函式，不在測試裡
  // 複製一份它的邏輯——邏輯的副本通過，不代表被呼叫的那個函式是對的。
  it('換行寫法的 import 也抓得到（formatter 對長清單就會這樣排）', () => {
    expect(contentImportsGeminiSdk(`import {\n  GoogleGenAI,\n} from '@google/genai'\n`)).toBe(true)
  })

  it('side-effect import（沒有 from）也抓得到', () => {
    expect(contentImportsGeminiSdk(`import '@google/genai'\n`)).toBe(true)
  })

  it('specifier 自己換到下一行也抓得到', () => {
    expect(contentImportsGeminiSdk(`import { Type } from\n  '@google/genai'\n`)).toBe(true)
  })

  it('export ... from 也抓得到', () => {
    expect(contentImportsGeminiSdk(`export { Type } from '@google/genai'\n`)).toBe(true)
  })

  it('dynamic import 與 require 也抓得到', () => {
    expect(contentImportsGeminiSdk(`const g = await import('@google/genai')\n`)).toBe(true)
    expect(contentImportsGeminiSdk(`const g = require("@google/genai")\n`)).toBe(true)
  })

  it('行註解裡的 import 不算', () => {
    expect(contentImportsGeminiSdk(`// 歷史上這裡曾 import { X } from '@google/genai'\n`)).toBe(false)
  })

  // 這一條是 2026-09-11 驗收抓到的誤報：被註解掉的 import 不該讓閘門紅，訊息還叫人去改
  // allowlist。原本只排除以 // 或 * 開頭的行，區塊註解中間那幾行照樣命中。
  it('區塊註解裡的 import 不算', () => {
    expect(contentImportsGeminiSdk(`/*\nimport { Type } from '@google/genai'\n*/\n`)).toBe(false)
    expect(contentImportsGeminiSdk(`/**\n * 見 from '@google/genai' 的說明\n */\n`)).toBe(false)
  })

  // 刻意 fail-closed：分辨字串字面值與 import 需要真的 parse。釘住它是為了讓這個行為
  // 是決定而不是意外——被誤叫時要改那一行或加進 allowlist，不是放寬判準。
  it('字串字面值裡的套件名會被算成命中（刻意的 fail-closed）', () => {
    expect(contentImportsGeminiSdk(`const note = "from '@google/genai'"\n`)).toBe(true)
  })

  it('只在註解裡提到 @google/genai 字串、沒有 import 的檔案不會被誤抓', () => {
    const file = 'apps/server/src/corpus/entity-summary-response-schema.ts'
    expect(existsSync(`${REPO_ROOT}${file}`)).toBe(true)
    expect(importsGeminiSdk(file)).toBe(false)
  })
})

describe('gemini-only-paths：窮舉——實際 import 集合必須等於 allowlist', () => {
  it('沒有多、沒有少', () => {
    const extra = ACTUAL_GEMINI_FILES.filter(f => !ALLOWLIST_FILES.includes(f))
    const missing = ALLOWLIST_FILES.filter(f => !ACTUAL_GEMINI_FILES.includes(f))
    expect(
      extra,
      `這些檔案 import 了 @google/genai 但不在 allowlist 裡——有人新加了直接呼叫 Gemini SDK 的路徑，
還沒決定要不要標成 Gemini-only（決定後把它加進 apps/server/tools/ci/gemini-only-paths.ts）：\n${extra.join('\n')}`,
    ).toEqual([])
    expect(
      missing,
      `allowlist 裡這些檔案已經不再 import @google/genai 了——條目過期，該從
apps/server/tools/ci/gemini-only-paths.ts 刪掉：\n${missing.join('\n')}`,
    ).toEqual([])
  })
})

describe('gemini-only-paths：allowlist 每一筆都必須真的還命中得到', () => {
  it('每個 file 都存在於 git ls-files，且真的 import @google/genai', () => {
    const stale: string[] = []
    for (const entry of GEMINI_ONLY_PATHS) {
      if (!TRACKED_FILES.includes(entry.file)) {
        stale.push(`${entry.file} → 不在 git ls-files 裡`)
        continue
      }
      if (!importsGeminiSdk(entry.file))
        stale.push(`${entry.file} → 已經找不到 @google/genai 的 import，這筆該刪掉`)
    }
    expect(stale, stale.join('\n')).toEqual([])
  })

  it('每一筆都有非空的 reason（禁止無理由豁免）', () => {
    const missingReason = GEMINI_ONLY_PATHS.filter(e => e.reason.trim().length === 0)
    expect(missingReason).toEqual([])
  })
})
