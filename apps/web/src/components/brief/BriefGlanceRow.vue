<script setup lang="ts">
import type { MarketBrief } from '@suanomics/shared'
import BriefChipsRow from './BriefChipsRow.vue'

/**
 * 圖下的一瞥列：受影響產業 chips 與當日統計。
 *
 * 這個元件原本是 BriefHero，同時扛標題、論點、chips 與動作。改版後
 * 標題與本日論點移進力場圖的 overlay（它們是圖的一部分，不是圖下的一列），
 * 這裡只留「掃一眼就知道今天涵蓋什麼」的資訊。
 */
const props = defineProps<{
  meta: { news: number, sections: number, citations: number, minutes: number }
  industries: MarketBrief['affectedIndustries']
}>()
</script>

<template>
  <section class="glance">
    <div class="glance-main">
      <BriefChipsRow class="glance-chips" :industries="props.industries" />
      <span class="glance-meta">
        {{ props.meta.news }} 則精選 · {{ props.meta.sections }} 主題 · {{ props.meta.citations }} 引用 · 約 {{ props.meta.minutes }} 分鐘
      </span>
    </div>
    <slot name="actions" />
  </section>
</template>

<style scoped>
.glance {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 0 20px;
  border-bottom: 1px solid var(--border);
}
.glance-main {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-width: 0;
}
.glance-chips {
  display: contents;
}
.glance-meta {
  flex-basis: 100%;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.02em;
  color: var(--fg-3);
  margin-top: 2px;
}

@media (max-width: 719px) {
  .glance {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
    padding: 14px 0 16px;
  }
}
</style>
