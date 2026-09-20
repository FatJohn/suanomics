<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatMonthDay } from '@/lib/format-date.js'
import { carriedQuery } from '@/lib/reader-layer.js'

const props = defineProps<{ dates: string[], current: string | undefined, latest: string | undefined }>()
const router = useRouter()
const route = useRoute()
const showPicker = ref(false)
const wrapRef = ref<HTMLElement | null>(null)
const currentIndex = computed(() => (props.current ? props.dates.indexOf(props.current) : -1))
const olderTarget = computed(() => props.dates[currentIndex.value + 1])
const newerTarget = computed(() => props.dates[currentIndex.value - 1])

// 換日帶著現在那層走：讀者在佐證層比較兩天的來源是合理動作，原本會被丟回報告層。
// 帶哪些 query 由 carriedQuery 決定，與切層同一處。
function go(target: string | undefined): void {
  if (!target)
    return
  void router.push({ path: target === props.latest ? '/' : `/d/${target}`, query: carriedQuery(route.query) })
  showPicker.value = false
}

const pickerYear = ref(new Date().getFullYear())
const pickerMonth = ref(new Date().getMonth())
const availableSet = computed(() => new Set(props.dates))

function openPicker(): void {
  if (props.current) {
    const parts = props.current.split('-')
    pickerYear.value = Number(parts[0] ?? String(new Date().getFullYear()))
    pickerMonth.value = Number(parts[1] ?? '1') - 1
  }
  showPicker.value = !showPicker.value
}

function shiftMonth(delta: number): void {
  const d = new Date(pickerYear.value, pickerMonth.value + delta, 1)
  pickerYear.value = d.getFullYear()
  pickerMonth.value = d.getMonth()
}

const calCells = computed((): Array<string | null> => {
  const y = pickerYear.value
  const m = pickerMonth.value
  const offset = (new Date(y, m, 1).getDay() + 6) % 7
  const total = new Date(y, m + 1, 0).getDate()
  const cells: Array<string | null> = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= total; d++) {
    cells.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return cells
})

const monthLabel = computed(() =>
  new Date(pickerYear.value, pickerMonth.value, 1)
    .toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' }),
)
function onDocDown(e: PointerEvent): void {
  if (wrapRef.value && !wrapRef.value.contains(e.target as Node))
    showPicker.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDocDown, { capture: true }))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocDown, { capture: true }))
</script>

<template>
  <div ref="wrapRef" class="ds-wrap">
    <div class="date-switcher">
      <button type="button" class="ds-nav" :disabled="!olderTarget" aria-label="看更舊的簡報" @click="go(olderTarget)">
        ‹
      </button>
      <button type="button" class="ds-date-btn" :aria-expanded="showPicker" aria-haspopup="true" @click="openPicker">
        <span class="ds-date-text">{{ current ? formatMonthDay(current) : '—' }}</span>
        <span class="ds-caret" :class="{ open: showPicker }">▾</span>
      </button>
      <button type="button" class="ds-nav" :disabled="!newerTarget" aria-label="看更新的簡報" @click="go(newerTarget)">
        ›
      </button>
    </div>
    <Transition name="ds-fade">
      <div v-if="showPicker" class="ds-picker" role="dialog" aria-label="選擇日期">
        <div class="ds-cal-hd">
          <button type="button" class="ds-mnav" aria-label="上個月" @click="shiftMonth(-1)">
            ‹
          </button>
          <span class="ds-mlabel">{{ monthLabel }}</span>
          <button type="button" class="ds-mnav" aria-label="下個月" @click="shiftMonth(1)">
            ›
          </button>
        </div>
        <div class="ds-wdays">
          <span v-for="wd in ['一', '二', '三', '四', '五', '六', '日']" :key="wd">{{ wd }}</span>
        </div>
        <div class="ds-grid">
          <button
            v-for="(cell, i) in calCells"
            :key="i"
            type="button"
            class="ds-day"
            :class="{ empty: !cell, avail: cell !== null && availableSet.has(cell), cur: cell === current }"
            :disabled="!cell || !availableSet.has(cell)"
            @click="go(cell ?? undefined)"
          >
            {{ cell ? +cell.slice(8) : '' }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ds-wrap {
  position: relative;
  display: inline-block;
}
.date-switcher {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px;
}
.ds-nav {
  position: relative;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 999px;
  border: none;
  background: var(--bg-2);
  color: var(--fg-3);
  font-size: var(--size-small);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s ease,
    color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.ds-nav::before {
  content: '';
  position: absolute;
  inset: -8px;
}
.ds-nav:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.ds-nav:not(:disabled):hover,
.ds-nav:not(:disabled):active {
  background: color-mix(in srgb, var(--fg-1) 10%, var(--bg-2));
  color: var(--fg-1);
}
.ds-date-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 9px;
  border: none;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.ds-date-btn:hover {
  background: var(--bg-2);
}
.ds-date-text {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 600;
  color: var(--fg-1);
  white-space: nowrap;
}
.ds-caret {
  font-size: var(--size-caption);
  color: var(--fg-3);
  transition: transform 0.15s ease;
}
.ds-caret.open {
  transform: rotate(180deg);
}
.ds-picker {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 200;
  width: 228px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px;
  box-shadow: var(--shadow-lg);
}
.ds-cal-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ds-mlabel {
  font-size: var(--size-small);
  font-weight: 600;
  color: var(--fg-1);
}
.ds-mnav {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: var(--bg-2);
  color: var(--fg-3);
  font-size: var(--size-small);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s ease,
    color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}
.ds-mnav:hover {
  background: color-mix(in srgb, var(--fg-1) 10%, var(--bg-2));
  color: var(--fg-1);
}
.ds-wdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 4px;
}
.ds-wdays span {
  text-align: center;
  font-size: var(--size-caption);
  color: var(--fg-3);
  padding-bottom: 4px;
}
.ds-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.ds-day {
  aspect-ratio: 1;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  color: var(--fg-3);
  opacity: 0.3;
  cursor: not-allowed;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.ds-day.empty {
  visibility: hidden;
}
.ds-day.avail {
  color: var(--fg-1);
  font-weight: 600;
  opacity: 1;
  cursor: pointer;
  transition: background 0.12s ease;
}
.ds-day.avail:hover {
  background: var(--bg-2);
}
.ds-day.cur,
.ds-day.cur:hover {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  opacity: 1;
}
.ds-fade-enter-active,
.ds-fade-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.ds-fade-enter-from,
.ds-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
