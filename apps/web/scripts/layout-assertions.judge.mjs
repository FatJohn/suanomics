/**
 * 版面斷言的判定邏輯：把 collect() 量到的原始數字翻成 PASS/FAIL 條目。
 *
 * 從 layout-assertions.mjs 拆出來的理由是行數——那支檔案 2026-08-02 正好卡在
 * max-lines 的 300，再加一條斷言就會紅。判定與執行拆開之後兩邊都有餘裕，
 * 而且 judge() 是純函式（吃 raw、吐條目），單獨放一支檔比較好讀。
 *
 * **這裡的每一條都要能被證偽**：加新斷言之前先問「什麼情況下它會 FAIL」，
 * 答不出來的就是綠燈裝飾品（見 layout-assertions.mjs 檔頭的涵蓋邊界）。
 */

/**
 * 探針型斷言：只在該輪真的量到對應狀態時才發，量不到就一條都不發。
 *
 * 三條的共通點是它們守的都不是幾何，而是**「這一輪到底有沒有驗到它宣稱要驗的東西」**。
 * 上面那五條全都在正反觀點的上方或與它無關、也全都在頁面上半部，所以收合／展開失效、
 * 或頁尾被 fixed 播放器蓋住時，五條會照樣全綠——那就是無法被證偽的綠燈。
 *
 * 條件式而不是無條件發一條假 PASS 是刻意的：量不到時由 runner 記進 skipped，
 * 斷言總數會看得見地掉下來（76 → 68），而不是靜靜地留下一排綠字。
 */
function probeAssertions(raw) {
  const tail = raw.footerTail
  const tailClear = tail ? tail.meta.bottom <= tail.dock.top : false
  return [
    // 守那個核心決定本身。沒有它，元件回歸成預設展開時這一輪全綠，而下一輪的點擊
    // 會把它關上、以「展開沒生效」FAIL，方向指反、害人往錯的地方查。
    ...(raw.collapsedProbe
      ? [{
          id: 'viewpoints-collapsed-by-default',
          label: '正反兩面預設是收合的',
          pass: !raw.collapsedProbe.visible,
          detail: !raw.collapsedProbe.visible
            ? `${raw.collapsedProbe.selector} 未渲染（reka Collapsible 收合時不掛 DOM）`
            : [
                `沒點任何東西就看得到 ${raw.collapsedProbe.selector}（高 ${raw.collapsedProbe.height}px）`,
                '正反觀點變回預設展開了——預設收合的決定',
              ],
        }]
      : []),
    // expand 那一輪的存在證明，也是報告 JSON 裡唯一能區分展開／收合的指紋。
    ...(raw.expandProbe
      ? [{
          id: 'expansion-took-effect',
          label: '展開真的生效',
          pass: raw.expandProbe.visible,
          detail: raw.expandProbe.visible
            ? `${raw.expandProbe.selector} 已渲染、高 ${raw.expandProbe.height}px`
            : [
                `點過觸發器之後仍然看不到 ${raw.expandProbe.selector}`,
                '這一輪其餘五條的 PASS 不代表展開態被驗過——收合態也會讓它們全綠',
              ],
        }]
      : []),
    // 只在掛了 checkFooterTail 的輪次（report / evidence）。守的是一個**只在文件末端才
    // 成立**的碰撞：播放器是 fixed，捲到底時它蓋住的是再也捲不出來的內容。2026-08-02
    // 之前 footer 的最後一行就整條在它底下（桌機 31px、手機 62px），而其他所有斷言
    // 都在頁面上半部、對此一無所知。
    ...(tail
      ? [{
          id: 'footer-tail-clear-of-dock',
          // 標籤指名元素而不是說「最後一行」：它綁死 .footer-meta，footer 尾端若日後
          // 多一個元素，「最後一行」這個講法就會比實作大。
          label: '頁尾的 .footer-meta 沒有被播放器蓋住',
          pass: tailClear,
          detail: tailClear
            ? `.footer-meta 底緣 ${tail.meta.bottom} ≤ .dock 頂緣 ${tail.dock.top}（餘裕 ${tail.dock.top - tail.meta.bottom}px）`
            : [
                `.footer-meta 佔 ${tail.meta.top}..${tail.meta.bottom}，.dock 頂緣在 ${tail.dock.top}`,
                `被蓋掉 ${tail.meta.bottom - tail.dock.top}px——頁面底部就是 footer 底部、捲不出來，那一行等於不存在`,
                '播放器的 reserve 要跟著文件的最後一個元素走（main.css 的 --dock-reserve）',
              ],
        }]
      : []),
  ]
}

