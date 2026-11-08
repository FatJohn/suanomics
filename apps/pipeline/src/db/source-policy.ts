import process from 'node:process'

/**
 * 預設 seed policy（見 seed.ts / seed-external-sources.ts 檔頭）：
 * 乾淨 clone 跑 `db:seed` 只啟用「以公開發佈為目的」的官方來源；其餘商業媒體 feed
 * 停用，需要使用者自己設 `SEED_THIRD_PARTY_SOURCES=true` 明示開啟並自行確認各站
 * 的 ToS 與 robots.txt。
 */

/** 以公開發佈為目的的官方來源網域。 */
export const OFFICIAL_SOURCE_DOMAINS: readonly string[] = [
  'cbc.gov.tw',
  'eia.gov',
  'ey.gov.tw',
  'federalreserve.gov',
  'fsc.gov.tw',
  'mops.twse.com.tw',
  'openapi.twse.com.tw',
  'whitehouse.gov',
]

/**
 * URL 的主機是否落在官方網域（完全相等或其子網域）。解析失敗回 false。
 *
 * 比對用「完全相等」或「以 `.` + 網域結尾」，不是子字串——`eia.gov.attacker.com`
 * 與 `notfsc.gov.tw` 這種偽裝尾綴不能算官方。
 */
export function isOfficialSourceUrl(url: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  }
  catch {
    return false
  }
  return OFFICIAL_SOURCE_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

/** 使用者是否已明示開啟第三方來源（讀 `SEED_THIRD_PARTY_SOURCES`）。 */
export function thirdPartySourcesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SEED_THIRD_PARTY_SOURCES ?? '').trim().toLowerCase() === 'true'
}

/**
 * 使用者是否明示允許把既有的第三方來源降級成停用（讀 `SEED_ALLOW_DOWNGRADE`）。
 *
 * 這跟 `thirdPartySourcesEnabled` 是兩個不同的問題：後者問「這次要不要抓第三方
 * 來源」，這個問的是「如果 DB 裡已經有啟用中的第三方來源、而這次沒開 opt-in，
 * 使用者是不是真的知道且同意這次會把它們翻成停用」。解析方式與
 * `thirdPartySourcesEnabled` 一致（trim + 小寫 === `'true'`）。
 */
export function downgradeAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SEED_ALLOW_DOWNGRADE ?? '').trim().toLowerCase() === 'true'
}

/**
 * 這次 seed 要不要因為「會靜默把既有啟用中的第三方來源降級成停用」而中止。
 *
 * `enabledThirdParty` 是 DB 現在啟用中、且這次會被 gate 擋下的 slug——呼叫端負責
 * 查 DB 算出這份清單（見 seed.ts / seed-external-sources.ts CLI entry）。
 *
 * - `optIn === true` → 永不中止：這次本來就要啟用第三方來源，沒有降級這回事。
 * - `allowDowngrade === true` → 不中止：使用者已明示接受這次會降級。
 * - 其餘情況：只要 `enabledThirdParty` 非空，就代表這次會把「作者手動啟用過」的
 *   來源悄悄關掉，必須中止讓使用者自己決定要開 opt-in 還是接受降級。
 */
export function shouldBlockDowngrade(
  enabledThirdParty: readonly string[],
  optIn: boolean,
  allowDowngrade: boolean,
): boolean {
  if (optIn || allowDowngrade)
    return false
  return enabledThirdParty.length > 0
}

/**
 * 這一筆 seed 最終要不要啟用。`declared` 與 `optIn` 是兩個正交的閘門：
 *
 * - `declared === false` → 一律 false（壞掉而停用的來源不會因為開了 opt-in 就復活）。
 * - `declared === true` 且**每一個** URL 都是官方網域 → true（不論 optIn）。
 * - `declared === true` 且有任一 URL 非官方 → 只有 `optIn === true` 才 true。
 *
 * 用「每一個都官方」而不是「任一個官方」：有些 config 帶多個 URL，只要其中一個
 * 打到商業站，這筆就不該被當成官方直接放行。沒有任何 URL（空陣列）視為不官方。
 */
export function effectiveEnabled(urls: readonly string[], declared: boolean, optIn: boolean): boolean {
  if (!declared)
    return false
  const allOfficial = urls.length > 0 && urls.every(isOfficialSourceUrl)
  return allOfficial || optIn
}

/** `applySeedGate` 對每一筆 seed 套用 gate 之後的結果。 */
export interface GatedEntry<T> {
  entry: T
  resolvedEnabled: boolean
}

/** `applySeedGate` 的回傳值：逐筆結果，加一份「被擋下」的 slug 清單方便印警告訊息。 */
export interface SeedGateResult<T> {
  gated: GatedEntry<T>[]
  withheldSlugs: string[]
}

/**
 * 對一批 seed 逐筆套用 gate（`effectiveEnabled` 的批次版本），是兩支 seed CLI entry
 * 共用的核心邏輯——抽出來是因為原本兩份幾乎一樣的 map/filter 邏輯完全沒有測試覆蓋
 * 「實際交給 DB 的那份陣列在沒設 env 時只剩幾筆」這個安全屬性本身。
 *
 * `withheldSlugs` 只收「宣告啟用、但被 gate 擋下」的（`declared === true` 且
 * `resolvedEnabled === false`）；宣告就停用的（壞掉而退役，`declared === false`）
 * 不算被擋——它們不論 optIn 都維持停用，不是這個 gate 的作用對象。
 *
 * ★ 對 `T` 保持泛型、不 import 任何 seed 檔：`seed.ts` 與 `seed-external-sources.ts`
 * 已經 import 這個模組，這裡反向 import 會造成循環 import。呼叫端用 `read()` 把自己的
 * entry 形狀（`SeedEntry` 用 `isActive`、`ExternalSourceSeed` 用 `enabled ?? true`）
 * 攤成這個函式看得懂的最小介面。
 */
export function applySeedGate<T>(
  entries: readonly T[],
  optIn: boolean,
  read: (entry: T) => { slug: string, urls: readonly string[], declared: boolean },
): SeedGateResult<T> {
  const withheldSlugs: string[] = []
  const gated = entries.map((entry) => {
    const { slug, urls, declared } = read(entry)
    const resolvedEnabled = effectiveEnabled(urls, declared, optIn)
    if (declared && !resolvedEnabled)
      withheldSlugs.push(slug)
    return { entry, resolvedEnabled }
  })
  return { gated, withheldSlugs }
}

/**
 * 遞迴走訪任意值，收集所有 `^https?://` 開頭的字串。
 *
 * 用途是從 `ExternalSourceSeed.config` 取出所有 URL——config 形狀依 `kind` 而異
 * （`feedUrl`、`listingUrl`、巢狀 `headers` 等），逐欄位名硬寫會漏掉新增的 kind。
 */
export function collectHttpUrls(value: unknown): string[] {
  const found: string[] = []
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/^https?:\/\//.test(v))
        found.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item)
      return
    }
    if (v !== null && typeof v === 'object') {
      for (const item of Object.values(v)) visit(item)
    }
  }
  visit(value)
  return found
}
