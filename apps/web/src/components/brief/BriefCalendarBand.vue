<script setup lang="ts">
import type { CalendarBandEvent, CalendarBandNote } from '@/lib/calendar-band.js'
import { calendarDayLabel } from '@/lib/calendar-band.js'

/**
 * 首屏下緣的「接下來會來的」時間軸帶。
 *
 * 資料路：worker 產 brief 時把 7 天窗內的事件存進 `briefJson.calendarEvents`（與餵給
 * LLM 的 calendarBlock 出自同一次載入），API 整包直傳，HomeView 用 `toCalendarBandEvents`
 * 轉成這裡要的形狀。沒有事件、也沒有註記時整條帶不渲染、不留空殼——讀者面不放「今天沒有」
 * 這種對外沒有意義的字。
 *
 * `notes` 是公司事件來源的涵蓋範圍註記（補產超出來源射程）。少了它，
 * 「來源查不到」與「那週真的沒事」在這條帶上長得一樣。★ 最需要註記的情況正好是窗內零事件，
 * 所以是否渲染不能只看 events。`notes` 刻意是必填 prop：上游漏接時要讓 vue-tsc 紅。
 */
const props = defineProps<{ events: CalendarBandEvent[], notes: CalendarBandNote[] }>()
</script>

<template>
  <section
    v-if="props.events.length > 0 || props.notes.length > 0"
    class="band"
    aria-label="接下來的重要事件"
  >
    <div class="band-row">
      <span class="band-kicker">接下來會來的</span>
      <div v-if="props.events.length > 0" class="band-track">
        <div
          v-for="(e, i) in props.events"
          :key="`${e.date}-${i}`"
          class="band-item"
          :class="{ alert: e.alert }"
        >
          <span class="band-day">{{ calendarDayLabel(e.date) }}</span>
          <span class="band-title">{{ e.title }}</span>
        </div>
      </div>
    </div>
    <ul v-if="props.notes.length > 0" class="band-notes">
      <li v-for="n in props.notes" :key="n.category">
        {{ n.text }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.band {
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.band-row {
  display: flex;
  align-items: stretch;
}
.band-notes {
  margin: 0;
  padding: 8px 16px;
  border-top: 1px solid var(--border-2);
  list-style: none;
  font-size: var(--size-caption);
  line-height: 1.6;
  color: var(--fg-3);
}
.band-kicker {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 10px 16px;
  border-right: 1px solid var(--border-2);
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-3);
  white-space: nowrap;
}
.band-track {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.band-item {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 16px;
  border-left: 1px solid var(--border-2);
}
.band-item:first-child {
  border-left: 0;
}
.band-day {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--fg-3);
}
.band-item.alert .band-day {
  color: var(--warn);
}
.band-title {
  font-size: var(--size-small);
  color: var(--fg-2);
  white-space: nowrap;
}

@media (max-width: 719px) {
  .band-kicker {
    padding: 8px 10px;
    font-size: var(--size-caption);
  }
  .band-item {
    padding: 7px 10px;
  }
  .band-notes {
    padding: 7px 10px;
  }
}
</style>
