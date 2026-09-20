import type { JobRunner, JobSpec } from '@suanomics/jobs'
import process from 'node:process'
import { createAuditRepo, createJobRunner } from '@suanomics/jobs'
import { createHandlers } from './handlers/index.js'
import { JOB_SPECS, resolveConcurrency } from './specs.js'

/**
 * server entry 與 CLI 共用的 runner 組裝。
 *
 * 兩邊共用同一份的理由：CLI 現在自己跑 job（沒有常駐的第二個 process 可以依賴），
 * 所以「哪些 kind、跑幾條、誰處理」必須只有一份定義，否則 CLI 與線上會各跑各的。
 */
export function createServerRunner(): JobRunner {
  const specs: JobSpec[] = JOB_SPECS.map(spec => ({
    kind: spec.kind,
    concurrency: resolveConcurrency(spec, process.env),
  }))
  return createJobRunner({
    audit: createAuditRepo(),
    specs,
    handlers: createHandlers(),
  })
}
