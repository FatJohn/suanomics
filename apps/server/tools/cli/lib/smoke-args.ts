import process from 'node:process'

/**
 * 量測腳本的 CLI 前提驗證。
 *
 * 為什麼是獨立 module 而不是各腳本自己寫：`--limit` 的 NaN 洞在 `narrative-ledger-ab.ts`
 * 修過一次、但沒有傳到 `claim-yield-smoke.ts`（同一段 argv 解析被複製時只搬了骨架、
 * 沒搬那次修法）。量測前提的 bug 不會讓任何斷言變紅——它只讓報告上的樣本數說謊——
 * 所以它必須住在有測試的地方。
 */

/**
 * 取旗標後面那個值（`--dates 2026-08-13` → `'2026-08-13'`）。
 *
 * 這個三行函式原本在三個腳本各抄一份。它們用的是同一種極簡慣例（不支援 `--k=v`、
 * 不驗未知旗標），與另外七個走 commander 的腳本刻意不同——量測腳本要的是
 * 「加一個旗標不必動 option 宣告」，所以兩套慣例並存是刻意的，抄三份不是。
 */
export function argValue(flag: string, argv: readonly string[] = process.argv.slice(2)): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

/** `--dates a,b` 的值。回 undefined 代表不限定日期（跑全部）。 */
export function parseDateList(raw: string | undefined): string[] | undefined {
  return raw?.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * 確認 GEMINI_API_KEY 已載入，否則印訊息後 exit 1。
 *
 * `howToRun` 由呼叫端帶入整句而不是套模板：每個腳本載 env 的方式都不同
 * （`pnpm claim:yield` 這類 alias 自帶 `--env-file-if-exists`、沒有 alias 的 smoke
 * 只能自己打 `pnpm exec tsx --env-file-if-exists=...`），印錯了等於沒印。
 */
export function requireGeminiKeyOrExit(howToRun: string): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    console.error(`缺 GEMINI_API_KEY——請用 ${howToRun}`)
    process.exit(1)
  }
  return key
}

/**
 * `--limit` 的值。回 0 代表不抽樣（跑全量）。
 *
 * 非數字、負數、小數一律拋錯而不是回 NaN：呼叫端普遍寫成 `limit > 0 ? slice : all`，
 * 而 `NaN > 0` 是 false，於是打錯的旗標會靜默降級成全量、報告字串也不標 `--limit`。
 */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined)
    return 0
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--limit 必須是非負整數（收到：${raw}）`)
  return n
}

/**
 * 腳本入口用的薄殼：印乾淨訊息後 exit 1，不吐 stack trace。
 * 打錯旗標是操作失誤、不是程式碼 bug，stack 只會蓋掉真正要看的那一行。
 */
export function parseLimitOrExit(raw: string | undefined): number {
  try {
    return parseLimit(raw)
  }
  catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
