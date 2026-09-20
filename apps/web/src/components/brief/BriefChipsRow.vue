<script setup lang="ts">
import type { MarketBrief } from '@suanomics/shared'
import type { DirKey } from '@/lib/cascade-matrix.js'
import { dirArrow } from '@/lib/cascade-matrix.js'

type IndustryDirection = MarketBrief['affectedIndustries'][number]['direction']

const props = defineProps<{
  industries: MarketBrief['affectedIndustries']
}>()

// affectedIndustries 的 direction 有 4 態、晶片只用方向 3 態著色
function toDir(direction: IndustryDirection): DirKey {
  if (direction === 'positive')
    return 'up'
  if (direction === 'negative')
    return 'down'
  return 'neutral'
}
</script>

<template>
  <div
    v-if="props.industries.length > 0"
    class="chips-row"
  >
    <span
      v-for="ind in props.industries"
      :key="ind.name"
      class="chip"
      :data-dir="toDir(ind.direction)"
    >
      <span class="chip-arrow">{{ dirArrow(toDir(ind.direction)) }}</span>{{ ind.name }}
    </span>
  </div>
</template>

<style scoped>
.chips-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: var(--size-small);
  font-weight: 600;
}
.chip-arrow {
  font-size: var(--size-caption);
}
.chip[data-dir='up'] {
  background: var(--accent-50);
  color: var(--dir-up);
}
.chip[data-dir='down'] {
  background: var(--verdict-green-bg);
  color: var(--dir-down);
}
.chip[data-dir='neutral'] {
  background: var(--dir-neutral-bg);
  color: var(--fg-3);
}
</style>