export function judge(raw) {
  const docOverflow = raw.documentScrollWidth > raw.documentClientWidth
  // 器械分兩種語意，混成一個清單會把「當天資料單邊」判成「版面壞了」：
  // .force-damp／.force-push 在 BriefSynopticChart.vue 是 v-if，而 synoptic-chart.ts:75
  // 明寫「缺一邊時另一邊仍成立——版面必須承受單邊」。direction enum 只有
  // positive/neutral/negative，所以全正的一天 damp 就是 null，此時舊版會 FAIL 並印
  // 「頁面沒載到 brief，或器械的 class 改了名」——兩個原因都不對，方向指反。
  const missingRequired = raw.instrumentRects.filter(r => !r.present && !r.conditional).map(r => r.selector)
  const absentConditional = raw.instrumentRects.filter(r => !r.present && r.conditional).map(r => r.selector)
  return [
    {
      id: 'type-scale',
      label: '字級全部落在級數表上',
      pass: raw.typeOffenders.length === 0,
      detail: raw.typeOffenders.length === 0
        ? `${raw.observedSizes.length} 種字級，全部在表上：${raw.observedSizes.join(' / ')}`
        : raw.typeOffenders.map(o => `${o.fontSize} @ ${o.selector}${o.text ? ` — 「${o.text}」` : ''}`),
    },
    {
      id: 'no-horizontal-overflow',
      label: '無水平溢出',
      pass: !docOverflow && raw.overflowOffenders.length === 0,
      detail: !docOverflow && raw.overflowOffenders.length === 0
        ? `scrollWidth === clientWidth (${raw.documentClientWidth})，無元素越界`
        : [
            ...(docOverflow ? [`document scrollWidth ${raw.documentScrollWidth} > clientWidth ${raw.documentClientWidth}`] : []),
            ...raw.overflowOffenders.map(o => `${o.selector} 佔 ${o.left}..${o.right}`),
          ],
    },
    {
      id: 'instruments-present',
      label: '必在場的器械都在場',
      // 沒有這條，頁面沒載到 brief（或器械被改名）時另外三條會全部 PASS——
      // 空頁面沒有字級違規、沒有溢出、沒有碰撞，24 條全綠而其實什麼都沒驗到。
      pass: missingRequired.length === 0,
      detail: missingRequired.length === 0
        ? [
            `${raw.instrumentRects.filter(r => r.present).length}/${raw.instrumentRects.length} 在場`,
            // 條件器械缺席不是失敗，但要看得見：少了它們，碰撞與裁切那兩條這一輪
            // 量到的範圍就比較小，讀報告的人得知道綠燈是在什麼樣本上拿到的。
            ...(absentConditional.length > 0
              ? [`當天資料單邊，${absentConditional.join('、')} 未渲染（v-if）——碰撞／裁切這一輪只量在場的器械`]
              : []),
          ]
        : [`找不到：${missingRequired.join('、')}`, '頁面沒載到 brief，或器械的 class 改了名——其餘斷言的結果不可信'],
    },
    {
      id: 'instruments-within-chart',
      label: '器械沒有被圖紙裁掉',
      // .synoptic 是 overflow:hidden，所以器械跑出圖外時是「靜默消失」：documentScrollWidth
      // 不動，斷言 2 的祖先排除也會跳過它們。這條專門補那個盲區（窄版把標題組擠成 323px
      // 那類失敗態就是這樣現形的）。
      pass: raw.clipped.length === 0,
      detail: raw.clipped.length === 0
        ? '四個器械的四個邊都在裁切祖先框內'
        : raw.clipped.map(c =>
            `${c.selector} 從${c.sides.join('、')}緣溢出：x ${c.instrument.x.join('..')} y ${c.instrument.y.join('..')}，`
            + `超出 ${c.clipperSelector} 的 x ${c.clipper.x.join('..')} y ${c.clipper.y.join('..')}`,
          ),
    },
    {
      id: 'instruments-no-collision',
      label: '圖上器械兩兩不相撞',
      pass: raw.collisions.length === 0,
      detail: raw.collisions.length === 0
        ? `${raw.instrumentRects.filter(r => r.present).length}/${raw.instrumentRects.length} 個器械在場，無交集`
        : raw.collisions.map(c => `${c.pair.join(' ✕ ')} 交疊 ${c.overlap.x}×${c.overlap.y}px`),
    },
    ...probeAssertions(raw),
  ]
}
