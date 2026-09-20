/**
 * 「返回」該回到哪裡。
 *
 * 站內的返回連結原本寫死成 `to="/"`（`BriefNewsView`、`SourcesView`），所以從 09-01 的
 * 佐證層點進某則新聞再返回，會落到最新一天的報告層——日期與層別一起掉。
 *
 * 讀者真正要的是「回到我剛才在的地方」，而瀏覽器本來就記得。vue-router 把上一筆的
 * fullPath 放在 `history.state.back`；直接從外部連結開啟這一頁時它是 `null`，那才需要
 * fallback 到 `/`。
 *
 * 沒有走 `?from=` 那條路：來源位置放進網址雖然可分享、可中鍵開新分頁，但那是個要驗證的
 * 外部輸入（得擋住站外 URL），而返回目的地本來就不是需要分享的東西。
 */

/** vue-router 在站內導覽時把上一筆的 fullPath 寫進 `history.state.back`。 */
export function hasInternalHistory(state: unknown): boolean {
  if (typeof state !== 'object' || state === null)
    return false
  const back = (state as { back?: unknown }).back
  // 只認站內的絕對路徑。`//evil.com` 是 protocol-relative URL、會被瀏覽器當成外部網域，擋掉。
  return typeof back === 'string' && back.startsWith('/') && !back.startsWith('//')
}

/**
 * 左鍵以外（中鍵、cmd／ctrl／shift／alt + 點擊）維持瀏覽器預設，讓「開新分頁」還能用——
 * 那條路徑會落在 fallback 的 `/`，這是可接受的：新分頁本來就沒有「上一頁」。
 */
export function shouldInterceptClick(e: { button: number, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}
