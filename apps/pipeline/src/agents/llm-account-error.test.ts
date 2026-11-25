import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'
import { LlmAccountError } from './cost-gate.js'
import { toLlmAccountError } from './llm-account-error.js'

function err(statusCode: number | undefined, data?: unknown): APICallError {
  return new APICallError({ message: 'boom', url: 'https://example.test', requestBodyValues: {}, ...(statusCode !== undefined ? { statusCode } : {}), data })
}
function body(type: string, message: string, details?: unknown): unknown {
  return { type: 'error', error: { type, message, ...(details !== undefined ? { details } : {}) } }
}

describe('toLlmAccountError', () => {
  it.each([
    ['401 認證', err(401, body('authentication_error', 'invalid x-api-key'))],
    ['402 帳務', err(402, body('billing_error', 'payment'))],
    ['403 權限', err(403, body('permission_error', 'no access'))],
    ['tier spend cap 429', err(429, body('rate_limit_error', 'You have reached your API usage limits', { error_code: 'enforced_spend_limit_reached' }))],
    ['自設 spend limit 400', err(400, body('invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-12-01'))],
    ['workspace spend limit 400', err(400, body('invalid_request_error', 'You have reached your specified workspace API usage limits.'))],
    ['餘額不足 400', err(400, body('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'))],
    ['狀態碼缺失但型別是 billing', err(undefined, body('billing_error', 'x'))],
    ['回應不是 JSON 的 401', err(401)],
    ['回應不是 JSON 的 402', err(402)],
    ['回應不是 JSON 的 403', err(403)],
  ])('%s 判為帳務錯誤', (_label, e) => {
    expect(toLlmAccountError(e)).toBeInstanceOf(LlmAccountError)
  })

  it.each([
    ['一般 429', err(429, body('rate_limit_error', 'Number of requests has exceeded your per-minute rate limit'))],
    ['500', err(500, body('api_error', 'Internal'))],
    ['529', err(529, body('overloaded_error', 'Overloaded'))],
    ['內容問題的 400', err(400, body('invalid_request_error', 'max_tokens: too large'))],
    ['訊息中段提到 usage limits 的 400', err(400, body('invalid_request_error', 'prompt says You have reached your specified API usage limits'))],
    ['沒有 data 的 400', err(400)],
    ['data 形狀不符的 400', err(400, 'not json')],
    ['非 APICallError', new Error('credit balance is too low')],
    ['字串', 'x'],
  ])('%s 維持原行為', (_label, e) => {
    expect(toLlmAccountError(e)).toBeNull()
  })

  it('錯誤訊息帶狀態與 API 訊息，不帶 request body', () => {
    const result = toLlmAccountError(err(402, body('billing_error', 'pay up')))
    expect(result?.message).toContain('402')
    expect(result?.message).toContain('pay up')
    expect(result?.cause).toBeUndefined()
  })
})
