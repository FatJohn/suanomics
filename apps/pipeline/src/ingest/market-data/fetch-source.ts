/** 四個資料源 client 的共用逾時上限。個別 client 仍可用 `timeoutMs` 覆寫。 */
export const SOURCE_TIMEOUT_MS = 15_000

export interface FetchSourceOptions<T> {
  /**
   * 錯誤訊息前綴，格式是 `<client>: <識別碼>`（例：`fred-client: DFII10`）。
   * 一次 refresh 會把四個源的失敗混在同一份報告裡，沒有這個前綴就分不出誰倒了。
   */
  label: string
  timeoutMs?: number
  /** 原樣交給 fetch；`signal` 由本函式補上，傳進來的會被覆蓋。 */
  init?: RequestInit
  /** 讀 body 的方式。預設 `res.json()`；TAIFEX 走 Big5 所以自己解。 */
  decode?: (res: Response) => Promise<T>
}

/**
 * 抓一個外部資料源，把三種失敗轉成讀得懂的錯誤。
 *
 * 這段骨架原本在 fred／twse／taifex／nasdaq 四個 client 各寫一份，三份的註解還互相
 * 寫著「對齊 fred/twse client」——也就是說作者本來就要它們一樣，只是靠手動維持。
 * 手動維持會漏：FRED 那份的 catch 一度不見了，逾時因此以裸 AbortError 冒出來，
 * 直到後來才修回去。
 *
 * decode 必須在 try 內執行、計時器在 finally 才清：body 讀到一半卡住也要算進逾時，
 * 提早回傳 Response 會讓那段變成不設防。
 */
export async function fetchSource<T = unknown>(url: string, opts: FetchSourceOptions<T>): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? SOURCE_TIMEOUT_MS
  const decode = opts.decode ?? (async (res: Response): Promise<T> => await res.json() as T)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...opts.init, signal: controller.signal })
    if (!res.ok)
      throw new Error(`${opts.label} HTTP ${res.status}`)
    return await decode(res)
  }
  catch (err) {
    // 只有 AbortError 能被改寫成 timeout。把 DNS 失敗之類的也標成逾時，
    // 會讓下一個人往「對方太慢」的方向查，而真因是連都沒連上。
    if (err instanceof Error && err.name === 'AbortError')
      throw new Error(`${opts.label} timeout after ${timeoutMs}ms`)
    throw err
  }
  finally {
    clearTimeout(timer)
  }
}
