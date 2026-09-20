// citation / relatedNews 的 url 經 backend 組裝層保證為真 source URL（可外開）。
// 唯一例外：當日無 citation 時的 `data:insufficient` graceful sentinel。
// 用此判定是否能安全當外部連結（擋掉 sentinel、避免點到開 data: 頁）。
export function isExternalUrl(s: string | null | undefined): boolean {
  if (!s)
    return false
  try {
    const { protocol } = new URL(s)
    return protocol === 'http:' || protocol === 'https:'
  }
  catch {
    return false
  }
}
