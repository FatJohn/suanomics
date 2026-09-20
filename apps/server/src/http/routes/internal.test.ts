import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInternalRoute } from './internal.js'

describe('pOST /internal/corpus/refresh', () => {
  beforeEach(() => {
    process.env.INGEST_TRIGGER_SECRET = 'testsecret'
    process.env.NODE_ENV = 'production'
  })

  it('401 missing Authorization', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/corpus/refresh', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  it('403 wrong secret', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/corpus/refresh', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' })
    expect(res.status).toBe(403)
  })

  it('422 invalid body', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/corpus/refresh', { method: 'POST', headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' }, body: '{"sourceSlugs": "not-array"}' })
    expect(res.status).toBe(422)
  })

  it('202 ok + auditId + pollUrl', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'aud-1', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/corpus/refresh', { method: 'POST', headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' }, body: '{"sourceSlugs": ["anue"]}' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.auditId).toBe('aud-1')
    expect(body.pollUrl).toBe('/api/jobs/aud-1')
  })

  it('dev skips auth check', async () => {
    process.env.NODE_ENV = 'development'
    const enqueue = vi.fn(async () => ({ auditId: 'x', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/corpus/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(202)
  })
})

// HTTP trigger for daily-brief（unblock prod acceptance when the hosting platform's CLI gateway is down）
describe('pOST /internal/brief/enqueue', () => {
  beforeEach(() => {
    process.env.INGEST_TRIGGER_SECRET = 'testsecret'
    process.env.NODE_ENV = 'production'
  })

  it('401 missing Authorization', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/brief/enqueue', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  it('403 wrong secret', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/brief/enqueue', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' })
    expect(res.status).toBe(403)
  })

  it('422 invalid date format', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/brief/enqueue', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ date: 'not-a-date' }),
    })
    expect(res.status).toBe(422)
  })

  it('202 ok with explicit date', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'aud-3', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/brief/enqueue', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-04-29' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.auditId).toBe('aud-3')
    expect(body.pollUrl).toBe('/api/jobs/aud-3')
    expect(enqueue).toHaveBeenCalledWith('daily-brief', { date: '2026-04-29', chainPodcast: true })
  })

  // 報告日是台北日，而 API 若自己補「今天」會用 UTC——若排程跑在 21:10 UTC ＝ 前一個 UTC 曆日，
  // 於是漏傳 date 會安靜地把 job 建在前一天。缺欄位是呼叫端的 bug，要 422，不要貼心補起來。
  it('422 when date is missing (no implicit today)', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'aud-4', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/brief/enqueue', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(422)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('dev mode skips auth check', async () => {
    process.env.NODE_ENV = 'development'
    const enqueue = vi.fn(async () => ({ auditId: 'dev-brief', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/brief/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"date":"2026-08-06"}',
    })
    expect(res.status).toBe(202)
  })
})

describe('pOST /internal/news/refresh', () => {
  beforeEach(() => {
    process.env.INGEST_TRIGGER_SECRET = 'testsecret'
    process.env.NODE_ENV = 'production'
  })

  it('401 missing Authorization', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/news/refresh', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  it('202 ok + enqueues news-refresh with the caller-supplied hourly bucket', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'n-1', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/news/refresh', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: '{"bucket":"2026-08-06T20"}',
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.auditId).toBe('n-1')
    expect(body.pollUrl).toBe('/api/jobs/n-1')
    expect(enqueue).toHaveBeenCalledWith('news-refresh', { bucket: '2026-08-06T20' })
  })

  it('422 when body is empty (bucket is required)', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'n-2', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/news/refresh', {
      method: 'POST',
      headers: { Authorization: 'Bearer testsecret' },
    })
    expect(res.status).toBe(422)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('422 when payload omits bucket', async () => {
    const enqueueMock = vi.fn(async () => ({ auditId: 'n-3', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueueMock as never }))
    const res = await app.request('/internal/news/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('preserves explicit bucket from payload', async () => {
    const enqueueMock = vi.fn(async () => ({ auditId: 'n-4', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueueMock as never }))
    const res = await app.request('/internal/news/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ bucket: 'custom-bucket' }),
    })
    expect(res.status).toBe(202)
    expect(enqueueMock).toHaveBeenCalledWith('news-refresh', { bucket: 'custom-bucket' })
  })
})

