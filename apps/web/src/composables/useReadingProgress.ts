import { onMounted, onUnmounted, ref } from 'vue'
import { readingProgress } from '@/lib/reading-progress.js'

/** 捲動驅動的已讀比例 0..1。算術在 lib/reading-progress、這裡只負責讀 DOM 與掛事件。 */
export function useReadingProgress() {
  const progress = ref(0)

  function update() {
    progress.value = readingProgress(
      window.scrollY,
      window.innerHeight,
      document.documentElement.scrollHeight,
    )
  }

  onMounted(() => {
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
  })
  onUnmounted(() => {
    window.removeEventListener('scroll', update)
    window.removeEventListener('resize', update)
  })

  return { progress, update }
}
