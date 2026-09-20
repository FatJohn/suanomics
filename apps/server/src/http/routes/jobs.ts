import type { AuditRepo } from '@suanomics/jobs'
import { createAuditRepo } from '@suanomics/jobs'
import { Hono } from 'hono'

export interface ProgressInfo {
  percent: number
  stage?: string
}

export interface JobsRouteDeps {
  findById?: AuditRepo['findById']
}

/**
 * 進度來源。
 *
 * 以前這是「去 queue 問那個 job 的 progress」；單 process 之後 runner 直接把
 * `{ percent, stage }` 寫進 `background_jobs.metadata.progress`，所以進度與狀態
 * 出自同一筆 row、不會再出現「audit 說 active、queue 說沒這個 job」的分歧。
 */
function readProgress(metadata: Record<string, unknown> | undefined): ProgressInfo {
  const raw = metadata?.progress
  if (typeof raw !== 'object' || raw === null || !('percent' in raw))
    return { percent: 0 }
  const obj = raw as { percent: unknown, stage?: unknown }
  const percent = Number(obj.percent)
  return {
    percent: Number.isFinite(percent) ? percent : 0,
    ...(typeof obj.stage === 'string' ? { stage: obj.stage } : {}),
  }
}

export function createJobsRoute(deps?: JobsRouteDeps) {
  const findById = deps?.findById ?? createAuditRepo().findById

  const route = new Hono()
  route.get('/:jobId', async (c) => {
    const jobId = c.req.param('jobId')
    const row = await findById(jobId)
    if (!row) {
      c.status(404)
      return c.json({ error: 'job not found' })
    }
    const metadata = row.metadata as Record<string, unknown> | undefined
    let progress: ProgressInfo = { percent: 0 }
    if (row.status === 'completed')
      progress = { percent: 100 }
    else if (row.status === 'active')
      progress = readProgress(metadata)

    const routingMode = (metadata?.routingMode as string | undefined) ?? null

    return c.json({
      jobId: row.id,
      kind: row.jobKind,
      status: row.status,
      progress: progress.percent, // 既有 contract、backwards compat
      stage: progress.stage ?? null, // 新增
      routingMode, // 新增；analyze job 才會有
      attempts: row.attempts ?? 0,
      createdAt: row.createdAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      error: row.errorMessage ?? null,
      resultRef: row.resultRef ?? null,
    })
  })
  return route
}