describe('pOST /internal/podcast/generate', () => {
  beforeEach(() => {
    process.env.INGEST_TRIGGER_SECRET = 'testsecret'
    process.env.NODE_ENV = 'production'
  })

  it('401 missing Authorization', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/podcast/generate', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  it('422 invalid date format', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/podcast/generate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ date: 'bad' }),
    })
    expect(res.status).toBe(422)
  })

  it('202 with explicit date + force', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'pg-1', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/podcast/generate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-05-17', force: true }),
    })
    expect(res.status).toBe(202)
    expect(enqueue).toHaveBeenCalledWith('podcast-generate', { date: '2026-05-17', force: true })
  })

  it('422 when date is missing (no implicit today)', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'pg-2', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/podcast/generate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(422)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('pOST /internal/podcast/tts', () => {
  beforeEach(() => {
    process.env.INGEST_TRIGGER_SECRET = 'testsecret'
    process.env.NODE_ENV = 'production'
  })

  it('401 missing Authorization', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/podcast/tts', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  it('202 with explicit date', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'pt-1', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/podcast/tts', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-05-17' }),
    })
    expect(res.status).toBe(202)
    expect(enqueue).toHaveBeenCalledWith('podcast-tts', { date: '2026-05-17' })
  })

  it('422 when date is missing (no implicit today)', async () => {
    const enqueue = vi.fn(async () => ({ auditId: 'pt-2', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request('/internal/podcast/tts', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(422)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

const mockEnqueueResult = { auditId: 'pr-1', status: 'queued' as const }

describe('/internal/prompt-research/refresh', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    process.env.INGEST_TRIGGER_SECRET = 'testsecret'
  })

  it('401 when missing authorization (prod)', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/prompt-research/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('403 when bearer token is wrong', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/prompt-research/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer wrong', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('422 when payload omits bucket', async () => {
    const enqueueMock = vi.fn(async () => mockEnqueueResult)
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueueMock as never }))
    const res = await app.request('/internal/prompt-research/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('202 with explicit sources passed through', async () => {
    const enqueueMock = vi.fn(async () => mockEnqueueResult)
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueueMock as never }))
    const sources = [{ kind: 'yt-transcript', slug: 'x', displayName: 'X', config: {} }]
    const res = await app.request('/internal/prompt-research/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ sources, bucket: '2026-08-06' }),
    })
    expect(res.status).toBe(202)
    expect(enqueueMock).toHaveBeenCalledWith('prompt-refresh', expect.objectContaining({
      sources: expect.arrayContaining([expect.objectContaining({ slug: 'x' })]),
      bucket: '2026-08-06',
    }))
  })

  it('422 when invalid payload shape', async () => {
    const enqueueMock = vi.fn(async () => mockEnqueueResult)
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueueMock as never }))
    const res = await app.request('/internal/prompt-research/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [{ kind: 'invalid-kind' }] }),
    })
    expect(res.status).toBe(422)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

describe('/internal/market-data/refresh', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    process.env.INGEST_TRIGGER_SECRET = 'testsecret'
  })

  it('401 when missing authorization (prod)', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/market-data/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('403 when bearer token is wrong', async () => {
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: vi.fn() as never }))
    const res = await app.request('/internal/market-data/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer wrong', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('422 when payload omits bucket', async () => {
    const enqueueMock = vi.fn(async () => ({ auditId: 'md-1', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueueMock as never }))
    const res = await app.request('/internal/market-data/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('preserves explicit bucket from payload', async () => {
    const enqueueMock = vi.fn(async () => ({ auditId: 'md-2', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueueMock as never }))
    const res = await app.request('/internal/market-data/refresh', {
      method: 'POST',
      headers: { 'authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: JSON.stringify({ bucket: '2026-06-12' }),
    })
    expect(res.status).toBe(202)
    expect(enqueueMock).toHaveBeenCalledWith('market-data-refresh', { bucket: '2026-06-12' })
  })

  it('422 when body is empty (bucket is required)', async () => {
    const enqueueMock = vi.fn(async () => ({ auditId: 'md-3', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueueMock as never }))
    const res = await app.request('/internal/market-data/refresh', {
      method: 'POST',
      headers: { Authorization: 'Bearer testsecret' },
    })
    expect(res.status).toBe(422)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

/**
 * 七個 enqueue route 對「body 根本不是 JSON」的處理原本只有 corpus-refresh 擋，
 * 其餘六個靠自己 schema 的必填欄位碰巧擋住——那是隱性依賴：schema 一旦放寬成
 * 全 optional，壞掉的 body 就會靜默變成 202 加一個空 payload 的 job。
 */
const ENQUEUE_PATHS = [
  '/internal/corpus/refresh',
  '/internal/brief/enqueue',
  '/internal/news/refresh',
  '/internal/podcast/generate',
  '/internal/podcast/tts',
  '/internal/prompt-research/refresh',
  '/internal/market-data/refresh',
]

describe('malformed JSON 一律 422、不得進 queue', () => {
  beforeEach(() => {
    process.env.INGEST_TRIGGER_SECRET = 'testsecret'
    process.env.NODE_ENV = 'production'
  })

  it.each(ENQUEUE_PATHS)('%s', async (path) => {
    const enqueue = vi.fn(async () => ({ auditId: 'a', status: 'queued' as const }))
    const app = new Hono().route('/internal', createInternalRoute({ enqueue: enqueue as never }))
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer testsecret', 'content-type': 'application/json' },
      body: 'definitely not json',
    })
    expect(res.status).toBe(422)
    expect(enqueue).not.toHaveBeenCalled()
  })
})
