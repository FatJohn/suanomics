// 讀者面閱讀進度的純函式。DOM 讀取留在 composable、這裡只做算術。

/**
 * 已讀比例 0..1。分母是「可捲距離」而非文件全高——讀到底時該是 1、不是 (viewport/doc)。
 * 文件比視窗短時沒有東西可捲，視為全部讀完。
 */
export function readingProgress(scrollY: number, viewportHeight: number, documentHeight: number): number {
  const scrollable = documentHeight - viewportHeight
  if (scrollable <= 0)
    return 1
  const ratio = scrollY / scrollable
  return Math.min(1, Math.max(0, ratio))
}
