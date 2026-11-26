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
      return `${env.publicBaseUrl}/${key}`
    },
    saveAudio: savePodcastAudio,
    log: event => console.warn(JSON.stringify(event)),
  }
}
