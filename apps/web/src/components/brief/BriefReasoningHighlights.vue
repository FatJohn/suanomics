<script setup lang="ts">
defineProps<{ steps: string[] }>()
</script>

<template>
  <section v-if="steps.length > 0" class="reasoning-highlights" aria-labelledby="reasoning-highlights-title">
    <header class="reasoning-head">
      <div>
        <p class="reasoning-eyebrow">
          報告採用的主要判斷
        </p>
        <h2 id="reasoning-highlights-title">
          今日推論重點
        </h2>
      </div>
      <span class="reasoning-count">{{ steps.length }} POINTS</span>
    </header>
    <ul class="reasoning-grid">
      <li v-for="(step, index) in steps" :key="`${index}-${step}`">
        <span class="reasoning-marker" aria-hidden="true" />
        <p>{{ step }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reasoning-highlights {
  padding: 20px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.reasoning-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.reasoning-eyebrow {
  margin: 0 0 4px;
  color: var(--fg-3);
  font-size: var(--size-caption);
  letter-spacing: 0.06em;
}
.reasoning-head h2 {
  margin: 0;
  color: var(--fg-1);
  font-family: var(--brief-heading-font, var(--font-display));
  font-size: var(--size-h3);
  line-height: 1.35;
}
.reasoning-count {
  font-family: var(--font-num);
  color: var(--warm);
}
.reasoning-count {
  font-size: var(--size-caption);
  letter-spacing: 0.08em;
}
.reasoning-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0 28px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.reasoning-grid li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  min-width: 0;
  padding: 12px 0;
  border-top: 1px solid var(--border-2);
}
.reasoning-marker {
  width: 6px;
  height: 6px;
  margin-top: 8px;
  border-radius: 999px;
  background: var(--warm);
}
.reasoning-grid p {
  margin: 0;
  color: var(--fg-2);
  font-size: var(--size-small);
  line-height: 1.65;
}

@media (max-width: 1023px) {
  .reasoning-grid {
    grid-template-columns: 1fr;
  }
}
</style>
