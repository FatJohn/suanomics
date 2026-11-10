import { APICallError } from 'ai'
import { z } from 'zod'
import { LlmAccountError } from './cost-gate.js'

const ACCOUNT_STATUS_CODES = new Set([401, 402, 403])
const ACCOUNT_ERROR_TYPES = new Set(['authentication_error', 'billing_error', 'permission_error'])
const SPEND_CAP_ERROR_CODE = 'enforced_spend_limit_reached'
// 官方文件：自設 spend limit 回 400，只能靠訊息開頭辨認。
const SPEND_LIMIT_MESSAGE = /^You have reached your specified (?:workspace )?API usage limits/
// 餘額耗盡的 400 訊息官方文件沒寫，是已知的回應內容，尚未實測。
const CREDIT_BALANCE_MESSAGE = /credit balance is too low/i

const ErrorData = z.object({
  error: z.object({
    type: z.string(),
    message: z.string(),
    details: z.object({ error_code: z.string().nullish() }).nullish(),
  }),
})

/** 分類依據：https://platform.claude.com/docs/en/api/errors 與 rate-limits。辨識不了的回 null，維持原本的重試與降級。 */
export function toLlmAccountError(error: unknown): LlmAccountError | null {
  if (!APICallError.isInstance(error))
    return null
  const parsed = ErrorData.safeParse(error.data)
  const detail = parsed.success ? parsed.data.error : undefined
  const isAccountError = (error.statusCode !== undefined && ACCOUNT_STATUS_CODES.has(error.statusCode))
    || (detail !== undefined && (
      ACCOUNT_ERROR_TYPES.has(detail.type)
      || detail.details?.error_code === SPEND_CAP_ERROR_CODE
      || SPEND_LIMIT_MESSAGE.test(detail.message)
      || CREDIT_BALANCE_MESSAGE.test(detail.message)
    ))
  if (!isAccountError)
    return null
  // 不帶 cause：APICallError 含完整 request body，會被 CLI 的錯誤輸出整包印出。
  return new LlmAccountError(`LLM 帳務或認證錯誤（HTTP ${error.statusCode ?? '未知'} ${detail?.type ?? ''}）：${detail?.message ?? error.message}`)
}
