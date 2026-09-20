import type { JobKind, JobRunnerStats } from '@suanomics/jobs'
import { Hono } from 'hono'

export interface HealthRouteDeps {
  /**
   * runner 的 per-kind 佇列統計。單 process 之後沒有獨立的 worker log 可以看，
   * 這是「job 那一半還活著嗎」最便宜的觀測點。
   */
  jobStats: () => Record<JobKind, JobRunnerStats>
}

export function createHealthRoute(deps: HealthRouteDeps) {
  const route = new Hono()
  route.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'server',
      now: new Date().toISOString(),
      jobs: deps.jobStats(),
    })
  })
  return route
}
