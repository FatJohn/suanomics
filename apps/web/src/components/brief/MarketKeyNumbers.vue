<script setup lang="ts">
import type { KeyNumber } from '@suanomics/shared'
import { formatMonthDay } from '@/lib/format-date.js'
import { formatMarketDelta, formatMarketValue } from '@/lib/format-market-number.js'

// 觀測站讀數。改版後只有一種形態：釘在力場圖底緣的那一橫排。
// 舊的 rail / strip 兩個 variant 隨側欄數字與 mobile hero strip 一起移除。
defineProps<{ series: KeyNumber[] }>()

const ARROW: Record<KeyNumber['direction'], string> = { up: '▲', down: '▼', flat: '—' }

// 讀者要問的是「這個數字是哪一天的」，所以判準是「是不是最近一個交易日的值」、
// 不是「來源有沒有遲到」。兩者不同——美元兌台幣走 H.10 每週一發，週五顯示的是上週五的
// 匯率，狀態是 fresh（來源準時）卻仍然不是今天的數字；只看 lagLabel 的話一個字都不會標。
// 前一交易日的四格維持原樣不加註（那是讀者的預設期待、標了是噪音）。
function asOfNote(item: KeyNumber): string | null {
  if (item.isLatestTradingDay)
    return null
  const date = formatMonthDay(item.latest.date)
  return item.lagLabel ? `${date}·${item.lagLabel}` : date
}

// 方向（箭頭＋紅綠）之外補上幅度。語意分岔在 formatMarketDelta 裡（flow 給
// 前值對照而非差值），這裡只負責取值。無前值的序列回 null、整個節點不渲染。
function deltaNote(item: KeyNumber): string | null {
  return formatMarketDelta(item.latest.value, item.previous?.value ?? null, item.unit, item.kind)
}
</script>

<template>
  <section
    v-if="series.length > 0"
    class="kn-ribbon"
    aria-label="市場關鍵數字，可水平捲動"
    tabindex="0"
  >
    <div
      v-for="item in series"
      :key="item.seriesId"
      class="kn-ribbon-cell"
      :data-dir="item.direction"
      :data-stale="item.lagLabel ? 'true' : undefined"
    >
      <span class="kn-ribbon-label">{{ item.label }}</span>
      <span class="kn-ribbon-value">
        <span class="kn-arrow">{{ ARROW[item.direction] }}</span>
        {{ formatMarketValue(item.latest.value, item.unit, item.kind) }}
        <span v-if="deltaNote(item)" class="kn-delta">{{ deltaNote(item) }}</span>
      </span>
      <span v-if="asOfNote(item)" class="kn-asof">{{ asOfNote(item) }}</span>
    </div>
  </section>
</template>

<style scoped>
.kn-arrow {
  font-size: var(--size-small);
}

/* 變化量：主角是當期值，delta 是註腳。用 --fg-muted 而非 --fg-3——
   落後的格子會把值降成 --fg-3（見下方 data-stale 規則），delta 若也是 --fg-3
   就會變成兩個同灰階的數字、主從不分。 */
.kn-delta {
  font-size: var(--size-caption);
  font-weight: 400;
  color: var(--fg-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* 圖底緣的觀測站讀數帶 */
.kn-ribbon {
  display: flex;
  overflow-x: auto;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  -webkit-overflow-scrolling: touch;
}
.kn-ribbon:focus-visible {
  outline: 2px solid var(--warm);
  outline-offset: 3px;
}
.kn-ribbon-cell {
  flex: 1 0 132px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 13px 18px;
  border-left: 1px solid var(--border-2);
}
/* 第一格的左內距是「區塊的外緣內距」，跟其他格的 18px 是兩種角色——那 18px 是**分隔線
   之後的溝寬**。用 --chart-panel-pad 是為了與正上方的主軸卡對齊到同一條線：兩個襯底區塊
   直接相疊，字的左緣差幾個 px 就看得出來。原本這裡是 0，讀數貼著框線像掉出框外。 */
.kn-ribbon-cell:first-child {
  padding-left: var(--chart-panel-pad, 15px);
  border-left: 0;
}
.kn-ribbon-label {
  color: var(--fg-3);
  font-size: var(--size-caption);
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.kn-ribbon-value {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  color: var(--fg-1);
  font-family: var(--font-num);
  font-size: var(--size-body);
  font-weight: 700;
  white-space: nowrap;
}
.kn-ribbon-cell[data-dir='up'] .kn-ribbon-value {
  color: var(--dir-up);
}
.kn-ribbon-cell[data-dir='down'] .kn-ribbon-value {
  color: var(--dir-down);
}

/* 資料日期標示
   非最近一個交易日的格子附日期；只有「來源真的遲到」才另外淡化數值——
   放在方向色規則之後才蓋得掉紅綠，否則遲到的舊值會被讀成「今天漲/跌了」。 */
.kn-asof {
  font-size: var(--size-caption);
  color: var(--fg-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.kn-ribbon-cell[data-stale='true'] .kn-ribbon-value {
  color: var(--fg-3);
}
</style>
