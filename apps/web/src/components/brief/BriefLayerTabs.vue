<script setup lang="ts">
import type { ReaderLayer } from '@/lib/reader-layer.js'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { carriedQuery, READER_LAYERS } from '@/lib/reader-layer.js'

/**
 * 圖區與閱讀區的交界，同時是兩層的入口。
 *
 * 用連結而不是按鈕：層別在網址上（`?view=`），所以它本來就是可分享、可中鍵開新分頁、
 * 上一頁會回到原本那層的東西。硬做成 role="tablist" 反而要自己重做鍵盤與焦點行為。
 */
const props = defineProps<{
  layer: ReaderLayer
  counts: { chains: number, sources: number }
}>()

// computed 而不是 setup 期算一次的常數：換日期時 counts 會變，不重算的話標籤停在舊值。
// 只報兩個數字：舊版的「N 引用 · M 新聞」裡那個 M 是 N 的子集，讀起來像有兩批東西。
const hint = computed<Record<ReaderLayer, string>>(() => ({
  report: '',
  evidence: `${props.counts.sources} 來源 · ${props.counts.chains} 連動`,
}))

/**
 * 切層連結只帶站自己的參數。
 *
 * 原本是 `{ ...route.query, ...layerQuery(id) }`——保留既有 query，這樣 `?view=` 不會被洗掉。
 * 代價是任何未知參數都會沿著切層一路傳遞：`/d/2026-09-01?foo=bar` 的兩個 tab href 會是
 * `?foo=bar` 與 `?foo=bar&view=evidence`，讓一個沒有作用的參數看起來像網址的一部分。
 *
 * 現在走 `carriedQuery`——切層與換日共用的單一決定點。要帶別的參數（UTM／`?ref=`）時
 * 加在那個函式裡，兩條路徑會一起拿到；加在這裡只會讓它活過切層、死在換日（曾經就是這樣壞掉的）。
 */
const route = useRoute()
function toLayer(id: ReaderLayer) {
  return { query: carriedQuery(route.query, id) }
}
</script>

<template>
  <nav class="layer-tabs" aria-label="報告層級">
    <div class="brief-frame layer-tabs-inner">
      <RouterLink
        v-for="l in READER_LAYERS"
        :key="l.id"
        class="layer-tab"
        :class="{ current: l.id === props.layer }"
        :to="toLayer(l.id)"
        :aria-current="l.id === props.layer ? 'page' : undefined"
      >
        {{ l.label }}
        <small v-if="hint[l.id]">{{ hint[l.id] }}</small>
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
/* 圖紙的最後一條，不是紙面上的第一條：底色跟著圖紙走，所以捲到頂黏住時，讀者看到的
   仍是「圖區的下緣」而不是一條浮在內容上的工具列。上緣不畫線——它要跟行事曆帶（或圖）
   連續；下緣那條線就是圖區與閱讀區的交界。 */
.layer-tabs {
  position: sticky;
  top: var(--header-h);
  z-index: 15;
  /* 跟 .brief-stage 同一條量度：圖紙色只能鋪在框內，鋪滿視窗就破了「整頁一個寬度」 */
  width: min(100%, var(--measure-frame));
  margin-inline: auto;
  border-bottom: 1px solid var(--border);
  background: var(--chart);
}
.layer-tabs-inner {
  display: flex;
}
.layer-tab {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  margin-right: 30px;
  padding: 14px 0;
  border-bottom: 2px solid transparent;
  color: var(--fg-3);
  font-size: var(--size-small);
  font-weight: 700;
  letter-spacing: 0.01em;
  text-decoration: none;
}
.layer-tab:hover {
  color: var(--fg-1);
}
.layer-tab.current {
  border-bottom-color: var(--warm);
  color: var(--fg-1);
}
.layer-tab small {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
}

@media (max-width: 1023px) {
  .layer-tabs-inner {
    overflow-x: auto;
  }
  .layer-tab {
    margin-right: 22px;
    padding: 12px 0;
    font-size: var(--size-small);
    white-space: nowrap;
  }
  .layer-tab small {
    display: none;
  }
}
</style>
