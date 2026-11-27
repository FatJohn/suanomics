import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createPodcastDeps } from './podcast.deps.js'
import { putR2Object } from './r2-upload.js'

vi.mock('./r2-upload.js', () => ({ putR2Object: vi.fn(async () => {}) }))

const ENV = {
  azure: { key: 'k', region: 'eastasia' },
  r2: { accountId: 'a', accessKeyId: 'id', secretAccessKey: 's', bucket: 'b' },
  publicBaseUrl: 'https://audio.example.com',
}

describe('createPodcastDeps upload', () => {
  it('每次上傳用不同的物件 key，網址指向該 key：舊 run 的上傳蓋不到新音檔（#132）', async () => {
    const { upload } = createPodcastDeps(ENV)
    const first = await upload('podcasts/2026-11-26.mp3', Buffer.from([1]))
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await upload('podcasts/2026-11-26.mp3', Buffer.from([2]))
    const keys = vi.mocked(putR2Object).mock.calls.map(c => c[1].key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    for (const key of keys)
      expect(key).toMatch(/^podcasts\/2026-11-26-[a-z0-9]+\.mp3$/)
    expect([first, second]).toEqual(keys.map(k => `https://audio.example.com/${k}`))
  })
})
