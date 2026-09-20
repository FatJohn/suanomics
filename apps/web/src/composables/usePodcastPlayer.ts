import type { Podcast } from '@suanomics/shared'
import type { Ref } from 'vue'
import { computed, reactive, ref } from 'vue'
import { activeSegmentIndex, buildSegments, formatTime, nextRate, waveformBars, withEstimatedTimes } from '@/lib/podcast-timeline.js'

const WAVE_BAR_COUNT = 56

export function usePodcastPlayer(podcast: Ref<Podcast | null>) {
  const audioEl = ref<HTMLAudioElement | null>(null)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const playbackRate = ref(1)

  const segments = computed(() => {
    const p = podcast.value
    return p ? withEstimatedTimes(buildSegments(p), duration.value) : []
  })
  const activeIndex = computed(() => activeSegmentIndex(segments.value, currentTime.value))
  const waveBars = computed(() => waveformBars(WAVE_BAR_COUNT))
  const progress = computed(() => (duration.value > 0 ? currentTime.value / duration.value : 0))
  const currentLabel = computed(() => formatTime(currentTime.value))
  const durationLabel = computed(() => formatTime(duration.value))
  const rateLabel = computed(() => `${playbackRate.value}×`)

  function registerAudio(el: HTMLAudioElement | null): void {
    if (el === audioEl.value)
      return
    audioEl.value = el
    if (!el) {
      isPlaying.value = false
      currentTime.value = 0
      duration.value = 0
      return
    }
    el.playbackRate = playbackRate.value
  }
  function onLoadedMetadata(): void {
    if (audioEl.value)
      duration.value = audioEl.value.duration
  }
  function onTimeUpdate(): void {
    if (audioEl.value)
      currentTime.value = audioEl.value.currentTime
  }
  function onEnded(): void {
    isPlaying.value = false
  }

  function toggle(): void {
    const el = audioEl.value
    if (!el)
      return
    if (el.paused) {
      void el.play()
      isPlaying.value = true
    }
    else {
      el.pause()
      isPlaying.value = false
    }
  }
  function seek(sec: number): void {
    const el = audioEl.value
    if (!el)
      return
    el.currentTime = sec
    currentTime.value = sec
  }
  function seekRatio(ratio: number): void {
    seek(Math.max(0, Math.min(1, ratio)) * duration.value)
  }
  function cycleRate(): void {
    const r = nextRate(playbackRate.value)
    playbackRate.value = r
    if (audioEl.value)
      audioEl.value.playbackRate = r
  }

  return reactive({
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    segments,
    activeIndex,
    waveBars,
    progress,
    currentLabel,
    durationLabel,
    rateLabel,
    registerAudio,
    onLoadedMetadata,
    onTimeUpdate,
    onEnded,
    toggle,
    seek,
    seekRatio,
    cycleRate,
  })
}

export type PodcastPlayer = ReturnType<typeof usePodcastPlayer>
