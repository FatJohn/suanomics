import type { JobKind, JobRunnerStats } from '@suanomics/jobs'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createHealthRoute } from './health.js'

describe('gET /health', () => {
  it('帶上 runner 的 per-kind 統計', async () => {
    const stats = { 'news-refresh': { pending: 1, waiting: 0, active: 2 } } as unknown as Record<JobKind, JobRunnerStats>
    const app = new Hono().route('/', createHealthRoute({ jobStats: () => stats }))
    const body = await (await app.request('/health')).json()
    expect(body).toMatchObject({ status: 'ok', service: 'server' })
    expect(body.jobs).toEqual({ 'news-refresh': { pending: 1, waiting: 0, active: 2 } })
  })
})
