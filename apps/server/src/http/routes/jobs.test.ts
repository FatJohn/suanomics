import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createJobsRoute } from './jobs.js'

function mount(row: Record<string, unknown> | null) {
  return new Hono().route('/api/jobs', createJobsRoute({ findById: async () => row as never }))
}

describe('gET /api/jobs/:jobId', () => {
  it('404 when not found', async () => {
    const res = await mount(null).request('/api/jobs/nonexistent')
    expect(res.status).toBe(404)
  })

  it('200 + status payload when found', async () => {
    const row = {
      id: 'job-1',
      jobKind: 'corpus-refresh',
      payloadHash: 'h',
      status: 'active',
      attempts: 1,
      resultRef: null,
      errorMessage: null,
      metadata: { progress: { percent: 42 } },
      createdAt: new Date('2026-04-23T00:00:00Z'),
      startedAt: new Date('2026-04-23T00:01:00Z'),
      completedAt: null,
    }
    const res = await mount(row).request('/api/jobs/job-1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      jobId: 'job-1',
      kind: 'corpus-refresh',
      status: 'active',
      progress: 42,
      attempts: 1,
    })
  })

  it('progress 0 when status=queued', async () => {
    const row = { id: 'job-2', jobKind: 'corpus-refresh', payloadHash: 'h', status: 'queued', attempts: 0, metadata: {}, createdAt: new Date(), startedAt: null, completedAt: null }
    const body = await (await mount(row).request('/api/jobs/job-2')).json()
    expect(body.progress).toBe(0)
  })

  it('progress 100 when status=completed', async () => {
    const row = { id: 'job-3', jobKind: 'corpus-refresh', payloadHash: 'h', status: 'completed', attempts: 1, resultRef: 'external_articles/batch-x', metadata: {}, createdAt: new Date(), startedAt: new Date(), completedAt: new Date() }
    const body = await (await mount(row).request('/api/jobs/job-3')).json()
    expect(body.progress).toBe(100)
    expect(body.resultRef).toBe('external_articles/batch-x')
  })

  describe('progress 讀 metadata.progress（runner 寫的那一份）', () => {
    it('parses { percent, stage }', async () => {
      const row = {
        id: 'job-x',
        jobKind: 'analyze',
        payloadHash: 'h',
        status: 'active',
        attempts: 1,
        metadata: { routingMode: 'db-related', progress: { percent: 55, stage: 'analyzing' } },
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
      }
      const body = await (await mount(row).request('/api/jobs/job-x')).json()
      expect(body.progress).toBe(55)
      expect(body.stage).toBe('analyzing')
      expect(body.routingMode).toBe('db-related')
    })

    it('returns null stage / routingMode when not present', async () => {
      const row = {
        id: 'job-y',
        jobKind: 'analyze',
        payloadHash: 'h',
        status: 'completed',
        attempts: 1,
        resultRef: 'analyses/1',
        metadata: {},
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
      }
      const body = await (await mount(row).request('/api/jobs/job-y')).json()
      expect(body.progress).toBe(100)
      expect(body.stage).toBeNull()
      expect(body.routingMode).toBeNull()
    })

    // active 但還沒寫過任何進度：回 0，不要讓 undefined 漏成 null 或 NaN。
    it('progress 0 when active row has no progress metadata yet', async () => {
      const row = {
        id: 'job-z',
        jobKind: 'corpus-refresh',
        payloadHash: 'h',
        status: 'active',
        attempts: 1,
        metadata: {},
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
      }
      const body = await (await mount(row).request('/api/jobs/job-z')).json()
      expect(body.progress).toBe(0)
      expect(body.stage).toBeNull()
    })
  })
})
