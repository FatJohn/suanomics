<script setup lang="ts">
import type { PodcastPlayer } from '@/composables/usePodcastPlayer.js'
import { formatTime } from '@/lib/podcast-timeline.js'

/** 逐字稿展開層。它是常駐播放器上方的一層，不是獨立面板——全站只有這一個逐字稿入口。 */
const props = defineProps<{
  player: PodcastPlayer
  hasAudio: boolean
}>()

function lineState(i: number): 'active' | 'played' | 'upcoming' {
  if (i === props.player.activeIndex)
    return 'active'
  if (i < props.player.activeIndex)
    return 'played'
  return 'upcoming'
}
</script>

<template>
  <section class="sheet" aria-label="逐字稿">
    <header class="sheet-head">
      <span class="sheet-title">逐字稿</span>
      <span v-if="props.hasAudio" class="sheet-hint">點任一句跳播</span>
      <span v-else class="sheet-hint">本日音檔尚未生成</span>
    </header>
    <div class="sheet-lines">
      <button
        v-for="(seg, i) in player.segments"
        :key="i"
        class="line"
        :class="lineState(i)"
        type="button"
        :disabled="!props.hasAudio"
        @click="player.seek(seg.startSec)"
      >
        <span class="line-time">{{ formatTime(seg.startSec) }}</span>
        <span class="line-text">{{ seg.text }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.sheet {
  background: var(--dock-bg);
  color: var(--dock-fg);
  border-top: 1px solid var(--dock-hair);
  max-height: min(52vh, 460px);
  overflow-y: auto;
  padding: 14px 24px 8px;
}
.sheet-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}
.sheet-title {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dock-fg-3);
}
.sheet-hint {
  font-size: var(--size-caption);
  color: var(--dock-fg-3);
}
.sheet-lines {
  display: flex;
  flex-direction: column;
}
.line {
  display: flex;
  gap: 14px;
  align-items: baseline;
  text-align: left;
  border: 0;
  border-top: 1px solid var(--dock-hair);
  background: transparent;
  padding: 9px 4px;
  cursor: pointer;
  color: inherit;
}
.line:first-child {
  border-top: 0;
}
.line:disabled {
  cursor: default;
}
.line-time {
  flex-shrink: 0;
  width: 40px;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  color: var(--dock-fg-3);
  font-variant-numeric: tabular-nums;
}
.line-text {
  font-size: var(--size-small);
  line-height: 1.75;
  color: var(--dock-fg-2);
}
.line.played .line-text {
  color: var(--dock-fg-3);
}
.line.active .line-time {
  color: var(--warm);
}
.line.active .line-text {
  color: var(--dock-fg);
  font-weight: 700;
}

@media (max-width: 719px) {
  .sheet {
    padding: 12px 14px 6px;
  }
}
</style>
