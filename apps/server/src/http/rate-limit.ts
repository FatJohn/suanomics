export interface RateLimitCheckResult {
  allowed: boolean
  // 到目前視窗結束為止還剩幾秒（無條件進位、至少 1）。allowed 為 true 時這個值
  // 沒有實際用途，但仍照同一公式算，呼叫端不必為兩種情況各寫一套邏輯。
  // 唯一的例外是這一層被停用（limit <= 0）：沒有視窗可言，固定回 0。
  retryAfterSec: number
}

export interface RateLimiter {
  check: (key: string) => RateLimitCheckResult
}

interface FixedWindowLimiterOptions {
  limit: number
  windowMs: number
  now?: () => number
  maxKeys?: number
}

interface WindowState {
  count: number
  windowEndsAt: number
}

const DEFAULT_MAX_KEYS = 10_000

/**
 * In-memory fixed-window 限流器。
 *
 * 為什麼是 in-memory、不是跨 instance 共享儲存：這個 repo 的部署硬要求就是單一
 * server instance（見 docs/operations/deploy.md「這個架構要知道的三件事」），
 * background job 佇列本來就已經只活在 process 記憶體裡，限流跟著用同一個取捨
 * 不會多引入一個新的一致性假設。重啟即歸零是已知代價，不是漏洞。
 *
 * `limit <= 0` 代表停用這一層：呼叫端不必為「這一層開／關」另外寫分支，
 * 一律呼叫 `check()`，停用時它永遠放行。
 */
export function createFixedWindowLimiter(opts: FixedWindowLimiterOptions): RateLimiter {
  const { limit, windowMs, now = () => Date.now(), maxKeys = DEFAULT_MAX_KEYS } = opts
  const windows = new Map<string, WindowState>()

  // 清掉視窗已經結束的 key——避免長時間跑下來，記憶體被早就不會再被查詢的
  // 舊 key 佔住。
  function evictExpired(currentTime: number): void {
    for (const [k, state] of windows) {
      if (state.windowEndsAt <= currentTime)
        windows.delete(k)
    }
  }

  // Map 保留插入順序，第一個 key 就是最舊插入的那個。
  function evictOldest(): void {
    const oldestKey = windows.keys().next().value
    if (oldestKey !== undefined)
      windows.delete(oldestKey)
  }

  return {
    check(key: string): RateLimitCheckResult {
      if (limit <= 0)
        return { allowed: true, retryAfterSec: 0 }

      const currentTime = now()
      const existing = windows.get(key)

      let state: WindowState
      if (existing && existing.windowEndsAt > currentTime) {
        state = existing
      }
      else {
        // 只有「這個 key 目前不在 map 裡」才會讓 map 變大；既有 key 的視窗過期後
        // 重開一個新視窗不算新增，不需要為它去清別人的位置。
        if (!windows.has(key) && windows.size >= maxKeys) {
          evictExpired(currentTime)
          if (windows.size >= maxKeys)
            evictOldest()
        }
        state = { count: 0, windowEndsAt: currentTime + windowMs }
        windows.set(key, state)
      }

      state.count += 1
      const retryAfterSec = Math.max(1, Math.ceil((state.windowEndsAt - currentTime) / 1000))
      return { allowed: state.count <= limit, retryAfterSec }
    },
  }
}
