/**
 * 「列表只給標題與網址、正文要另外一次請求」這類來源共用的正文抓取工具。
 *
 * 這些東西原本長在 rss.ts 的 TWSE 那條路徑裡。html-selector 走的是同一個形狀
 * （列表頁拿到文章頁網址、正文在那一頁），需要同一套護欄，所以抽出來共用——不是為了
 * 美觀，是因為那三道護欄各自對應一次真實事故，重寫一份就會漏掉其中一兩道。
 */

/**
 * 正文抓取的 timeout，**刻意獨立於 feed 的 timeoutMs（預設 15s）而且更短**。
 *
 * 通用的理由：單一 source 內的文章是**序列**處理的，所以「每篇的時間預算」＝一輪可用的
 * 時間 ÷ 要抓正文的篇數。一輪可用的時間是跑 `corpus:refresh` 的那個 workflow 步驟的
 * timeout；要抓正文的篇數受每輪 enrich 名額（`maxEnrich`）限制，名額用完後要抓正文的
 * 文章直接延後、不抓。
 *
 * 8000 這個數字是 v0 時**從 TWSE 那個來源推出來的**：當時的上限是 job 的 90 分鐘
 * staleness 窗，538 篇 ÷ 90 分鐘 ≒ 每篇 10 秒，而它每篇要兩段請求（newsDetail＋PDF），
 * 所以單段預算取 8 秒、單篇最壞 16 秒。
 * ★ 要調這個常數時用現在的步驟 timeout 與單輪最多抓正文的篇數重推，並算你那個來源的
 * 每篇請求段數（html-selector 是單段請求），不要照抄上面的 538、90 分鐘與 ×2。
 */
export const BODY_FETCH_TIMEOUT_MS = 8000

/**
 * 連續失敗多少次就放棄本輪剩下的正文抓取。
 *
 * 它擋的是**整批硬失敗**：端點下線、路徑改掉、整站拒絕自動化請求（這個 repo 已經有
 * 「本機 200、部署環境 403」的前例）。那種情況下每一篇都回 null，計數一路累到門檻就短路，
 * 本輪成本收斂成 5 篇 × 單篇最壞。以 TWSE 為例，沒有這道保險時 8s×2×538 是 143 分鐘
 * （v0 時已超出 job 的 90 分鐘 staleness 窗，也遠超過 workflow 步驟的 timeout）。
 *
 * ★ **它不是一道通用的成本上限**，兩種情況它擋不住：
 *   1. 成功與失敗交錯——`createBodyFetchGuard` 一遇成功就把計數歸零（那是刻意的，
 *      偶爾漏抓一篇不該讓整批只剩標題），所以交錯時 N 篇照樣全跑。
 *   2. 「慢但成功」——被節流到每篇都逼近 timeout 但仍回 200，一次 failure 都不產生，
 *      這道守衛從頭到尾不會觸發。
 *   這兩種情況的上限只有 `BODY_FETCH_TIMEOUT_MS × 每篇請求段數 × 篇數`——**段數不能漏**，
 *   TWSE 是兩段（newsDetail＋PDF），漏掉它會把上限低估一倍。所以**每加一個來源仍要自己
 *   算那個乘積**，不能因為有這道短路就跳過。
 */
export const MAX_CONSECUTIVE_BODY_FAILURES = 5

/** 邊讀邊計數，超過上限就中斷連線。`content-length` 可以缺、也可以說謊，不能只看它。 */
export async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader()
  if (!reader)
    return null
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

export interface BodyFetchGuard {
  /**
   * 跑一次正文抓取。已經連續失敗到門檻就直接回 null、不再打外部服務。
   * `fn` 回 null＝這次拿不到正文（呼叫端自己吞掉例外後回 null）。
   */
  run: (fn: () => Promise<string | null>) => Promise<string | null>
}

/**
 * 建立一個本輪共用的連續失敗計數器。**一個 source 的一次 fetch 建一個**，
 * 所有 entry 的 `fetchBody` 閉包共享它——單篇失敗不算什麼，整批失敗才是訊號。
 *
 * @param label 出現在 log 裡的來源名稱，例如 `twse 公告`。
 */
export function createBodyFetchGuard(label: string): BodyFetchGuard {
  let consecutiveFailures = 0
  return {
    run: async (fn) => {
      if (consecutiveFailures >= MAX_CONSECUTIVE_BODY_FAILURES)
        return null
      const text = await fn()
      consecutiveFailures = text === null ? consecutiveFailures + 1 : 0
      if (consecutiveFailures === MAX_CONSECUTIVE_BODY_FAILURES)
        console.warn(`[corpus] ${label} 正文連續失敗 ${MAX_CONSECUTIVE_BODY_FAILURES} 次，本輪剩下的只存標題`)
      return text
    },
  }
}
