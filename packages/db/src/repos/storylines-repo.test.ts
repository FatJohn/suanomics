import type { StorylineUpdate } from './storylines-repo.js'
import { closeDb, getDb } from '@suanomics/db/client'
import { storylines } from '@suanomics/db/schema'
import { eq, like, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEditorResult, getOpenStorylines, getStorylinesTouchedOn, getStorylinesUpdatedInRange, insertStoryline, isoDateMinusDays, newStorylineQuota, StorylineUpdateSchema } from './storylines-repo.js'

// 「這條測試不驗 open cap」的哨兵值：cap 是全表 count，本機真實資料會決定配額。
// 需要驗 cap 邊界的測試改看檔尾 newStorylineQuota 的純函式測試。
const NO_CAP = 10_000

// ★★ `applyEditorResult` 第 1 步的 auto-dormant sweep 的 `where` 只看 status 與日期、
//    **不分前綴**，所以在有真實資料的開發機上跑一次這支測試，就會對真實敘事線 sweep 一次。
//    今天沒出事是因為本檔的 briefDate 全錨在 2026-06 上半、cutoff（briefDate − 14 天）更早，
//    而本機 `storylines` 最早的有效日期
//    （`min(coalesce(last_touched_brief_date, created_at::date))`）是 **2026-06-27**
//    （2026-09-07 實測、21 列真實資料）。**那是資料事實、不是結構保證**：把日期改成近期的，
//    cutoff 就跟著跳到近期，真實的 open 線當場被改成 dormant——不可逆（`status` 沒有變更史），
//    而且**不會有任何測試變紅**（sweep 的結果沒有被斷言）。
//
//    `applyForTest` 就是那個「改了會有東西擋住」的機械物：本檔一律用它、不直接呼
//    `applyEditorResult`。它比的是 `briefDate` 本身而不是算出來的 cutoff，這樣連
//    `DORMANT_AFTER_DAYS` 被改大也照樣安全（cutoff 只會更早）。
//    ★ 它擋不到兩件事，別把它當成保證：
//    (a) 直接呼 `applyEditorResult` 的新測試——那是紀律不是機制。
//    (b) **資料往反方向漂**。守門看的是 briefDate 這個字面值、從不看資料，而真正的安全
//        邊界是「真實列的 `min(coalesce(...))` 晚於 cutoff」。有人回填歷史 storyline、
//        或把舊列的 `last_touched_brief_date` 改到 2026-06-05 之前，跑一次本機測試就會
//        靜默 sweep 掉真實列，`applyForTest` 不會 throw、也不會有任何測試變紅。
const SWEEP_SAFE_BRIEF_DATE_MAX = '2026-06-20'
async function applyForTest(p: Parameters<typeof applyEditorResult>[0]) {
  if (!(p.briefDate < SWEEP_SAFE_BRIEF_DATE_MAX)) {
    throw new Error(
      `briefDate ${p.briefDate} 不早於 ${SWEEP_SAFE_BRIEF_DATE_MAX}：`
      + `auto-dormant sweep 的 cutoff（${isoDateMinusDays(p.briefDate, 14)} 起算）會掃到真實敘事線。`
      + '本檔的 briefDate 必須留在 2026-06 上半。',
    )
  }
  return applyEditorResult(p)
}

// test- 前綴隔離測試資料、避免污染真實敘事線
async function cleanup() {
  await getDb().delete(storylines).where(like(storylines.title, 'test-%'))
}

// 測試用 helper：直接覆寫 jsonb updates、不走 lifecycle 邏輯（Task 3 才實作）
async function appendUpdateForTest(id: number, update: StorylineUpdate) {
  const db = getDb()
  const [row] = await db.select({ updates: storylines.updates }).from(storylines).where(eq(storylines.id, id))
  const current = (row?.updates as StorylineUpdate[] | undefined) ?? []
  await db.update(storylines).set({ updates: [...current, update] }).where(eq(storylines.id, id))
}

// 測試用 helper：直接覆寫 lastTouchedBriefDate、模擬陳舊敘事線（驗 auto-dormant）
async function setLastTouchedForTest(id: number, briefDate: string) {
  await getDb().update(storylines).set({ lastTouchedBriefDate: briefDate }).where(eq(storylines.id, id))
}

// 測試用 helper：直接覆寫 createdAt、模擬「這條線是哪天才出現的」（驗 asOf 的列層級上界）
async function setCreatedAtForTest(id: number, iso: string) {
  await getDb().update(storylines).set({ createdAt: new Date(iso) }).where(eq(storylines.id, id))
}

