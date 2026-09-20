import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `canary-example/` 的 ticker 掃描。
 *
 * 這個目錄是公開 repo 的合成 fixture，內容必須全部虛構。公司名／媒體名這層
 * 已經量過（2026-09-11）：拿 TWSE+TPEx 1,985 家公司名掃全文是 0 真陽性、
 * 4 假陽性（子字串誤中，例如「電力成本」誤中「力成」），當硬 gate 等於第一天
 * 就要配白名單，所以刻意不做。**只做 ticker 這一層**——TWSE 的 `codeQuery`
 * 端點會做前綴比對，剛好適合拿來查「這個代號是不是真的被指派過」。
 *
 * 它的前綴比對**同時吃代號與名稱**（2026-09-11 實測：`台積` 回 `2330 台積電`、
 * `富邦恒生` 回三檔富邦恒生系列），所以 `affectedTickers` 這種有時放中文字串的
 * 欄位順便也擋得住真實公司名。射程僅止於此——散文欄位不在掃描範圍內。
 *
 * I/O 與判定分開：`collectFixtureTickers` 只讀檔、`findTickerCollisions` 的
 * 查詢用注入的 `CodeLookup`，測試才能不打網路跑過整條邏輯。
 */

export interface FixtureTicker {
  /** 來源檔，repo-relative，報告用 */
  file: string
  /** JSON 內的路徑，例如 relatedETFs[0].ticker */
  path: string
  ticker: string
}

export interface TickerCollision {
  ticker: FixtureTicker
  /** codeQuery 回的真實證券 */
  matches: { code: string, name: string }[]
}

/** 注入式查詢；回 null 代表打不到（呼叫端要當 skip 不是 fail）。 */
export type CodeLookup = (ticker: string) => Promise<readonly string[] | null>

const NO_MATCH = '(無符合之代碼或名稱)'

/**
 * 把 codeQuery 的 `suggestions` 陣列拆成 `{code, name}`。
 *
 * 拆不出 tab 的項目**不丟掉**——原樣塞進 code、name 給空字串。靜默丟掉等於
 * 放行一筆我們看不懂但可能就是撞到的回應，這個檢查存在的理由就沒了。
 */
export function parseCodeQuerySuggestions(suggestions: readonly string[]): { code: string, name: string }[] {
  return suggestions
    .filter(s => s !== NO_MATCH)
    .map((s) => {
      const tab = s.indexOf('\t')
      return tab < 0 ? { code: s, name: '' } : { code: s.slice(0, tab), name: s.slice(tab + 1) }
    })
}

/** 遞迴走一份 JSON 值，收集所有 `ticker` 字串欄位與 `affectedTickers` 陣列元素。 */
function walk(value: unknown, file: string, path: string, out: FixtureTicker[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, file, `${path}[${i}]`, out))
    return
  }
  if (value === null || typeof value !== 'object')
    return

  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path === '' ? key : `${path}.${key}`
    if (key === 'ticker' && typeof v === 'string') {
      out.push({ file, path: nextPath, ticker: v })
      continue
    }
    if (key === 'affectedTickers' && Array.isArray(v)) {
      v.forEach((t, i) => {
        if (typeof t === 'string')
          out.push({ file, path: `${nextPath}[${i}]`, ticker: t })
      })
      continue
    }
    walk(v, file, nextPath, out)
  }
}

/**
 * 從 `canary-example` 目錄遞迴撈出所有 ticker 欄位。
 *
 * 刻意不寫死 `relatedETFs`——這個檢查的價值在於日後有人增補 fixture 時自動
 * 涵蓋，寫死欄位名等於只守今天這份。
 */
export function collectFixtureTickers(dir: string): FixtureTicker[] {
  const out: FixtureTicker[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectFixtureTickers(full))
      continue
    }
    if (!entry.endsWith('.json'))
      continue
    const raw = readFileSync(full, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    }
    catch (err) {
      // 跳過壞掉的 JSON 等於讓那個檔的 ticker 從檢查裡消失，而報告仍然是綠的——
      // 這個 repo 的系統性失敗模式就是「外部依賴失效回傳空結果」。寧可炸。
      throw new Error(`canary fixture 不是合法 JSON：${full}：${err instanceof Error ? err.message : String(err)}`)
    }
    walk(parsed, full, '', out)
  }
  return out
}

export async function findTickerCollisions(
  tickers: readonly FixtureTicker[],
  lookup: CodeLookup,
): Promise<{ collisions: TickerCollision[], unreachable: FixtureTicker[] }> {
  const collisions: TickerCollision[] = []
  const unreachable: FixtureTicker[] = []
  for (const t of tickers) {
    const suggestions = await lookup(t.ticker)
    if (suggestions === null) {
      unreachable.push(t)
      continue
    }
    const matches = parseCodeQuerySuggestions(suggestions)
    if (matches.length > 0)
      collisions.push({ ticker: t, matches })
  }
  return { collisions, unreachable }
}
