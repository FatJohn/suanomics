import { and, eq } from 'drizzle-orm'
import { getDb } from '../client.js'
import { dailyBriefs, shadowBriefs } from '../schema.js'

export interface ShadowSource { selectedNewsIds: number[], runInputs: unknown }

/** 影子報告的底本：該日 complete 的正式報告選稿與 run_inputs。沒有 complete 時回 null。 */
export async function getShadowSource(date: string): Promise<ShadowSource | null> {
  const rows = await getDb()
    .select({ selectedNewsIds: dailyBriefs.selectedNewsIds, runInputs: dailyBriefs.runInputs })
    .from(dailyBriefs)
    .where(and(eq(dailyBriefs.briefDate, date), eq(dailyBriefs.status, 'complete')))
    .limit(1)
  return rows[0] ?? null
}

export async function getShadowBrief(date: string, variant: string): Promise<{ id: number, selectedNewsIds: number[], briefJson: unknown } | null> {
  const rows = await getDb()
    .select({ id: shadowBriefs.id, selectedNewsIds: shadowBriefs.selectedNewsIds, briefJson: shadowBriefs.briefJson })
    .from(shadowBriefs)
    .where(and(eq(shadowBriefs.briefDate, date), eq(shadowBriefs.variant, variant)))
    .limit(1)
  return rows[0] ?? null
}

export async function saveShadowBrief(date: string, variant: string, selectedIds: readonly number[], briefJson: unknown): Promise<number> {
  const set = { selectedNewsIds: [...selectedIds], briefJson, createdAt: new Date() }
  const [row] = await getDb()
    .insert(shadowBriefs)
    .values({ briefDate: date, variant, ...set })
    .onConflictDoUpdate({ target: [shadowBriefs.briefDate, shadowBriefs.variant], set })
    .returning({ id: shadowBriefs.id })
  if (!row)
    throw new Error('saveShadowBrief: upsert returned no row')
  return row.id
}
