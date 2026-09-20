<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import BriefDateSwitcher from '@/components/brief/BriefDateSwitcher.vue'
import { useBriefStore } from '@/stores/brief.js'

const store = useBriefStore()
const route = useRoute()

const showSwitcher = computed(
  () => (route.name === 'home' || route.name === 'home-dated') && store.availableDates.length > 0,
)
const isHome = computed(() => route.name === 'home' || route.name === 'home-dated')
</script>

<template>
  <header class="masthead" :class="{ 'masthead-home': isHome }">
    <div class="masthead-inner">
      <RouterLink to="/" class="brand">
        <img src="/logo-mark.png" alt="掐指連總經 Suanomics" class="brand-logo-img" width="36" height="36">
        <span class="brand-name">掐指連總經</span>
        <span class="brand-en">Suanomics</span>
      </RouterLink>
      <div class="masthead-right">
        <span class="masthead-tag">每日總經新聞簡報</span>
        <BriefDateSwitcher
          v-if="showSwitcher"
          :dates="store.availableDates"
          :current="store.daily?.brief?.briefDate"
          :latest="store.availableDates[0]"
        />
      </div>
    </div>
  </header>
</template>

<style scoped>
.masthead {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(8px);
}
/* 綁 --measure-frame／--frame-pad（main.css 的 :root）：masthead 的橫條本身滿版，
   但裡面的內容要跟圖紙、讀數帶、散文欄站在同一組左右邊界上。原本是寫死的 1080、
   首頁再覆寫成 1200，於是 3440 上品牌 logo 落在內容欄之外 114px——螢幕越寬越明顯。 */
.masthead-inner {
  max-width: var(--measure-frame);
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 13px var(--frame-pad);
}
.masthead-home .masthead-inner {
  padding-block: 7px;
}
.masthead-home .masthead-right {
  gap: 20px;
}
.brand {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 10px;
  align-items: center;
  text-decoration: none;
}
.brand-logo-img {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
  display: block;
  object-fit: cover;
  grid-column: 1;
  grid-row: 1 / 3;
  align-self: center;
}
.brand-name {
  font-family: var(--font-display);
  font-weight: 900;
  font-size: var(--size-h3);
  letter-spacing: 0.04em;
  color: var(--fg-1);
  white-space: nowrap;
  grid-column: 2;
  grid-row: 1;
  align-self: end;
  line-height: 1.1;
}
.brand-en {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.06em;
  color: var(--accent);
  grid-column: 2;
  grid-row: 2;
  align-self: start;
  line-height: 1.2;
  margin-top: 1px;
}
.masthead-right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.masthead-tag {
  font-size: var(--size-small);
  color: var(--fg-3);
  white-space: nowrap;
}

@media (max-width: 719px) {
  .masthead-inner {
    gap: 10px;
    padding: 11px var(--frame-pad);
  }
  .masthead-tag {
    display: none;
  }
}

@media (max-width: 419px) {
  .brand-name {
    font-size: var(--size-body-lg);
  }
  .brand-en {
    font-size: var(--size-caption);
  }
}
</style>
