import { describe, expect, it, vi } from 'vitest'
import { pMap, pMapSettled } from './_p-map.js'

describe('pMap', () => {
  it('preserves output order', async () => {
    const out = await pMap([1, 2, 3, 4], 2, async n => n * 10)
    expect(out).toEqual([10, 20, 30, 40])
  })

  it('respects concurrency limit (max in-flight = limit)', async () => {
    let inflight = 0
    let peak = 0
    const fn = vi.fn(async (n: number) => {
      inflight++
      peak = Math.max(peak, inflight)
      // yield + small artificial work
      await new Promise(r => setImmediate(r))
      inflight--
      return n
    })
    await pMap([1, 2, 3, 4, 5, 6], 2, fn)
    expect(peak).toBe(2)
    expect(fn).toHaveBeenCalledTimes(6)
  })

  it('handles empty input', async () => {
    expect(await pMap([], 3, async n => n)).toEqual([])
  })

  it('limit > items.length spawns only items.length workers', async () => {
    const fn = vi.fn(async (n: number) => n)
    await pMap([1, 2], 10, fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws on non-positive limit', async () => {
    await expect(pMap([1], 0, async n => n)).rejects.toThrow(/limit/)
    await expect(pMap([1], -1, async n => n)).rejects.toThrow(/limit/)
  })

  it('passes index to fn', async () => {
    const out = await pMap(['a', 'b', 'c'], 2, async (item, idx) => `${idx}:${item}`)
    expect(out).toEqual(['0:a', '1:b', '2:c'])
  })

  it('propagates fn error (one of the workers throws)', async () => {
    const fn = async (n: number) => {
      if (n === 3)
        throw new Error('boom')
      return n
    }
    await expect(pMap([1, 2, 3, 4], 2, fn)).rejects.toThrow(/boom/)
  })
})

describe('pMapSettled', () => {
  it('does not reject the whole batch when one item throws', async () => {
    const fn = async (n: number) => {
      if (n === 3)
        throw new Error('boom')
      return n * 10
    }
    const out = await pMapSettled([1, 2, 3, 4], 2, fn)
    expect(out).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'fulfilled', value: 40 },
    ])
  })

  it('respects concurrency limit (max in-flight = limit)', async () => {
    let inflight = 0
    let peak = 0
    const fn = vi.fn(async (n: number) => {
      inflight++
      peak = Math.max(peak, inflight)
      await new Promise(r => setImmediate(r))
      inflight--
      return n
    })
    await pMapSettled([1, 2, 3, 4, 5, 6], 2, fn)
    expect(peak).toBe(2)
    expect(fn).toHaveBeenCalledTimes(6)
  })

  it('preserves order and settles all fulfilled when nothing throws', async () => {
    const out = await pMapSettled([1, 2, 3], 3, async n => n * 10)
    expect(out).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
    ])
  })
})
