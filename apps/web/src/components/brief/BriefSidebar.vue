<script setup lang="ts">
import type { Narrative } from '@suanomics/shared'
import { sectionDomId, sectionLabel } from '@/lib/narrative-nav.js'

// podcast 章節跳播已隨常駐播放器搬進逐字稿展開層、盤面數字已移到力場圖底緣，
// 這裡只剩閱讀目錄。
defineProps<{
  sections: Narrative['sections']
}>()

// 閱讀模式目錄跳轉：用 scrollTo + 偏移清過 sticky header、
// header 高度讀 --header-h token、再加一點呼吸間距、
// 不用 scrollIntoView（無法精準控制 sticky header 的遮擋偏移）
function scrollToSection(i: number): void {
  const el = document.getElementById(sectionDomId(i))
  if (el) {
    const headerH = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h'), 10) || 72
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - headerH - 16,
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }
}
</script>

<template>
  <aside class="sidebar">
    <!-- Card 1：情境導覽（閱讀＝目錄、Podcast＝章節跳播） -->
    <div class="nav-card">
      <div class="nav-title">
        本篇目錄
      </div>
      <div class="nav-list" aria-label="報告章節導覽，可水平捲動" tabindex="0">
        <button
          v-for="(s, i) in sections"
          :key="i"
          type="button"
          class="nav-item"
          @click="scrollToSection(i)"
        >
          <span class="nav-num">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="nav-label">{{ sectionLabel(s.heading, s.body, i) }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: sticky;
  top: calc(var(--header-h) + 16px);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ===== Card 1：情境導覽 ===== */
.nav-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: var(--shadow-xs);
}
.nav-title {
  margin-bottom: 10px;
  font-size: var(--size-caption);
  font-weight: 600;
  color: var(--fg-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nav-item {
  display: flex;
  gap: 10px;
  align-items: baseline;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  min-height: 44px;
  cursor: pointer;
  transition: background var(--dur-base) var(--ease-out);
}
.nav-item:hover {
  background: var(--bg-2);
}
.nav-item.active {
  background: var(--accent-50);
}
.nav-num {
  flex-shrink: 0;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  color: var(--accent);
}
.nav-label {
  font-size: var(--size-small);
  line-height: 1.45;
  font-weight: 500;
  color: var(--fg-2);
}
.nav-item.active .nav-label {
  font-weight: 600;
  color: var(--fg-1);
}

@media (max-width: 1023px) {
  .sidebar {
    position: static;
  }
  .nav-card {
    padding: 12px 0;
    border-width: 1px 0;
    border-radius: 0;
    box-shadow: none;
  }
  .nav-list {
    flex-direction: row;
    gap: 6px;
    overflow-x: auto;
    padding: 3px;
    -webkit-overflow-scrolling: touch;
  }
  .nav-list:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .nav-item {
    flex: 0 0 auto;
    max-width: 260px;
    align-items: center;
  }
  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
