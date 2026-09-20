<script setup lang="ts">
import type { CascadeDetail } from '@/lib/cascade-matrix.js'

defineOptions({ name: 'CascadeChainCard' })

defineProps<{ detail: CascadeDetail }>()
const emit = defineEmits<{ select: [index: number] }>()
</script>

<template>
  <div class="detail" :data-dir="detail.dir">
    <div class="detail-head">
      <span class="dir-dot" />
      <h4 class="detail-industry">
        {{ detail.industry }}
      </h4>
      <span class="dir-badge">{{ detail.dirLabel }}</span>
      <span class="cite-label">{{ detail.citeLabel }}</span>
    </div>

    <p class="detail-mechanism">
      {{ detail.mechanism }}
    </p>

    <div v-if="detail.tickers.length > 0" class="ticker-row">
      <span v-for="t in detail.tickers" :key="t" class="ticker-chip">{{ t }}</span>
    </div>

    <div
      v-for="(ch, idx) in detail.children"
      :key="`child-${idx}`"
      class="child-card"
      :data-dir="ch.dir"
    >
      <div class="child-head">
        <span class="tier-chip">tier 2</span>
        <span class="child-industry">{{ ch.industry }}</span>
        <span class="child-dir">{{ ch.dirLabel }}</span>
      </div>
      <p class="child-mechanism">
        {{ ch.mechanism }}
      </p>
    </div>

    <div v-if="detail.siblings.length > 0" class="siblings">
      <div class="siblings-head">
        <span class="siblings-arrow">⇄</span>此產業另有 {{ detail.siblings.length }} 條連動
      </div>
      <div class="sibling-list">
        <button
          v-for="sb in detail.siblings"
          :key="sb.index"
          type="button"
          class="sibling-btn"
          @click="emit('select', sb.index)"
        >
          <span class="sibling-badge" :data-dir="sb.dir">{{ sb.dirLabel }}</span>
          <span class="sibling-preview">{{ sb.preview }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail[data-dir='up'] {
  --dir-color: var(--dir-up);
  --dir-bg: var(--accent-50);
}
.detail[data-dir='down'] {
  --dir-color: var(--dir-down);
  --dir-bg: var(--verdict-green-bg);
}
.detail[data-dir='neutral'] {
  --dir-color: var(--fg-3);
  --dir-bg: var(--dir-neutral-bg);
}

.detail {
  padding: 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  /* 穩定高度：切換不同產業時詳情卡高度落差變小、
     降低 sticky 側欄因主欄高度變動而跳動（只是部分緩解） */
  min-height: 220px;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 11px;
}
.dir-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--dir-color);
}
.detail-industry {
  margin: 0;
  font-size: var(--size-body);
  font-weight: 700;
}
.dir-badge {
  font-size: var(--size-caption);
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--dir-bg);
  color: var(--dir-color);
}
.cite-label {
  margin-left: auto;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  color: var(--fg-muted);
}
.detail-mechanism {
  margin: 0 0 14px;
  font-family: var(--font-display);
  font-size: var(--size-small);
  line-height: 1.8;
  color: var(--fg-1);
  max-width: 54ch;
}
.ticker-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.ticker-chip {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  padding: 3px 9px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg-2);
}

.child-card {
  margin-bottom: 11px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: 10px;
}
.child-card[data-dir='up'] {
  --child-dir-color: var(--dir-up);
}
.child-card[data-dir='down'] {
  --child-dir-color: var(--dir-down);
}
.child-card[data-dir='neutral'] {
  --child-dir-color: var(--fg-3);
}
.child-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 5px;
}
.tier-chip {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 600;
  color: var(--fg-3);
  padding: 1px 5px;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.child-industry {
  font-size: var(--size-small);
  font-weight: 600;
}
.child-dir {
  font-size: var(--size-caption);
  font-weight: 600;
  color: var(--child-dir-color);
}
.child-mechanism {
  margin: 0;
  font-size: var(--size-small);
  line-height: 1.6;
  color: var(--fg-3);
}

.siblings {
  margin-top: 2px;
  padding-top: 13px;
  border-top: 1px dashed var(--border);
}
.siblings-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: var(--size-caption);
  font-weight: 600;
  color: var(--fg-3);
}
.siblings-arrow {
  font-size: var(--size-small);
}
.sibling-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.sibling-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}
.sibling-badge {
  font-size: var(--size-caption);
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
}
.sibling-badge[data-dir='up'] {
  background: var(--accent-50);
  color: var(--dir-up);
}
.sibling-badge[data-dir='down'] {
  background: var(--verdict-green-bg);
  color: var(--dir-down);
}
.sibling-badge[data-dir='neutral'] {
  background: var(--dir-neutral-bg);
  color: var(--fg-3);
}
.sibling-preview {
  max-width: 28ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--size-small);
  color: var(--fg-2);
}
</style>
