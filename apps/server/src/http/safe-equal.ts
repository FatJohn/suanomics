import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * 以 constant-time 方式比較兩個字串，用於比對 secret／token 這類值。
 *
 * 直接用 `a === b` 或逐字元比對時，字串比較會在第一個不同字元就提前結束，
 * 執行時間會隨「猜對的前綴長度」變化，理論上可被計時攻擊拿來一個字元一個字元
 * 反推出正確值。`node:crypto` 的 `timingSafeEqual` 能做到不提前結束，但它要求
 * 兩個 buffer 等長、長度不同就直接 throw；而且如果直接餵原始字串，兩個字串的
 * 長度差異本身就是一種可觀測的側信道（間接洩漏 secret 的長度）。
 *
 * 所以這裡先把兩邊各自雜湊成固定長度的 SHA-256 digest 再比較：雜湊後兩邊一定
 * 等長（不會 throw），而且無論輸入多長，比較耗時都一樣，長度資訊也不會外洩。
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB)
}
