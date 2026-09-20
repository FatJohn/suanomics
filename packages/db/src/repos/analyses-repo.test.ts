import type { MarketBrief } from '@suanomics/shared'
import { closeDb, getDb } from '@suanomics/db/client'
import { analyses } from '@suanomics/db/schema'
import { MarketBriefDisclaimer } from '@suanomics/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  findCachedByEntityOverlap,
  findCachedByInputHash,
  getAnalysisById,
} from './analyses-repo.js'

const TEST_INPUT_HASH = '__analyses_repo_test_hash__'
const TEST_PAYLOAD: MarketBrief = {
  headline: 'h',
  summary: 's',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['r1', 'r2'],
  citations: [{ url: 'https://x/1', title: 't', quote: 'q' }],
  disclaimer: MarketBriefDisclaimer,
}

beforeAll(async () => {
  await getDb().delete(analyses).where(eq(analyses.inputHash, TEST_INPUT_HASH))
})

beforeEach(async () => {
  await getDb().delete(analyses).where(eq(analyses.inputHash, TEST_INPUT_HASH))
})

afterAll(async () => {
  await getDb().delete(analyses).where(eq(analyses.inputHash, TEST_INPUT_HASH))
  await closeDb()
})

async function insert(opts: {
  inputHash?: string | null
  entities?: string[]
  expiresAt?: Date | null
  createdAt?: Date
}) {
  const [row] = await getDb().insert(analyses).values({
    payload: TEST_PAYLOAD,
    model: 'test',
    promptHash: 'h',
    inputHash: opts.inputHash ?? TEST_INPUT_HASH,
    entities: opts.entities ?? [],
    expiresAt: opts.expiresAt ?? null,
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  }).returning({ id: analyses.id })
  // eslint-disable-next-line ts/no-non-null-assertion -- insert().returning() guarantees a row
  return row!.id
}

describe('findCachedByInputHash', () => {
  it('returns row when hash matches and not expired', async () => {
    await insert({ expiresAt: new Date(Date.now() + 60_000) })
    const r = await findCachedByInputHash(TEST_INPUT_HASH)
    expect(r).not.toBeNull()
    // eslint-disable-next-line ts/no-non-null-assertion -- guarded by expect(r).not.toBeNull() above
    expect(r!.payload).toEqual(TEST_PAYLOAD)
  })
  it('returns null when expired', async () => {
    await insert({ expiresAt: new Date(Date.now() - 60_000) })
    expect(await findCachedByInputHash(TEST_INPUT_HASH)).toBeNull()
  })
  it('returns row when expires_at is null (legacy)', async () => {
    await insert({ expiresAt: null })
    const r = await findCachedByInputHash(TEST_INPUT_HASH)
    expect(r).not.toBeNull()
  })
  it('returns null when hash not found', async () => {
    expect(await findCachedByInputHash('__nonexistent__')).toBeNull()
  })
  it('returns most recent row when multiple match', async () => {
    const oldId = await insert({ createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000) })
    const newId = await insert({ createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) })
    const r = await findCachedByInputHash(TEST_INPUT_HASH)
    // eslint-disable-next-line ts/no-non-null-assertion -- both inserts above guarantee a matching row
    expect(r!.id).toBe(newId)
    // eslint-disable-next-line ts/no-non-null-assertion -- same: row guaranteed by prior inserts
    expect(r!.id).not.toBe(oldId)
  })
})

describe('findCachedByEntityOverlap', () => {
  it('returns rows where entities contain any of input canonicals', async () => {
    await insert({ entities: ['fed', 'rate-cut'] })
    await insert({ entities: ['oil-price'] })
    await insert({ entities: ['unrelated'] })
    const rows = await findCachedByEntityOverlap(['fed', 'oil-price'], 7, 20)
    const entitySets = rows.map(r => r.entities.sort().join(','))
    expect(entitySets).toContain(['fed', 'rate-cut'].sort().join(','))
    expect(entitySets).toContain(['oil-price'].sort().join(','))
    expect(entitySets).not.toContain(['unrelated'].sort().join(','))
  })
  it('respects window days (older rows excluded)', async () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await insert({ entities: ['fed'], createdAt: oldDate })
    await insert({ entities: ['fed'] })
    const rows = await findCachedByEntityOverlap(['fed'], 7, 20)
    expect(rows).toHaveLength(1)
  })
  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) await insert({ entities: ['fed'] })
    const rows = await findCachedByEntityOverlap(['fed'], 7, 3)
    expect(rows).toHaveLength(3)
  })
  it('returns empty when no canonicals provided', async () => {
    await insert({ entities: ['fed'] })
    expect(await findCachedByEntityOverlap([], 7, 20)).toEqual([])
  })
  it('returns empty when no row matches', async () => {
    await insert({ entities: ['oil-price'] })
    expect(await findCachedByEntityOverlap(['fed'], 7, 20)).toEqual([])
  })
})

describe('getAnalysisById', () => {
  it('returns row when found', async () => {
    const id = await insert({})
    const r = await getAnalysisById(id)
    expect(r).not.toBeNull()
    // eslint-disable-next-line ts/no-non-null-assertion -- guarded by expect(r).not.toBeNull() above
    expect(r!.payload).toEqual(TEST_PAYLOAD)
  })
  it('returns null when not found', async () => {
    expect(await getAnalysisById(99_999_999)).toBeNull()
  })
})
