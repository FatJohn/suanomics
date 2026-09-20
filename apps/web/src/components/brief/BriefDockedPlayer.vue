<script setup lang="ts">
import type { Podcast } from '@suanomics/shared'
import type { PodcastPlayer } from '@/composables/usePodcastPlayer.js'
import { Icon } from '@iconify/vue'
import { ref } from 'vue'
import BriefTranscriptSheet from './BriefTranscriptSheet.vue'

/**
 * 常駐底部的播報列。像音樂播放器：捲到哪它都在，播放不會因為換頁面區塊而中斷。
 * 逐字稿是這裡唯一的入口——它從一級面板降級成這條列上方的展開層。
 */
const props = defineProps<{
  player: PodcastPlayer
  podcast: Podcast | null
  audioUrl: string | null
}>()

const transcriptOpen = ref(false)

// 點進度條 → 依點擊 x 在容器內的比例換算 seek ratio
function onSeekBar(e: MouseEvent): void {
  if (!props.audioUrl)
    return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  if (rect.width <= 0)
    return
  props.player.seekRatio((e.clientX - rect.left) / rect.width)
}
</script>

<template>
  <div v-if="podcast" class="dock">
    <!-- hidden <audio>：自訂控制鈕驅動、僅在有音檔時掛載 -->
    <audio
      v-if="audioUrl"
      :ref="el => player.registerAudio(el as HTMLAudioElement | null)"
      :src="audioUrl"
      preload="metadata"
      class="dock-audio"
      @loadedmetadata="player.onLoadedMetadata"
      @timeupdate="player.onTimeUpdate"
      @ended="player.onEnded"
    />

    <BriefTranscriptSheet v-if="transcriptOpen" :player="player" :has-audio="!!audioUrl" />

    <div class="bar">
      <button
        class="dock-play"
        type="button"
        :disabled="!audioUrl"
        :aria-label="player.isPlaying ? '暫停' : '播放'"
        @click="player.toggle()"
      >
        <Icon :icon="player.isPlaying ? 'lucide:pause' : 'lucide:play'" :width="16" :height="16" />
      </button>

      <div class="dock-info">
        <span class="dock-kicker">本日播報 · 賽博半仙</span>
        <span class="dock-name">{{ podcast.hook.headline }}</span>
      </div>

      <div class="dock-progress">
        <span class="dock-time">{{ player.currentLabel }}</span>
        <div class="dock-track" @click="onSeekBar">
          <span class="dock-track-fill" :style="{ transform: `scaleX(${player.progress})` }" />
        </div>
        <span class="dock-time">{{ player.durationLabel }}</span>
      </div>

      <button
        class="dock-transcript"
        type="button"
        :aria-expanded="transcriptOpen"
        @click="transcriptOpen = !transcriptOpen"
      >
        {{ transcriptOpen ? '收起逐字稿' : '逐字稿' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dock-audio {
  display: none;
}
.dock {
  /* 播報列是頁面上唯一的深色器械：深墨底、白字，見 DESIGN.md 的 docked-player。
     階層靠白字的透明度分，不靠另外幾支 token。 */
  --dock-bg: var(--action);
  --dock-fg: var(--action-fg);
  --dock-fg-2: rgba(255, 255, 255, 0.78);
  --dock-fg-3: rgba(255, 255, 255, 0.55);
  --dock-hair: rgba(255, 255, 255, 0.18);
  --dock-hair-2: rgba(255, 255, 255, 0.32);
  position: fixed;
  inset: auto 0 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
}

/* ── 播報列 ── */
.bar {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 11px 24px;
  background: var(--dock-bg);
  color: var(--dock-fg);
  border-top: 1px solid var(--dock-hair);
}
.dock-play {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: 0;
  border-radius: 999px;
  background: var(--warm);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dock-play:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.dock-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 260px;
}
.dock-kicker {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--dock-fg-3);
}
.dock-name {
  font-size: var(--size-small);
  font-weight: 700;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dock-progress {
  display: flex;
  align-items: center;
  gap: 11px;
  flex: 1;
  min-width: 0;
}
.dock-time {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.05em;
  color: var(--dock-fg-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.dock-track {
  flex: 1;
  min-width: 60px;
  height: 3px;
  background: var(--dock-hair);
  cursor: pointer;
  position: relative;
}
.dock-track-fill {
  position: absolute;
  inset: 0;
  background: var(--warm);
  transform-origin: left center;
}
.dock-transcript {
  flex-shrink: 0;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.1em;
  color: var(--dock-fg-2);
  background: none;
  border: 1px solid var(--dock-hair-2);
  padding: 5px 9px;
  cursor: pointer;
  white-space: nowrap;
}
.dock-transcript:hover {
  color: var(--dock-fg);
  border-color: var(--dock-fg-3);
}

@media (max-width: 719px) {
  .bar {
    gap: 10px;
    padding: 9px 14px;
    align-items: center;
  }
  /* 390 放不下「資訊 + 進度 + 按鈕」一排：進度整組換到第二行、佔滿寬度 */
  .bar {
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .dock-info {
    width: auto;
    flex: 1;
  }
  .dock-progress {
    order: 1;
    flex-basis: 100%;
  }
}
</style>
