import type { RunStats } from './logger.js'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from './logger.js'

describe('createLogger', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yt-logger-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('shouldWriteJsonlLineForEachEmitCall', () => {
    const logger = createLogger({ runId: 'r1', runDir: dir })
    logger.emit('run.start', { episodes: 3 })
    logger.emit('ep.done', { episode: 'ep-1', elapsedMs: 42 })
    logger.close()
    const lines = readFileSync(join(dir, 'run-log.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    // eslint-disable-next-line ts/no-non-null-assertion -- lines.length === 2 asserted above
    const e1 = JSON.parse(lines[0]!)
    expect(e1.event).toBe('run.start')
    expect(e1.run_id).toBe('r1')
    expect(e1.episodes).toBe(3)
    expect(e1.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('shouldPrintHumanLineToStdoutAlongsideJsonl', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const logger = createLogger({ runId: 'r2', runDir: dir })
    logger.emit('run.start', { episodes: 5 })
    logger.close()
    expect(spy).toHaveBeenCalled()
    const out = spy.mock.calls.map(c => String(c[0])).join('')
    expect(out).toContain('run.start')
    expect(out).toContain('5')
    spy.mockRestore()
  })

  it('shouldAccumulateStatsAcrossEvents', () => {
    const logger = createLogger({ runId: 'r3', runDir: dir })
    logger.emit('llm.call', { tokens_in: 100, tokens_out: 50, cost_usd: 0.001 })
    logger.emit('llm.call', { tokens_in: 200, tokens_out: 80, cost_usd: 0.002 })
    const stats: RunStats = logger.stats()
    expect(stats.totalTokensIn).toBe(300)
    expect(stats.totalTokensOut).toBe(130)
    expect(stats.totalCostUsd).toBeCloseTo(0.003, 5)
    logger.close()
  })

  it('shouldBumpRetryCountOnWarnLevelRetryEvents', () => {
    const logger = createLogger({ runId: 'r4', runDir: dir })
    logger.emit('retry', { reason: 'forbidden' }, 'warn')
    logger.emit('retry', { reason: 'empty' }, 'warn')
    expect(logger.stats().retryCount).toBe(2)
    logger.close()
  })

  it('shouldSupportDifferentLogLevels', () => {
    const logger = createLogger({ runId: 'r5', runDir: dir })
    logger.emit('info.event', { x: 1 })
    logger.emit('warn.event', { y: 2 }, 'warn')
    logger.emit('error.event', { z: 3 }, 'error')
    logger.close()
    const lines = readFileSync(join(dir, 'run-log.jsonl'), 'utf8').trim().split('\n')
    const parsed = lines.map(l => JSON.parse(l))
    // eslint-disable-next-line ts/no-non-null-assertion -- 3 lines emitted, parsed[0..2] are defined
    expect(parsed[0]!.level).toBe('info')
    // eslint-disable-next-line ts/no-non-null-assertion -- 3 lines emitted, parsed[0..2] are defined
    expect(parsed[1]!.level).toBe('warn')
    // eslint-disable-next-line ts/no-non-null-assertion -- 3 lines emitted, parsed[0..2] are defined
    expect(parsed[2]!.level).toBe('error')
  })
})
