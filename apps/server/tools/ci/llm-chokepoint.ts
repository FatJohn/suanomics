import { stripComments } from './strip-comments.js'

// `warnLlmConcurrencyBudgetOnce()`（fanout-concurrency.ts）只掛在
// `callAgentLLM`（llm-wrapper.ts）裡，前提是「所有真的會打 provider 的呼叫路徑都經過
// callAgentLLM」。這支守門測試窮舉「誰直接 import 三個 provider adapter
// （providers/{gemini,anthropic,openai}.ts）」，確保這份前提不會在有人開一條新路徑時
// 悄悄破掉而沒人發現——新增的 importer 沒被登記在下面的清單就會紅。
//
// 只掃三個 adapter 本身、不掃 `@google/genai` 之類的 SDK：那是 gemini-only-paths.ts 的
// 職責（它管的是「誰直接綁死 Gemini SDK」，這裡管的是「誰繞過 callAgentLLM 直接呼叫
// provider adapter」，兩份清單問的問題不同、允許重疊）。
export interface LlmChokepointEntry {
  file: string
  reason: string
}

export const LLM_CHOKEPOINT_IMPORTERS: LlmChokepointEntry[] = [
  {
    file: 'apps/server/src/agents/llm-wrapper.ts',
    reason: 'callAgentLLM 本體——所有經過它的呼叫都會先印一次並行預算警告，是這道防線唯一該存在的掛點',
  },
]

// ── import 語境偵測（不是「提到這個字串」）──
//
// 2026-09-14 複查抓到：第一版判準是「剝掉註解後的原始碼裡有沒有出現這個路徑的
// 子字串」，會誤把純文字提及（例如一句話註解或字串字面值寫著 `providers/gemini.ts`）
// 當成真的 import，也會漏掉反引號動態 import（``import(`./providers/gemini.js`)``，
// 反引號不在原本的字元類別裡）。這裡改成只認四種真正的 import 語境：
//   ① 靜態 `import ... from '<spec>'`
//   ② side-effect `import '<spec>'`（沒有 from）
//   ③ `export ... from '<spec>'`
//   ④ 動態 `import('<spec>')`
// 三種引號（`'`、`"`、反引號）都支援，`from`／`import(` 與 specifier 之間允許任意空白
// （含換行），所以 formatter 排開的多行 import 清單、或 specifier 自己換到下一行都抓得到。
//
// ★ 與 gemini-only-paths.ts 的字串子字串比對**刻意不同**、不能共用同一個判準函式：
// 那邊要抓的是「有沒有提到 SDK 名字」，對字串字面值 fail-closed 是它的設計決策；這裡要
// 抓的是「有沒有真的 import」，字串字面值不該算數。兩邊唯一共通的步驟只有剝註解
// （見 strip-comments.ts），specifier 判準各自獨立。
//
// 已知取捨：`from\s*(quote)` 只認「from」後面直接接引號，不驗證前面真的有 import/export
// 關鍵字（`\bfrom\b` 已足以在這個 repo 的程式碼慣例裡消歧義——一般敘述文字裡的英文
// "from" 後面接的不會剛好是引號）；也不解析 `require(...)`——這個 repo 全是 ESM，不需要。
const FROM_IMPORT_RE = /\bfrom\s*(['"`])([^'"`]+)\1/g
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*(['"`])([^'"`]+)\1/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"`])([^'"`]+)\1/g

/** 抓出「去除註解後的原始碼」裡所有 import／export 語境提到的 specifier 字串。 */
export function importedSpecifiers(content: string): string[] {
  const code = stripComments(content)
  const specs: string[] = []
  for (const re of [FROM_IMPORT_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    for (const m of code.matchAll(re)) {
      const spec = m[2]
      if (spec !== undefined)
        specs.push(spec)
    }
  }
  return specs
}

/** 判斷「去除註解後的原始碼」是否真的 import 了符合 `matchesSpecifier` 的模組。 */
export function importsMatchingSpecifier(content: string, matchesSpecifier: (specifier: string) => boolean): boolean {
  return importedSpecifiers(content).some(matchesSpecifier)
}

/** 三個 provider adapter 的 specifier 判準——不管呼叫端用幾層相對路徑，只認路徑尾端這一段。 */
const PROVIDER_ADAPTER_SPECIFIER_RE = /providers\/(?:gemini|anthropic|openai)(?:\.[jt]s)?$/

export function importsProviderAdapter(content: string): boolean {
  return importsMatchingSpecifier(content, spec => PROVIDER_ADAPTER_SPECIFIER_RE.test(spec))
}
