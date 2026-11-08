import { like } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../client.js'
import { econCalendarEvents, materialAnnouncements } from '../schema.js'
import { insertMaterialAnnouncements, upsertEconCalendarEvents } from './ingest-repo.js'

const PREFIX = 'r24-ingest-'

async function cleanup(): Promise<void> {
  await getDb().delete(materialAnnouncements).where(like(materialAnnouncements.title, `${PREFIX}%`))
  await getDb().delete(econCalendarEvents).where(like(econCalendarEvents.title, `${PREFIX}%`))
}

const announcement = {
  market: 'twse' as const,
  companyCode: '2330',
  companyName: '台積電',
  announcedAt: new Date('2026-11-06T10:00:00Z'),
  title: `${PREFIX}董事會決議`,
  body: '說明',
  clause: '第51款',
}

describe('ingest-repo', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await closeDb()
  })

  it('同一則重訊重跑不重複', async () => {
    expect(await insertMaterialAnnouncements([announcement])).toBe(1)
    expect(await insertMaterialAnnouncements([announcement])).toBe(0)
  })

  it('經濟日曆同日同標題 upsert，同批重複不報錯', async () => {
    const event = { date: '2099-01-01', title: `${PREFIX}CPI`, region: 'US' as const, importance: 'high' as const, source: 'manual' }
    expect(await upsertEconCalendarEvents([event, { ...event, source: 'fed-json' }])).toBe(1)
    await upsertEconCalendarEvents([{ ...event, importance: 'low' as const }])
    const rows = await getDb().select().from(econCalendarEvents).where(like(econCalendarEvents.title, `${PREFIX}%`))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.importance).toBe('low')
  })
})
