/**
 * 哪些發行商的正文**不抓**。這是政策，不是技術限制。
 *
 * `ctee`（工商時報）：站方 `robots.txt` 明確封鎖一份具名的 AI 爬蟲清單。本 repo 的
 * User-Agent（`NEWS_FETCH_USER_AGENT`）不在那份清單上、檔內也沒有 `User-agent: *` 段，
 * 所以**依 robots 規範並沒有被限制——這條規則是自我約束，不是被擋**：站方的意思很清楚
 * （不想被 AI 爬），所以 2026-09-07 決定不抓它的正文。要放寬之前先回到這個前提。
 * 這條規則是有代價的：正文落地率因此從 55% 降到 34%。
 *
 * ★ 這裡用 host 清單、不是「跳過 google-news-ctee 這個來源」：直連來源哪天也指到這個
 * host 一樣要擋。Google News 代理來源現在整批在 feed 層跳過抓正文（`isGoogleNewsProxySeed`，
 * 見 `news/refresh.ts`），連走到這份清單的機會都沒有；這份清單只管直連來源。
 */
export const BODY_FETCH_DENIED_HOSTS: readonly string[] = ['ctee.com.tw']

function isDeniedHostname(hostname: string): boolean {
  // 比對「等於」或「是子網域」，不要用 endsWith 直接比字串——`notctee.com.tw` 會被誤判。
  return BODY_FETCH_DENIED_HOSTS.some(denied => hostname === denied || hostname.endsWith(`.${denied}`))
}

/** 這個網址的正文抓不抓。解析不了的網址一律回 false（交給下游的抓取失敗處理）。 */
export function isBodyFetchDenied(url: string): boolean {
  try {
    return isDeniedHostname(new URL(url).hostname)
  }
  catch {
    return false
  }
}
