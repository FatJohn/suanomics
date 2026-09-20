import { describe, expect, it, vi } from 'vitest'

// config-health 不碰 DB，但 ops.ts 在 import 時就會拉進這兩個 repo，所以照樣要 mock。
vi.mock('@suanomics/db/repos/news-repo', () => ({
  getDailyBriefsForDates: vi.fn(async () => []),
  countNewsFetchedBetween: vi.fn(async () => 0),
}))
vi.mock('@suanomics/db/repos/articles-repo', () => ({
  getSourceActivity: vi.fn(async () => []),
}))

// eslint-disable-next-line import/first
import { opsRoute } from './ops.js'

interface ConfigHealthBody {
  service: string
  ok: boolean
  degraded: boolean
  issues: Array<{ key: string, severity: string, kind: string, impact: string }>
}

async function get(): Promise<{ status: number, body: ConfigHealthBody }> {
  const res = await opsRoute.request('/ops/config-health')
  return { status: res.status, body: await res.json() as ConfigHealthBody }
}

// 這支測試會動 process.env，vi.stubEnv 會在每個 it 之後自動還原（unstubEnvs 預設開）。
function stubServerEnv(overrides: Record<string, string> = {}): void {
  const base: Record<string, string> = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://x',
    INGEST_TRIGGER_SECRET: 'secret',
    WEB_ORIGIN: 'https://app.example.com',
    GEMINI_API_KEY: 'g',
    FRED_API_KEY: 'f',
    PODCAST_TTS_PROVIDER: 'azure',
    AZURE_SPEECH_KEY: 'k',
    AZURE_SPEECH_REGION: 'australiaeast',
    PODCAST_STORAGE_KIND: 's3',
    PODCAST_S3_ENDPOINT: 'https://r2',
    PODCAST_S3_BUCKET: 'b',
    PODCAST_S3_ACCESS_KEY_ID: 'a',
    PODCAST_S3_SECRET_ACCESS_KEY: 's',
    PODCAST_S3_PUBLIC_BASE_URL: 'https://audio.example',
  }
  for (const [k, v] of Object.entries({ ...base, ...overrides }))
    vi.stubEnv(k, v)
}

describe('config-health 端點（GET /ops/config-health）', () => {
  it('設定齊全時回 ok:true 且沒有 issue（反向對照）', async () => {
    stubServerEnv()
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.service).toBe('server')
    expect(body.ok).toBe(true)
    expect(body.degraded).toBe(false)
    expect(body.issues).toEqual([])
  })

  it('次要設定缺了會標 degraded，但仍是 200（服務是活的）', async () => {
    stubServerEnv({ PODCAST_S3_PUBLIC_BASE_URL: '' })
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.degraded).toBe(true)
    expect(body.issues).toHaveLength(1)
    expect(body.issues[0]).toMatchObject({ key: 'PODCAST_S3_PUBLIC_BASE_URL', severity: 'optional', kind: 'missing' })
  })

  it('回應只帶 key 名與影響，不帶任何設定值', async () => {
    stubServerEnv({ INGEST_TRIGGER_SECRET: '', DATABASE_URL: 'postgres://user:hunter2@db/x' })
    const { body } = await get()
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).toContain('INGEST_TRIGGER_SECRET')
  })

  // 合併成單一 process 之前這裡回的只有 api 那份，所以帶一句 note 說 worker 的看不到。
  // 現在同一個 process 兩邊都跑，端點看到的就是全部——那句 note 若還在就是假訊息。
  it('不再宣稱有另一個 service 的檢查看不到', async () => {
    stubServerEnv()
    const { body } = await get()
    expect(body).not.toHaveProperty('note')
  })
})
