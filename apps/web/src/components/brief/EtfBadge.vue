<script setup lang="ts">
defineProps<{ ticker: string, name: string }>()
</script>

<template>
  <span class="etf-badge">
    <span class="etf-ticker mono">{{ ticker }}</span>
    <span class="etf-name">{{ name }}</span>
  </span>
</template>

<style scoped>
.etf-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--surface);
  font: inherit;
  color: inherit;
  font-size: var(--size-small);
}
.etf-ticker {
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--accent);
}
.etf-name {
  color: var(--fg-2);
  font-size: var(--size-small);
}
</style>
