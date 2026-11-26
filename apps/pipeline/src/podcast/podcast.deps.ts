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
      await putR2Object(env.r2, { key, body: mp3, contentType: 'audio/mpeg' })
      // 同一天 --force 重產會覆寫同一個 key，網址帶版本才不會被 CDN 快取播到舊檔。
      return `${env.publicBaseUrl}/${key}?v=${Date.now().toString(36)}`
    },
    saveAudio: savePodcastAudio,
    log: event => console.warn(JSON.stringify(event)),
  }
}
