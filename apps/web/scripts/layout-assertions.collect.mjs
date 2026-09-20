/**
 * 版面斷言 harness 的**頁面內量測**。
 *
 * 單獨一個檔案的理由是機械的：主檔撞到 eslint `max-lines` 的 300 行 error。切在這裡是
 * 因為這是唯一一條真正的接縫——`collect()` 在瀏覽器裡跑，其餘都在 node 裡跑。
 */

/**
 * 在頁面內量資料。判定留在 node 端的 judge() 做。
 * 注意：這個函式會被序列化送進瀏覽器，不能引用外部變數以外的東西。
 */
function collect({ typeScale, instruments }) {
  const cssPath = (el) => {
    const parts = []
    for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      const cls = typeof node.className === 'string' && node.className.trim()
        ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : ''
      parts.unshift(node.tagName.toLowerCase() + cls)
    }
    return parts.join(' > ')
  }

  // 1. 字級全部落在級數表上
  const typeOffenders = []
  const seenSizes = new Set()
  for (const el of document.querySelectorAll('body *')) {
    const raw = globalThis.getComputedStyle(el).fontSize
    const px = Number.parseFloat(raw)
    if (!Number.isFinite(px))
      continue
    seenSizes.add(px)
    if (!typeScale.includes(px) && typeOffenders.length < 25)
      typeOffenders.push({ selector: cssPath(el), fontSize: raw, text: (el.textContent || '').trim().slice(0, 40) })
  }

  // 2. 無水平溢出。個別元素若被祖先裁切（overflow-x 非 visible）就不算溢出——
  //    讀數帶在窄版本來就是水平捲的。
  const clientWidth = document.documentElement.clientWidth
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (globalThis.getComputedStyle(p).overflowX !== 'visible')
        return true
    }
    return false
  }
  const overflowOffenders = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0)
      continue
    if (r.right <= clientWidth + 1 && r.left >= -1)
      continue
    if (clippedByAncestor(el))
      continue
    if (overflowOffenders.length < 15)
      overflowOffenders.push({ selector: cssPath(el), left: Math.round(r.left), right: Math.round(r.right) })
  }

  // 3./4. 圖上器械。同時記下它的裁切祖先框——器械住在 .synoptic{overflow:hidden} 裡面，
  // 被擠出圖外時會被靜默裁掉：既不影響 documentScrollWidth，也被斷言 2 的祖先排除跳過。
  // 所以「有沒有跑出圖紙」必須自己量，不能指望溢出斷言。
  const clipperRect = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (globalThis.getComputedStyle(p).overflowX !== 'visible') {
        const r = p.getBoundingClientRect()
        return {
          selector: cssPath(p),
          left: Math.round(r.left),
          right: Math.round(r.right),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
        }
      }
    }
    return null
  }
  const rects = instruments.map(({ selector: sel, conditional }) => {
    const el = document.querySelector(sel)
    if (!el)
      return { selector: sel, present: false, conditional }
    const r = el.getBoundingClientRect()
    return {
      selector: sel,
      present: true,
      conditional,
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      clipper: clipperRect(el),
    }
  })
  // 四個方向都量。.synoptic 是 overflow: hidden，器械被擠到**下緣**外跟被右緣裁掉一樣是
  // 靜默失敗——只比左右等於斷言的名字比它守的範圍大。（桌機的 580px 自 2026-09-07 起是
  // min-height，長內容會把圖撐高而不是裁掉，但窄版與未來的版面改動仍可能裁到。）
  const clipped = rects
    .filter(r => r.present && r.clipper)
    .map((r) => {
      const sides = []
      if (r.left < r.clipper.left - 1)
        sides.push('左')
      if (r.right > r.clipper.right + 1)
        sides.push('右')
      if (r.top < r.clipper.top - 1)
        sides.push('上')
      if (r.bottom > r.clipper.bottom + 1)
        sides.push('下')
      return { r, sides }
    })
    .filter(({ sides }) => sides.length > 0)
    .map(({ r, sides }) => ({
      selector: r.selector,
      sides,
      instrument: { x: [r.left, r.right], y: [r.top, r.bottom] },
      clipper: { x: [r.clipper.left, r.clipper.right], y: [r.clipper.top, r.clipper.bottom] },
      clipperSelector: r.clipper.selector,
    }))
  const collisions = []
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      if (!a.present || !b.present)
        continue
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (overlapX > 0 && overlapY > 0)
        collisions.push({ pair: [a.selector, b.selector], overlap: { x: overlapX, y: overlapY } })
    }
  }

  return {
    typeOffenders,
    observedSizes: [...seenSizes].sort((a, b) => b - a),
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: clientWidth,
    overflowOffenders,
    instrumentRects: rects,
    collisions,
    clipped,
  }
}

export { collect }
