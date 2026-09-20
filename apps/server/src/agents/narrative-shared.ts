// extracted from narrative-writer.ts so podcast-writer can reuse.
// Pure structural refactor — no behavior change.
import { NARRATIVE_SHARED_USER_TEXT } from '../prompts/narrative-shared.user-content.js'

// clampString 的正典實作已 DRY 收攏到 _truncate.ts（truncation 家族本家）；
// 此處 re-export 保留既有 importer 的 './narrative-shared.js' 路徑不變。
export { clampString } from './_truncate.js'

export type RetryReason
  = | 'zod-parse'
    | 'gemini-api'
    | 'timeout'
    | 'compliance-residual'
    | null

export function classifyError(err: unknown): RetryReason {
  const e = err as Error
  const msg = e?.message ?? String(err)
  if (e?.name === 'AbortError' || msg.toLowerCase().includes('timeout'))
    return 'timeout'
  if (
    e?.name === 'ZodError'
    || msg.includes('Required')
    || msg.includes('unknown citation url')
    || msg.includes('parsed narrative is null')
  ) {
    return 'zod-parse'
  }
  return 'gemini-api'
}

// 全 pipeline 共用 forbidden 重寫表（synth / analyzer / narrative / podcast、投信投顧法合規）
// 沿用 analyzer.ts SAFE_REWRITE_MAP 哲學、shared 化避免重複維護
// 資料本體（陣列內容與順序）已搬到 prompts/narrative-shared.user-content.ts、這裡只 re-export
// 同名常數、保留既有 importer（narrative-shared.test.ts 等）的路徑與名稱不變。
export const COMPLIANCE_REWRITE_MAP = NARRATIVE_SHARED_USER_TEXT.complianceRewriteMap

// 注意：每個 forbidden 命中最多 +1 (split/join 把所有 occurrences 一次替換、counter 只 +1)
// 跟 narrative-writer 既有行為一致、改 counter 邏輯會破現有 audit 數值
export function rewriteText(s: string, counter: { count: number }): string {
  let out = s
  for (const [from, to] of COMPLIANCE_REWRITE_MAP) {
    if (out.includes(from)) {
      out = out.split(from).join(to)
      counter.count++
    }
  }
  return out
}

// 移除 LLM 偶發夾帶的控制 / 非可印字元（mojibake 來源、6-16 podcast「壓力U+001A還是在那裡」）。
// 保留 \n(U+000A) \t(U+0009)；移除 C0 其餘(含 \r)、C1、DEL、U+FFFD、零寬/BiDi、BOM、未配對 surrogate。
// 不誤殺 CJK / 全形標點 / 合法 surrogate pair（emoji）。
export function stripControlChars(s: string): string {
  return s.replace(
    // eslint-disable-next-line no-control-regex -- 蓄意比對控制字元
    /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF\uFFFD]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  )
}
