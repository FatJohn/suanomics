// 搬自原 apps/server/src/scripts/yt-ingest.ts、
// review 指出為 regression 後補回：pMap 保留 concurrency=3 避免 rate limit、
// filterTranscript 依 segmenter keptTopics 剃掉 joke/ad/chitchat 再餵 lenses、省 token。

export async function pMap<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length })
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const idx = i++
        if (idx >= items.length)
          return
        // eslint-disable-next-line ts/no-non-null-assertion -- idx < items.length guaranteed by guard above
        out[idx] = await fn(items[idx]!)
      }
    }),
  )
  return out
}

export interface FilterTranscriptSegmenter {
  segments: ReadonlyArray<{ startSec: number, endSec: number, topic: string }>
  keptTopics: readonly string[]
}

export function filterTranscript(full: string, segmenter: FilterTranscriptSegmenter): string {
  const kept = new Set(segmenter.keptTopics)
  const keepSpans = segmenter.segments
    .filter(s => kept.has(s.topic))
    .map(s => [s.startSec, s.endSec] as const)
  if (keepSpans.length === 0)
    return full
  const lines = full.split('\n')
  return lines.filter((line) => {
    const m = line.match(/^\[(?:(\d+):)?(\d+):(\d+)\]/)
    if (!m)
      return true
    const h = m[1] ? Number.parseInt(m[1], 10) : 0
    // eslint-disable-next-line ts/no-non-null-assertion -- regex groups 2 and 3 are required (\d+) in the pattern
    const mn = Number.parseInt(m[2]!, 10)
    // eslint-disable-next-line ts/no-non-null-assertion -- regex group 3 is required (\d+) in the pattern
    const s = Number.parseInt(m[3]!, 10)
    const sec = h * 3600 + mn * 60 + s
    return keepSpans.some(([a, b]) => sec >= a && sec < b)
  }).join('\n')
}