describe('storylines-repo db', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  // ★ 與序列快照、行事曆、近三日 brief 同一條紀律：補跑歷史報告時，editor 不該看到報告日
  //   之後的東西。這裡的污染在**每一列的 updates 陣列裡**，不是列層級——editor 印的是
  //   **日期最新的 3 筆** update 加上各自的 briefDate（`editor.ts:61-65`），只擋列擋不住。
  describe('getOpenStorylines 的 asOf 上界', () => {
    it('列層級：報告日之後才建立的線不出現', async () => {
      const early = await insertStoryline({ title: 'test-asof-early', thesis: 't', entities: [] })
      const late = await insertStoryline({ title: 'test-asof-late', thesis: 't', entities: [] })
      await setCreatedAtForTest(early, '2026-09-01T00:00:00Z')
      await setCreatedAtForTest(late, '2026-09-04T00:00:00Z')

      const titles = (await getOpenStorylines('2026-09-02')).map(s => s.title).filter(t => t.startsWith('test-'))
      expect(titles).toEqual(['test-asof-early'])

      // ★ 負向對照：不帶 asOf 時兩條都在。它擋的是「**不帶 asOf 也套上界**」那種實作，
      //   擋不到「永遠只回最舊一條」——那種實作在乾淨 DB（＝CI 條件）下兩條斷言都會綠，
      //   上面那條只是靠本機既有的 open 線才被撈到。這句第一版寫反，驗收突變實測糾正。
      const all = (await getOpenStorylines()).map(s => s.title).filter(t => t.startsWith('test-'))
      expect(all).toEqual(['test-asof-early', 'test-asof-late'])
    })

    it('★ updates 層級：報告日之後的進展被濾掉，lastTouchedBriefDate 跟著回到那個視角', async () => {
      const id = await insertStoryline({ title: 'test-asof-updates', thesis: 't', entities: [] })
      await setCreatedAtForTest(id, '2026-09-01T00:00:00Z')
      for (const briefDate of ['2026-09-01', '2026-09-03', '2026-09-05'])
        await appendUpdateForTest(id, { briefDate, valence: 'support', note: `n-${briefDate}` })
      await setLastTouchedForTest(id, '2026-09-05')

      const bounded = (await getOpenStorylines('2026-09-03')).find(s => s.title === 'test-asof-updates')
      expect(bounded?.updates.map(u => u.briefDate)).toEqual(['2026-09-01', '2026-09-03'])
      // 欄位值是 09-05，但這是一份 as-of 09-03 的視角，回原值等於留一個未來日期在裡面
      expect(bounded?.lastTouchedBriefDate).toBe('2026-09-03')

      // 濾完沒有任何進展 → 空陣列與 null，而不是整條線消失（editor 有「尚無進展」的分支）
      const earlier = (await getOpenStorylines('2026-09-02')).find(s => s.title === 'test-asof-updates')
      expect(earlier?.updates.map(u => u.briefDate)).toEqual(['2026-09-01'])
      const before = (await getOpenStorylines('2026-08-31')).find(s => s.title === 'test-asof-updates')
      expect(before).toBeUndefined() // createdAt 09-01 > 08-31，列層級就擋掉了

      // ★ 負向對照：不帶 asOf 時三筆都在、欄位值不動
      const unbounded = (await getOpenStorylines()).find(s => s.title === 'test-asof-updates')
      expect(unbounded?.updates).toHaveLength(3)
      expect(unbounded?.lastTouchedBriefDate).toBe('2026-09-05')
    })

    // ★★ updates 的**寫入序不保證等於時間序**：`upsertSameDay` 寫入時是有排序，但那只是
    //    紀律、不是保證——jsonb 沒有 DB 約束，直寫 updates 的程式（本檔的 `appendUpdateForTest`、
    //    一次性 data migration）都能無聲重建亂序。收斂 lastTouchedBriefDate 時拿 at(-1) 會說謊。
    //    storyline-block.ts:34 早就寫著「不信任 updates 寫入序」，這裡用同一套 max 比較。
    it('★ updates 亂序時 lastTouchedBriefDate 取的是最大 briefDate、不是陣列最後一筆', async () => {
      const id = await insertStoryline({ title: 'test-asof-unordered', thesis: 't', entities: [] })
      await setCreatedAtForTest(id, '2026-09-01T00:00:00Z')
      // 寫入序刻意亂：補跑會造出這種形狀
      for (const briefDate of ['2026-09-05', '2026-09-02', '2026-09-03'])
        await appendUpdateForTest(id, { briefDate, valence: 'support', note: `n-${briefDate}` })

      const bounded = (await getOpenStorylines('2026-09-06')).find(s => s.title === 'test-asof-unordered')
      expect(bounded?.lastTouchedBriefDate).toBe('2026-09-05')

      const narrower = (await getOpenStorylines('2026-09-03')).find(s => s.title === 'test-asof-unordered')
      expect(narrower?.updates.map(u => u.briefDate)).toEqual(['2026-09-02', '2026-09-03'])
      expect(narrower?.lastTouchedBriefDate).toBe('2026-09-03')
    })
  })

  describe('storylines-repo reads', () => {
    it('getOpenStorylines returns only open lines with parsed updates', async () => {
      await insertStoryline({ title: 'test-line-a', thesis: 'Fed 降息路徑', entities: ['Fed'] })
      const open = await getOpenStorylines()
      const mine = open.filter(s => s.title.startsWith('test-'))
      expect(mine).toHaveLength(1)
      expect(mine[0]?.status).toBe('open')
      expect(mine[0]?.updates).toEqual([])
      expect(mine[0]?.entities).toEqual(['Fed'])
    })

    it('getOpenStorylines skips malformed rows and keeps healthy ones', async () => {
      const goodId = await insertStoryline({ title: 'test-good', thesis: 'healthy', entities: ['Fed'] })
      const badId = await insertStoryline({ title: 'test-bad', thesis: 'corrupt', entities: [] })
      // 直接塞非法 updates shape（kind 不在 enum、缺 note）模擬髒資料
      await getDb().update(storylines).set({ updates: sql`'[{"briefDate":"2026-06-12","kind":"nonsense"}]'::jsonb` }).where(eq(storylines.id, badId))

      const open = await getOpenStorylines()
      const mine = open.filter(s => s.title.startsWith('test-'))
      expect(mine.map(s => s.id)).toContain(goodId)
      expect(mine.map(s => s.id)).not.toContain(badId)
    })

    it('getStorylinesTouchedOn skips malformed rows without throwing', async () => {
      const id = await insertStoryline({ title: 'test-touched-bad', thesis: 't', entities: [] })
      // 合法的 briefDate match query、但 updates array 內含非法 element
      await getDb().update(storylines).set({ updates: sql`'[{"briefDate":"2026-06-12","valence":"extend","note":"ok"},{"briefDate":"2026-06-12"}]'::jsonb` }).where(eq(storylines.id, id))

      const touched = await getStorylinesTouchedOn('2026-06-12')
      expect(touched.some(s => s.id === id)).toBe(false)
    })

    it('getStorylinesTouchedOn matches lines whose updates contain the briefDate', async () => {
      const id = await insertStoryline({ title: 'test-line-b', thesis: 't', entities: [] })
      await appendUpdateForTest(id, { briefDate: '2026-06-12', valence: 'extend', note: 'CPI 低於預期' })
      const touched = await getStorylinesTouchedOn('2026-06-12')
      expect(touched.some(s => s.id === id)).toBe(true)
      expect((await getStorylinesTouchedOn('2026-06-11')).some(s => s.id === id)).toBe(false)
    })
  })

  describe('applyEditorResult', () => {
    it('valence touch applies update, keeps open, bumps lastTouched', async () => {
      const id = await insertStoryline({ title: 'test-adv', thesis: 't', entities: [] })
      const r = await applyForTest({ briefDate: '2026-06-12', touches: [{ storylineId: id, valence: 'extend', note: 'n1' }], resolves: [], newStorylines: [] })
      expect(r.touched).toBe(1)
      const s = (await getOpenStorylines()).find(x => x.id === id)
      expect(s?.updates).toHaveLength(1)
      expect(s?.lastTouchedBriefDate).toBe('2026-06-12')
    })

    it('resolve on a never-touched line goes terminal (no longer open) + records the update', async () => {
      const id = await insertStoryline({ title: 'test-conf', thesis: 't', entities: [] })
      const r = await applyForTest({ briefDate: '2026-06-12', touches: [], resolves: [{ storylineId: id, disposition: 'confirmed', note: '論點兌現' }], newStorylines: [] })
      expect(r.resolved).toBe(1)
      expect((await getOpenStorylines()).some(x => x.id === id)).toBe(false)
      const row = (await getStorylinesTouchedOn('2026-06-12')).find(x => x.id === id)
      expect(row?.status).toBe('confirmed')
      expect(row?.updates.at(-1)?.valence).toBe('support')
    })

    it('auto-dormants open lines untouched for > 14 days before applying', async () => {
      const id = await insertStoryline({ title: 'test-old', thesis: 't', entities: [] })
      await setLastTouchedForTest(id, '2026-05-20') // 23 天前
      const r = await applyForTest({ briefDate: '2026-06-12', touches: [], resolves: [], newStorylines: [] })
      expect(r.dormanted).toBeGreaterThanOrEqual(1)
      expect((await getOpenStorylines()).some(x => x.id === id)).toBe(false)
    })

    // ★ open cap 是**全表** count，所以「插 10 條再看第 11 條有沒有被丟掉」這種寫法在
    //   開發者本機（真實 open 線已頂在 10）根本沒踩到邊界——cap 是 10 還是 11 都會綠。
    //   邊界值改由 newStorylineQuota 的純函式測試守（見檔尾），這裡只驗「配額為 0 時
    //   新線真的被丟掉」，用 openCap 明確表達前提、不再依賴 DB 裡有幾條線。
    it('配額用完時多的新線被丟掉', async () => {
      const r = await applyForTest({ briefDate: '2026-06-12', touches: [], resolves: [], newStorylines: [{ title: 'test-over', thesis: 't', entities: [] }], openCap: 0 })
      expect(r.created).toBe(0)
      expect((await getOpenStorylines()).some(s => s.title === 'test-over')).toBe(false)
    })

    it('配額還有時新線照常建立', async () => {
      const r = await applyForTest({ briefDate: '2026-06-12', touches: [], resolves: [], newStorylines: [{ title: 'test-under-cap', thesis: 't', entities: [] }], openCap: NO_CAP })
      expect(r.created).toBe(1)
      expect((await getOpenStorylines()).some(s => s.title === 'test-under-cap')).toBe(true)
    })

    // ★★ 上面兩條都顯式傳 openCap，所以**沒有任何一條走預設路徑**——把 `p.openCap ?? OPEN_CAP`
    //    改成 `?? 0`（production 從此建不出新線）或 `?? 1000`（cap 失效）兩種寫法全綠。
    //    純函式測試釘住的是 `newStorylineQuota` 自己的預設值，釘不住呼叫點的 `??` 右側。
    //    這條補上那個缺口。
    //
    //    ★★ 訊號不能取自 warn 字串。`created === 0` 對 `?? 0` 天生無感（cap 變小、
    //    新線照樣被丟掉），而 warn 裡印的 cap 與 cap 本身是同一份程式碼——把 `?? 0` 與
    //    寫死的 `open cap 10 reached` 一起改，全檔照樣全綠。現在的訊號是 `applyEditorResult`
    //    回傳的 `openCap`（＝這一批實際套用的上限）：`?? 0` 讓它回 0 而紅。warn 那條斷言
    //    改成拿 `r.openCap` 內插，守的是另一件事——log 印的 cap 與實際套用的是同一個值。
    //
    //    ★ `r.openCap` 與被守的 `cap` 是同一個 const，所以**這一條守不住 cap 解析**——
    //    把 `?? 0`、回傳值、warn 字串三點同改，它照樣是綠的（2026-09-09 驗收在本機 DB 實測；
    //    空庫才紅，而那正是「訊號依賴當下 open 數」的病）。它守住的是別的東西：回報的 cap
    //    與字面量 10 一致、以及 log 印的 cap 與實際套用的是同一個值。真正釘住呼叫點
    //    `?? OPEN_CAP` 的是下面那條「openCount 釘在 9」——四個突變的共同紅點只有它。
    //
    //    ★★ **無條件插 10 條，不去讀「現在有幾條 open」**。舊版是
    //    `const already = (await getOpenStorylines()).length` 再補到 10——那讀的是不分前綴的
    //    全表 open 數，而 vitest 平行跑檔案：同 package 的 storyline-activity.db.test.ts 會
    //    seed／`afterEach` 刪掉 open 列，那個數字在「這裡讀」與「`applyEditorResult` 於 tx 內
    //    重數」之間會變。空 DB（＝CI 條件）上補得太少 → quota ≥ 1 → `created` 回 1 而紅，
    //    訊息（`expected 1 to be 0`）與真回歸長得一模一樣，而原因在另一個檔案裡。
    //    本機當時不紅是機器事實（真實 open 已達 10、補洞迴圈一條都不插），不是隔離。
    //    插滿 10 條讓 `openCount >= 10` 恆成立——真實資料與別人的 seed 只會讓它更大，
    //    `quota = max(0, 10 - openCount)` 照樣是 0。
    it('不傳 openCap 時預設上限就是 10', async () => {
      for (let i = 0; i < 10; i++)
        await insertStoryline({ title: `test-cap-fill-${i}`, thesis: 't', entities: [] })

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const r = await applyForTest({ briefDate: '2026-06-12', touches: [], resolves: [], newStorylines: [{ title: 'test-default-cap-over', thesis: 't', entities: [] }] })
        expect(r.openCap).toBe(10)
        expect(r.created).toBe(0)
        expect(warn.mock.calls.flat().join(' ')).toContain(`open cap ${r.openCap} reached`)
      }
      finally {
        warn.mockRestore()
      }
      expect((await getOpenStorylines()).some(s => s.title === 'test-default-cap-over')).toBe(false)
    })

    // ★★ **這一條是 cap 解析唯一的防線，不要刪。** 把 openCount 釘在 9（見
    //    `ApplyEditorResultParams` 的 openCount 說明），預設 cap 若是 10 就剩 1 格、
    //    建得起來 1 條；`?? 0` 讓它變 0 條、`?? 1000` 讓它變 2 條。
    //
    //    2026-09-09 驗收在本機 DB（open=10）與另建的空庫上各跑一次四個突變
    //    （`?? 0`／`?? 1000`／`?? OPEN_CAP - 1`／三點同改），**四個突變的共同紅點只有
    //    這一條**——上面那條 `不傳 openCap 時預設上限就是 10` 對三點同改是綠的（它回報
    //    的仍是 10、created 本來就是 0），空庫才紅。所以刪掉這一條、或把 `created`
    //    的斷言放寬，這一條的守門會當場靜默消失而沒有任何測試變紅。
    //
    //    ★ 曾經還有一條「配額不變式」測試（`created === min(n, max(0, openCap − openCount))`），
    //    2026-09-09 驗收判定它對 cap 解析是**套套邏輯**後刪除：那個算式就是實作本身，而
    //    回傳的 openCap 與 openCount 都取自同一次呼叫，任何**一致**的 cap 改動都讓它恆真
    //    （`?? 0` 與 `?? 1000` 實測皆全綠）。留著會讓人以為防線比實際厚。
    it('openCount 釘在 9 時，預設 cap 恰好剩一格（釘住呼叫點的 ?? OPEN_CAP）', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const r = await applyForTest({
          briefDate: '2026-06-12',
          touches: [],
          resolves: [],
          newStorylines: [
            { title: 'test-cap-boundary-1', thesis: 't', entities: [] },
            { title: 'test-cap-boundary-2', thesis: 't', entities: [] },
          ],
          openCount: 9,
        })
        expect(r.openCap).toBe(10)
        expect(r.created).toBe(1)
      }
      finally {
        warn.mockRestore()
      }
    })

    it('skips touches for unknown or non-open storyline ids without failing the batch', async () => {
      const r = await applyForTest({ briefDate: '2026-06-12', touches: [{ storylineId: 999999, valence: 'extend', note: 'x' }], resolves: [], newStorylines: [] })
      expect(r.touched).toBe(0)
    })

    it('skips a touch with a malformed (empty) note without rolling back the rest of the batch', async () => {
      const badId = await insertStoryline({ title: 'test-empty-note', thesis: 't', entities: [] })
      const goodId = await insertStoryline({ title: 'test-valid-note', thesis: 't', entities: [] })
      // LLM 偶爾給空 note、min(1) 會擋下、該 touch 要 skip 而非炸掉整批
      const r = await applyForTest({
        briefDate: '2026-06-12',
        touches: [
          { storylineId: badId, valence: 'extend', note: '' },
          { storylineId: goodId, valence: 'extend', note: 'CPI 走低' },
        ],
        resolves: [],
        newStorylines: [{ title: 'test-new-line', thesis: 't', entities: [] }],
        // 這條驗的是「malformed touch 不會 rollback 整批」，不是 cap。不宣告的話，
        // 開發者本機（open 已頂在 10）會讓 test-new-line 被配額吃掉、created 回 0 而紅。
        openCap: NO_CAP,
      })
      // 空 note touch skip、有效 touch 成功、new line 照常建立
      expect(r.touched).toBe(1)
      expect(r.created).toBe(1)
      const open = await getOpenStorylines()
      expect(open.find(s => s.id === badId)?.updates).toHaveLength(0)
      expect(open.find(s => s.id === goodId)?.updates).toHaveLength(1)
      expect(open.some(s => s.title === 'test-new-line')).toBe(true)
    })

    it('is idempotent per (storyline, briefDate): re-applying same day replaces, not appends', async () => {
      const id = await insertStoryline({ title: 'test-idem', thesis: 't', entities: [] })
      await applyForTest({ briefDate: '2026-06-12', touches: [{ storylineId: id, valence: 'extend', note: 'v1' }], resolves: [], newStorylines: [] })
      await applyForTest({ briefDate: '2026-06-12', touches: [{ storylineId: id, valence: 'support', note: 'v2' }], resolves: [], newStorylines: [] })
      const s = (await getOpenStorylines()).find(x => x.id === id)
      expect(s?.updates).toHaveLength(1)
      expect(s?.updates[0]?.valence).toBe('support')
      expect(s?.updates[0]?.note).toBe('v2')
    })

    it('valence touch keeps the storyline open', async () => {
      const id = await insertStoryline({ title: 'test-keepopen', thesis: 't', entities: [] })
      await applyForTest({ briefDate: '2026-06-12', touches: [{ storylineId: id, valence: 'challenge', note: '反向訊號' }], resolves: [], newStorylines: [] })
      expect((await getOpenStorylines()).some(x => x.id === id)).toBe(true)
    })
  })

  // ★★ 補跑（backfill）語意：把讀取面的報告日上界補齊之後，補跑歷史報告從
  //    「明確不該做」變成「可以做」，而寫入側還停在只考慮當日跑的假設——無條件把
  //    lastTouchedBriefDate 覆寫成 payload 的 briefDate，補跑就會讓一條線的「最後進展日」
  //    倒退；append 不排序則讓 updates 變成 [09-05, 09-02] 這種陣列序≠時間序的列。
  //    （後者只是資料自洽、不是承重不變式——讀路徑一律自己依 briefDate 排序。）
  describe('applyEditorResult 的補跑語意', () => {
    it('★ 補跑較舊的 briefDate：lastTouchedBriefDate 不倒退、兩筆 updates 都在且依日期排序', async () => {
      const id = await insertStoryline({ title: 'test-backfill-touch', thesis: 't', entities: [] })
      await applyForTest({ briefDate: '2026-06-15', touches: [{ storylineId: id, valence: 'extend', note: '當日進展' }], resolves: [], newStorylines: [] })
      await applyForTest({ briefDate: '2026-06-12', touches: [{ storylineId: id, valence: 'support', note: '補跑的舊進展' }], resolves: [], newStorylines: [] })

      const s = (await getOpenStorylines()).find(x => x.id === id)
      expect(s?.lastTouchedBriefDate).toBe('2026-06-15')
      expect(s?.updates.map(u => u.briefDate)).toEqual(['2026-06-12', '2026-06-15'])
      expect(s?.updates.map(u => u.note)).toEqual(['補跑的舊進展', '當日進展'])
    })

    // ★ 負向對照：擋的是「一律取既有值」那種寫反的實作——正常當日跑（較新的 briefDate）
    //   必須照樣推進，否則 lastTouchedBriefDate 會永遠停在第一次的日期、auto-dormant 跟著誤判。
    it('負向對照：較新的 briefDate 仍會推進 lastTouchedBriefDate', async () => {
      const id = await insertStoryline({ title: 'test-forward-touch', thesis: 't', entities: [] })
      await applyForTest({ briefDate: '2026-06-12', touches: [{ storylineId: id, valence: 'extend', note: '較舊' }], resolves: [], newStorylines: [] })
      await applyForTest({ briefDate: '2026-06-15', touches: [{ storylineId: id, valence: 'support', note: '較新' }], resolves: [], newStorylines: [] })

      const s = (await getOpenStorylines()).find(x => x.id === id)
      expect(s?.lastTouchedBriefDate).toBe('2026-06-15')
      expect(s?.updates.map(u => u.briefDate)).toEqual(['2026-06-12', '2026-06-15'])
    })

    // ★★ 止血。這條的**前一版把舊行為（補跑會改 status）當成期望鎖住了**——它本來
    //    只想驗 lastTouchedBriefDate 不倒退，卻順手固定了不該固定的東西。補跑是重建那一天的
    //    視角、不是重新宣判；而 `status` 沒有變更史（只做止血、不做變更史），就地改寫
    //    不可逆：一條 09-05 還活著的線被補跑 09-02 判成 confirmed 之後就再也回不去。
    it('★ 補跑了結一條已有較新進展的線：update 照寫，status 與 lastTouchedBriefDate 都不動', async () => {
      const id = await insertStoryline({ title: 'test-backfill-resolve', thesis: 't', entities: [] })
      await applyForTest({ briefDate: '2026-06-15', touches: [{ storylineId: id, valence: 'extend', note: '當日進展' }], resolves: [], newStorylines: [] })

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      let r: Awaited<ReturnType<typeof applyEditorResult>>
      let warnText: string
      try {
        r = await applyForTest({ briefDate: '2026-06-12', touches: [], resolves: [{ storylineId: id, disposition: 'confirmed', note: '補跑了結' }], newStorylines: [] })
        warnText = warn.mock.calls.flat().join(' ')
      }
      finally {
        warn.mockRestore()
      }
      const s = (await getStorylinesTouchedOn('2026-06-12')).find(x => x.id === id)
      // 主要斷言排在最前面：舊行為（無條件改 status）要在這裡就紅，訊息才指得到真正的缺陷
      expect(s?.status).toBe('open')
      // 沒有發生狀態轉換就不計入：`resolved` 的語意是「了結了幾條線」
      expect(r.resolved).toBe(0)
      // 靜默地不改 status 會讓「補跑後那條線怎麼還是 open」變成無從追查，所以留一行 warn
      expect(warnText).toContain(`backfill resolve for storyline id=${id}`)
      expect(s?.lastTouchedBriefDate).toBe('2026-06-15')
      // 那天的 editor 確實下了這個判斷、是該報告日的真實紀錄，所以 update 照樣寫進去
      expect(s?.updates.map(u => u.briefDate)).toEqual(['2026-06-12', '2026-06-15'])
      expect(s?.updates.map(u => u.note)).toEqual(['補跑了結', '當日進展'])
    })

    // ★ 邊界一（相等）：`lastTouchedBriefDate === briefDate` 仍要改 status。
    //   真實路徑上這個相等來自「同一批的 touches 先把 lastTouched 推到今天，resolves 迴圈
    //   才讀到它」，所以這裡就用同一批 touch + resolve，不靠測試 helper 偽造。
    //   擋的是把判準寫成嚴格 `<`（少了等號）的實作——那會讓正常當日了結整個失效。
    it('負向對照（相等）：同一批被 touch 過的線在同日了結時 status 照改', async () => {
      const id = await insertStoryline({ title: 'test-sameday-resolve', thesis: 't', entities: [] })
      const r = await applyForTest({
        briefDate: '2026-06-12',
        touches: [{ storylineId: id, valence: 'extend', note: '今天的進展' }],
        resolves: [{ storylineId: id, disposition: 'refuted', note: '同日了結' }],
        newStorylines: [],
      })
      expect(r.resolved).toBe(1)

      const s = (await getStorylinesTouchedOn('2026-06-12')).find(x => x.id === id)
      expect(s?.status).toBe('refuted')
      expect(s?.lastTouchedBriefDate).toBe('2026-06-12')
      // 同日冪等：resolve 的 update 取代同日的 touch，不疊成兩筆
      expect(s?.updates.map(u => u.note)).toEqual(['同日了結'])
    })

    // ★ 邊界二（null）：`lastTouchedBriefDate` 為 null 時 `laterBriefDate(null, d)` 回 d，
    //   所以照樣改 status。擋的是把判準寫成「非 null 才比較、null 一律不改」的實作——
    //   那會讓「建立之後從未被 touch、當天就被了結」的線永遠停在 open。
    //   ★ null 的意思是「從未被 touch 過」，**不是「新線」**：一條老線也可以一直是 null。
    //   它是「補跑日不早於該線最後進展日 → 照樣就地宣判」這個更大範圍的極端情形，不是特例；
    //   那是止不到的部分（要 status 變更史才擋得住），止不到多少不在這裡展開。
    //   這條測試釘的是「null 時 status 會改」這個**現行**行為，不是在主張那個範圍沒問題。
    //   （`storylines-repo reads` 那邊的 `resolve transitions to terminal status` 走的是同一條
    //    路徑，但它沒有在講這個判準；這條是為了讓三個邊界並排在同一處。）
    it('負向對照（null）：從未被 touch 過的線被了結時 status 照改', async () => {
      const id = await insertStoryline({ title: 'test-nulltouch-resolve', thesis: 't', entities: [] })
      const r = await applyForTest({ briefDate: '2026-06-12', touches: [], resolves: [{ storylineId: id, disposition: 'confirmed', note: '從未被 touch 就了結' }], newStorylines: [] })
      expect(r.resolved).toBe(1)

      const s = (await getStorylinesTouchedOn('2026-06-12')).find(x => x.id === id)
      expect(s?.status).toBe('confirmed')
      expect(s?.lastTouchedBriefDate).toBe('2026-06-12')
    })

    // ★ 同日冪等仍成立（取代而非疊加），排序不該把重跑變成兩筆
    it('同日重跑仍是取代、排序後仍只有一筆', async () => {
      const id = await insertStoryline({ title: 'test-backfill-idem', thesis: 't', entities: [] })
      await applyForTest({ briefDate: '2026-06-15', touches: [{ storylineId: id, valence: 'extend', note: 'v1' }], resolves: [], newStorylines: [] })
      await applyForTest({ briefDate: '2026-06-12', touches: [{ storylineId: id, valence: 'support', note: '補跑' }], resolves: [], newStorylines: [] })
      await applyForTest({ briefDate: '2026-06-15', touches: [{ storylineId: id, valence: 'challenge', note: 'v2' }], resolves: [], newStorylines: [] })

      const s = (await getOpenStorylines()).find(x => x.id === id)
      expect(s?.updates.map(u => u.briefDate)).toEqual(['2026-06-12', '2026-06-15'])
      expect(s?.updates.at(-1)?.note).toBe('v2')
      expect(s?.lastTouchedBriefDate).toBe('2026-06-15')
    })
  })

  describe('getStorylinesUpdatedInRange', () => {
    it('撈出 updates 落在區間內的 storyline（含端點、跨 status）', async () => {
      const id = await insertStoryline({ title: 'test-range-in', thesis: 't', entities: ['x'] })
      await appendUpdateForTest(id, { briefDate: '2026-07-08', valence: 'support', note: 'mid-week' })
      await getDb().update(storylines).set({ status: 'confirmed' }).where(eq(storylines.id, id))

      const rows = await getStorylinesUpdatedInRange('2026-07-06', '2026-07-10')
      expect(rows.some(s => s.id === id)).toBe(true)
    })

    it('排除 updates 全在區間外的 storyline', async () => {
      const id = await insertStoryline({ title: 'test-range-out', thesis: 't', entities: ['y'] })
      await appendUpdateForTest(id, { briefDate: '2026-06-01', valence: 'extend', note: 'old' })

      const rows = await getStorylinesUpdatedInRange('2026-07-06', '2026-07-10')
      expect(rows.some(s => s.id === id)).toBe(false)
    })
  })
})

