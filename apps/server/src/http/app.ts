import type { EnqueueFn, JobRunner } from '@suanomics/jobs'
import type { JobsRouteDeps } from './routes/jobs.js'
import process from 'node:process'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { resolveAnalyzeRateLimitConfig } from './rate-limit-config.js'
import { createFixedWindowLimiter } from './rate-limit.js'
import { audioRoute } from './routes/audio.js'
import { createBriefRoute } from './routes/brief.js'
import { createHealthRoute } from './routes/health.js'
import { createInternalRoute } from './routes/internal.js'
import { createJobsRoute } from './routes/jobs.js'
import { marketRoute } from './routes/market.js'
import { opsRoute } from './routes/ops.js'

export interface AppDeps {
  /**
   * 由 entry 注入的 runner enqueue。route 不再 import 全域單例——單 process 之後
   *  「排一個 job」就是「推進這個 process 的 runner」，拿不到 runner 就不該排得出來。
   */
  enqueue: EnqueueFn
  runner: Pick<JobRunner, 'stats'>
  jobs?: JobsRouteDeps
}

/**
 * 組出整個 HTTP app 但**不 listen**——listen 是 entry 的事。
 * 分開的理由：route test 想打整個 app（而不是單一 route）時不必起 server，
 * 也讓 entry 可以在別的 process 佈局下重用這一份 mount 順序。
 */
export function createApp(deps: AppDeps) {
  const app = new Hono()

  // WEB_ORIGIN 吃逗號分隔的多個 origin：改域名時新舊 domain 會並存一段時間、
  // 兩邊都得打得到 API。切換完成後把舊的從環境變數移掉即可，不必動程式。
  const allowedOrigins = [
    ...(process.env.WEB_ORIGIN ?? '').split(','),
    'http://localhost:5173',
  ].map(o => o.trim()).filter(o => o.length > 0)

  app.use('/*', cors({
    origin: (origin) => {
      if (!origin)
        return origin
      return allowedOrigins.includes(origin) ? origin : null
    },
  }))

  // 限流器只建立這一次、跟著 app 的生命週期活，不是每個 request 各自開一份
  // （那樣等於沒有限流——每次都是全新的計數器）。
  const rateLimitConfig = resolveAnalyzeRateLimitConfig()
  const analyzeLimiter = {
    perClient: createFixedWindowLimiter({ limit: rateLimitConfig.perClientLimit, windowMs: rateLimitConfig.perClientWindowMs }),
    global: createFixedWindowLimiter({ limit: rateLimitConfig.globalLimit, windowMs: rateLimitConfig.globalWindowMs }),
  }

  app.route('/', createHealthRoute({ jobStats: () => deps.runner.stats() }))
  app.route('/api', createBriefRoute({ enqueue: deps.enqueue, analyzeLimiter }))
  app.route('/api', marketRoute)
  app.route('/api', opsRoute)
  app.route('/api/jobs', createJobsRoute(deps.jobs))
  app.route('/internal', createInternalRoute({ enqueue: deps.enqueue }))
  app.route('/', audioRoute)

  app.get('/', c => c.text('suanomics api'))

  return app
}
