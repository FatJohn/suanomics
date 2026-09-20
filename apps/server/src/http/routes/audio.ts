import { readFile } from 'node:fs/promises'
import { PODCAST_AUDIO_CONTENT_TYPE, PODCAST_AUDIO_EXT } from '@suanomics/db/storage/podcast-audio-format'
import { getPodcastStorage, LocalPodcastStorage } from '@suanomics/db/storage/podcast-storage'
import { S3PodcastStorage } from '@suanomics/db/storage/s3-podcast-storage'
import { Hono } from 'hono'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// 從常數動態組 filename regex，確保副檔名與 SSOT 一致
const FILENAME_RE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})\\.${PODCAST_AUDIO_EXT}$`)

export const audioRoute = new Hono()

audioRoute.get('/audio/podcast/:filename', async (c) => {
  const filename = c.req.param('filename')
  const match = filename.match(FILENAME_RE)
  if (!match)
    return c.json({ error: 'invalid_filename' }, 400)
  // eslint-disable-next-line ts/no-non-null-assertion -- regex capture group 1 is guaranteed by the match check above
  const date = match[1]!
  if (!DATE_RE.test(date))
    return c.json({ error: 'invalid_date' }, 400)

  const storage = getPodcastStorage()

  // S3：redirect 到 R2 public URL（不打 R2、api 不持有 creds、檔不存在交給 R2 自身 404）
  if (storage instanceof S3PodcastStorage) {
    const url = await storage.urlFor(date)
    // urlFor 對 S3 一定回字串、不會 null
    return c.redirect(url ?? '', 302)
  }

  // Local：從容器本地 disk stream（dev / 向後相容）
  if (!(storage instanceof LocalPodcastStorage))
    return c.json({ error: 'unsupported_storage' }, 500)

  if (!(await storage.exists(date)))
    return c.json({ error: 'not_found' }, 404)

  const buf = await readFile(storage.readFilePath(date))
  return c.body(buf, 200, {
    'content-type': PODCAST_AUDIO_CONTENT_TYPE,
    'cache-control': 'public, max-age=300',
  })
})
