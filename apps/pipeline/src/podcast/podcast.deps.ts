import type { PodcastEnv } from './env.js'
import type { PodcastDeps } from './run.js'
import { callPodcastWriter } from '../agents/podcast-writer.js'
import { getDailyBriefByDate } from '../db/repos/news-repo.js'
import { savePodcastAudio, savePodcastJson } from '../db/repos/podcast-repo.js'
import { synthesizeAzure } from './azure-tts-client.js'
import { podcastContextFromRunInputs } from './context.js'
import { putR2Object } from './r2-upload.js'

export function createPodcastDeps(env: PodcastEnv): PodcastDeps {
  return {
    loadRow: getDailyBriefByDate,
    writeScript: async (date, brief, runInputs) => {
      const result = await callPodcastWriter({ briefDate: date, brief, ...podcastContextFromRunInputs(runInputs, date) })
      console.warn(JSON.stringify({ event: 'podcast_writer_audit', date, ...result.audit }))
      return result.podcast
    },
    savePodcast: savePodcastJson,
    synthesize: ssml => synthesizeAzure({ ssml, ...env.azure }),
    upload: async (key, mp3) => {
      // 版本放進物件 key 而不是 query string：寫稿期間 brief 被重跑時，舊 run 晚到的上傳蓋不到新音檔（#132）；
      // 每個版本網址不同，CDN 也不會播到舊檔。代價是同一天 --force 重產會在 R2 留下舊物件。
      const versionedKey = key.replace(/\.mp3$/, `-${Date.now().toString(36)}.mp3`)
      await putR2Object(env.r2, { key: versionedKey, body: mp3, contentType: 'audio/mpeg' })
      return `${env.publicBaseUrl}/${versionedKey}`
    },
    saveAudio: savePodcastAudio,
    log: event => console.warn(JSON.stringify(event)),
  }
}
