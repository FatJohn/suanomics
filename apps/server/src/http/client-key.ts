import type { Context } from 'hono'
import process from 'node:process'
import { getConnInfo } from '@hono/node-server/conninfo'

/**
 * 算出用來做限流分桶的「客戶端識別碼」。
 *
 * - `TRUST_PROXY=true` 時信任 `X-Forwarded-For`，取**最右邊**一段：這個 header
 *   最左邊的值可以由客戶端自己在請求裡任意填寫（偽造），只有緊鄰 server 的那一層
 *   反向代理附加上去的最後一段才可信。這個假設只在「前面剛好一層可信反向代理」
 *   的部署形狀下成立；多層代理或沒有在最外層把 `X-Forwarded-For` 清乾淨的鏈路，
 *   最右邊那段也可能是別人填的，不在這裡處理。
 * - 其餘情況看實際 TCP 連線來源（`getConnInfo`）。單元測試用 Hono 的
 *   `app.request()` 直接打 fetch handler、沒有真實 socket，`getConnInfo` 會
 *   丟出，接住後退化成 `'unknown'`——效果是限流退化成「所有這類請求共用一個
 *   key」，而不是讓整條中介層炸掉。
 */
export function clientKeyOf(c: Context, env: NodeJS.ProcessEnv = process.env): string {
  if (env.TRUST_PROXY === 'true') {
    const xff = c.req.header('x-forwarded-for')
    if (xff) {
      const segments = xff.split(',').map(s => s.trim()).filter(s => s.length > 0)
      const rightmost = segments[segments.length - 1]
      if (rightmost)
        return rightmost
    }
  }

  try {
    const info = getConnInfo(c)
    return info.remote.address ?? 'unknown'
  }
  catch {
    return 'unknown'
  }
}
