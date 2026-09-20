import type { Podcast } from '@suanomics/shared'

export const DEFAULT_MAX_CHARS = 400

// 整集全文（hook → acts → takeaway、雙換行分段）。給穩定、可吃長文的 provider
// （如 Azure）整集一次送用；不含 actTitle / citationUrls（音檔不念這些）。
export function buildFullScript(podcast: Podcast): string {
  return [
    podcast.hook.body,
    ...podcast.acts.map(act => act.body),
    podcast.takeaway.body,
  ].join('\n\n')
}

export interface PodcastSegment {
  text: string
  section: 'hook' | 'act' | 'takeaway'
  sectionIndex: number
}

// 以句界（。！？或換行）切句、保留結尾標點；trailing 餘字也成一句。
function splitSentences(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of text) {
    cur += ch
    if (ch === '。' || ch === '！' || ch === '？' || ch === '\n') {
      if (cur.trim().length > 0)
        out.push(cur)
      cur = ''
    }
  }
  if (cur.trim().length > 0)
    out.push(cur)
  return out
}

// 把一段文字依 maxChars 貪婪聚合成多塊；單句超過 cap 時整句自成一塊（不切句中）。
function chunkBySentences(body: string, maxChars: number): string[] {
  const chunks: string[] = []
  let cur = ''
  for (const sentence of splitSentences(body)) {
    if (cur === '') {
      cur = sentence
    }
    else if (cur.length + sentence.length <= maxChars) {
      cur += sentence
    }
    else {
      chunks.push(cur)
      cur = sentence
    }
  }
  if (cur !== '')
    chunks.push(cur)
  return chunks
}

// 把 Podcast 切成有序的 TTS 段：先按 section（hook / 每個 act / takeaway），
// 超過 maxChars 的 section 再在句界細切。保留 section 對應供時間碼用。
export function segmentPodcastScript(
  podcast: Podcast,
  opts: { maxChars?: number } = {},
): PodcastSegment[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const sections: Array<{ section: PodcastSegment['section'], sectionIndex: number, body: string }> = [
    { section: 'hook', sectionIndex: 0, body: podcast.hook.body },
    ...podcast.acts.map((a, i) => ({ section: 'act' as const, sectionIndex: i, body: a.body })),
    { section: 'takeaway', sectionIndex: 0, body: podcast.takeaway.body },
  ]
  const segments: PodcastSegment[] = []
  for (const s of sections) {
    const chunks = s.body.length <= maxChars ? [s.body] : chunkBySentences(s.body, maxChars)
    for (const text of chunks)
      segments.push({ text, section: s.section, sectionIndex: s.sectionIndex })
  }
  return segments
}
