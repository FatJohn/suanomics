import { createHash } from 'node:crypto'
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

export interface StoredShadowBrief { id: number, selectedNewsIds: number[], briefJson: unknown, inputsHash: string }

export async function getShadowBrief(date: string, variant: string): Promise<StoredShadowBrief | null> {
  const rows = await getDb()
    .select({ id: shadowBriefs.id, selectedNewsIds: shadowBriefs.selectedNewsIds, briefJson: shadowBriefs.briefJson, inputsHash: shadowBriefs.inputsHash })
    .from(shadowBriefs)
    .where(and(eq(shadowBriefs.briefDate, date), eq(shadowBriefs.variant, variant)))
    .limit(1)
  return rows[0] ?? null
}

export async function saveShadowBrief(date: string, variant: string, selectedIds: readonly number[], briefJson: unknown, inputsHash: string): Promise<number> {
  const set = { selectedNewsIds: [...selectedIds], briefJson, inputsHash, createdAt: new Date() }
  const [row] = await getDb()
    .insert(shadowBriefs)
    .values({ briefDate: date, variant, ...set })
    .onConflictDoUpdate({ target: [shadowBriefs.briefDate, shadowBriefs.variant], set })
    .returning({ id: shadowBriefs.id })
  if (!row)
    throw new Error('saveShadowBrief: upsert returned no row')
  return row.id
}

/** 影子報告與它的 judge 寫帳時的 run_id 前綴，正式報告的「已評過」判斷靠它排除。 */
export const SHADOW_RUN_ID_PREFIX = 'shadow-'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null)
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** run_inputs 的 hash。鍵排序後再算：jsonb 存回來的鍵順序與寫入時不同。 */
export function runInputsHash(runInputs: unknown): string {
  return createHash('sha256').update(canonicalJson(runInputs)).digest('hex')
}
