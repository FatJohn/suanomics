import { eq, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from './client.js'
import { externalSources } from './schema.js'
import { seedExternalSources } from './seed-external-sources.js'

// 真 DB 測試。純常數的斷言在 seed-external-sources.test.ts，這支只驗一件事：
// **upsert 的 `set` 子句真的會把 enabled 同步回 DB**。
//
// 分檔的理由是這個 repo 付過兩次代價的那條：`set` 子句寫錯（或漏欄位）是純測試永遠
// 看不到的——它只在真的送進 Postgres 時才有意義。停用 udn 兩個來源就是靠這個
// 欄位；沒有這支測試，「停用」可能只是 seed 檔上的一句話。
//
// 用合成來源而不是整份 EXTERNAL_SOURCES_SEED，免得把 30 筆真來源寫進跑測試的那個 DB。
//
// ★ 前綴刻意是 seedtest-src- 而不是 test-src-：articles-repo.db.test.ts 用後者，而 vitest
//   預設平行跑檔案，兩支的 cleanup 會互刪對方的資料（2026-08-22 實測 4 條紅）。

const ENABLED = 'seedtest-src-enabled'
const DISABLED = 'seedtest-src-disabled'

const FIXTURE = [
  { slug: ENABLED, displayName: 'enabled fixture', kind: 'rss', tier: 1, config: { feedUrl: 'https://example.invalid/a.xml' } },
  { slug: DISABLED, displayName: 'disabled fixture', kind: 'rss', tier: 1, enabled: false, config: { feedUrl: 'https://example.invalid/b.xml' } },
] as const

async function cleanup(): Promise<void> {
  await getDb().delete(externalSources).where(like(externalSources.slug, 'seedtest-src-%'))
}

async function enabledOf(slug: string): Promise<boolean> {
  const rows = await getDb().select().from(externalSources).where(eq(externalSources.slug, slug)).limit(1)
  const r = rows[0]
  if (!r)
    throw new Error(`row missing: ${slug}`)
  return r.enabled
}

describe('seedExternalSources (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('第一次 insert 就會帶入 enabled', async () => {
    await seedExternalSources(FIXTURE)
    expect(await enabledOf(ENABLED)).toBe(true)
    expect(await enabledOf(DISABLED)).toBe(false)
  })

  // 這條才是重點：seed 對既有 row 走的是 onConflictDoUpdate，enabled 若不在 set 子句裡，
  // DB 會保留舊值——於是「在 seed 檔裡停用一個來源」對已經存在的 prod row 完全無效。
  it('重跑 seed 會把 DB 裡被改掉的 enabled 拉回 seed 的值', async () => {
    await seedExternalSources(FIXTURE)
    await getDb().update(externalSources).set({ enabled: true }).where(eq(externalSources.slug, DISABLED))
    expect(await enabledOf(DISABLED)).toBe(true)

    await seedExternalSources(FIXTURE)
    expect(await enabledOf(DISABLED)).toBe(false)
  })

  it('反向對照：啟用中的來源被 seed 重跑不會變成停用', async () => {
    await seedExternalSources(FIXTURE)
    await seedExternalSources(FIXTURE)
    expect(await enabledOf(ENABLED)).toBe(true)
  })
})