// ★ cap 邊界的 canonical 測試：純函式、不碰 DB，所以在 CI 的空 DB 與開發者本機
//   （已有 10 條真實 open 線）給出同一個答案。DB 測試只驗配額為 0／充足兩端的行為。
describe('newStorylineQuota', () => {
  it('預設上限 10：9 條 open 還剩 1 個配額、10 條就沒有了', () => {
    expect(newStorylineQuota(9)).toBe(1)
    expect(newStorylineQuota(10)).toBe(0)
  })

  it('open 數超過上限時配額是 0、不是負數', () => {
    expect(newStorylineQuota(23)).toBe(0)
  })

  it('cap 可由呼叫端覆寫', () => {
    expect(newStorylineQuota(10, 12)).toBe(2)
    expect(newStorylineQuota(0, 0)).toBe(0)
  })
})

describe('storylineUpdateSchema valence', () => {
  it('accepts a valence update', () => {
    const r = StorylineUpdateSchema.safeParse({ briefDate: '2026-06-23', valence: 'support', note: 'CPI 低於預期、支持降息論點' })
    expect(r.success).toBe(true)
  })

  it('rejects the legacy kind field', () => {
    const r = StorylineUpdateSchema.safeParse({ briefDate: '2026-06-23', kind: 'advance', note: 'x' })
    expect(r.success).toBe(false)
  })
})
