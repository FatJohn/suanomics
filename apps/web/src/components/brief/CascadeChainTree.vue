<script setup lang="ts">
import type { CascadeChain } from '@suanomics/shared'
import { computed, ref, watch } from 'vue'
import { buildDetail, buildMatrix, defaultSelectedIndex } from '@/lib/cascade-matrix.js'
import CascadeChainCard from './CascadeChainCard.vue'

// forceOrder：力場圖上那幾股力的順序。傳進來時連動分組跟著它排，讀者在兩個地方看到
// 的是同一套順序；沒傳就照 chains 裡首次出現的順序。
const props = defineProps<{ chains: CascadeChain[], forceOrder?: string[] | undefined }>()

const selectedIndex = ref(defaultSelectedIndex(props.chains))

watch(() => props.chains, () => {
  selectedIndex.value = defaultSelectedIndex(props.chains)
})

const groups = computed(() => buildMatrix(props.chains, selectedIndex.value, props.forceOrder))
const detail = computed(() => buildDetail(props.chains, selectedIndex.value))
</script>

<template>
  <div class="cascade-matrix">
    <div v-for="group in groups" :key="group.key" class="matrix-group">
      <!-- data-dir 只在依方向分組時有值；依力場分組時整組沒有方向，圓點退成中性 -->
      <div class="group-head" :data-dir="group.dir ?? undefined">
        <span class="group-dot" />
        <span class="group-label">{{ group.label }}</span>
      </div>
      <div class="pill-row">
        <button
          v-for="item in group.items"
          :key="item.index"
          type="button"
          class="pill"
          :data-dir="item.dir"
          :data-selected="item.selected"
          @click="selectedIndex = item.index"
        >
          <span class="pill-arrow">{{ item.arrow }}</span>{{ item.industry }}
          <span v-if="item.dual" class="dual-badge">⇄ 雙向</span>
        </button>
      </div>
    </div>

    <CascadeChainCard v-if="detail" :detail="detail" @select="selectedIndex = $event" />
  </div>
</template>

<style scoped>
.cascade-matrix {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.matrix-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-head {
  /* 力場分組時整組沒有方向，圓點走中性；下面三條只在依方向分組時蓋掉它 */
  --dir-color: var(--fg-3);
  display: flex;
  align-items: center;
  gap: 7px;
}
.group-head[data-dir='up'] {
  --dir-color: var(--dir-up);
}
.group-head[data-dir='down'] {
  --dir-color: var(--dir-down);
}
.group-head[data-dir='neutral'] {
  --dir-color: var(--fg-3);
}
.group-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--dir-color);
}
.group-label {
  font-size: var(--size-caption);
  font-weight: 600;
  color: var(--fg-3);
  letter-spacing: 0.04em;
}
.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 13px;
  border-radius: 999px;
  border: 1.5px solid;
  font-size: var(--size-small);
  font-weight: 600;
  cursor: pointer;
}
.pill-arrow {
  font-size: var(--size-caption);
}
.dual-badge {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
  background: var(--bg-2);
  color: var(--fg-3);
}

.pill[data-dir='up'] {
  background: var(--accent-50);
  border-color: var(--dir-up-br);
  color: var(--dir-up);
}
.pill[data-dir='down'] {
  background: var(--verdict-green-bg);
  border-color: var(--dir-down-br);
  color: var(--dir-down);
}
.pill[data-dir='neutral'] {
  background: var(--dir-neutral-bg);
  border-color: var(--dir-neutral-br);
  color: var(--fg-3);
}
.pill[data-dir='up'][data-selected='true'] {
  background: var(--dir-up);
  border-color: var(--dir-up);
  color: #fff;
}
.pill[data-dir='down'][data-selected='true'] {
  background: var(--dir-down);
  border-color: var(--dir-down);
  color: #fff;
}
.pill[data-dir='neutral'][data-selected='true'] {
  background: var(--fg-3);
  border-color: var(--fg-3);
  color: #fff;
}
.pill[data-selected='true'] .dual-badge {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
</style>
