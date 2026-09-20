import { getDb } from '@suanomics/db/client'
import { storylines } from '@suanomics/db/schema'
import { and, asc, eq, lte, sql } from 'drizzle-orm'
import { z } from 'zod'

export const StorylineUpdateSchema = z.object({
  briefDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valence: z.enum(['support', 'challenge', 'extend']),
  // max(200)：prompt 要求 ≤100、200 是防禦上限、不要往下修
  note: z.string().min(1).max(200),
})
export type StorylineUpdate = z.infer<typeof StorylineUpdateSchema>

// 讀取 boundary 驗證 jsonb 欄位、對齊 articles-repo 慣例（不信任 DB row 裸型別）
const UpdatesSchema = z.array(StorylineUpdateSchema).default([])
const EntitiesSchema = z.array(z.string()).default([])
const StatusSchema = z.enum(['open', 'confirmed', 'refuted', 'dormant'])

export interface Storyline {
  id: number
  title: string
  thesis: string
  status: 'open' | 'confirmed' | 'refuted' | 'dormant'
  entities: string[]
  updates: StorylineUpdate[]
  lastTouchedBriefDate: string | null
}

// 私有 mapper：DB row → Storyline | null
// storyline 是加值資料、單筆髒 row 不該整批 fail：parse 失敗 → warn + 回 null、caller filter 掉
// （對齊 market-data-repo 的 skip+warn 慣例）
function toStorylineSafe(row: typeof storylines.$inferSelect): Storyline | null {
  try {
    return {
      id: row.id,
      title: row.title,
      thesis: row.thesis,
      status: StatusSchema.parse(row.status),
      entities: EntitiesSchema.parse(row.entities ?? []),
      updates: UpdatesSchema.parse(row.updates ?? []),
      lastTouchedBriefDate: row.lastTouchedBriefDate,
    }
  }
  catch (err) {
    const summary = err instanceof z.ZodError ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err)
    console.warn(`[storylines-repo] skip malformed row id=${row.id}: ${summary}`)
    return null
  }
}

/**
 * 目前 open 的敘事線（建立順序）。
 *
 * `asOf`（`YYYY-MM-DD`）是**報告日視角**的上界，兩層都要擋：
 * - 列層級：報告日之後才建立的線不該出現。
 * - `updates` 層級：editor 印的是**日期最新的 3 筆** update 加上各自的 briefDate
 *   （`editor.ts:61-65`），所以只擋列擋不住——補跑 09-02 的報告會印出帶 09-04 日期的進展。
 *   濾完連帶把 `lastTouchedBriefDate` 收斂回濾後的最後一筆，不然這份 as-of 視角裡會留著
 *   一個未來日期。線本身留著（updates 空陣列），editor 有「尚無進展」的分支。
 *
 * ★ **擋不到的那一層要知道**：`status` 沒有歷史。一條 09-02 當時是 open、09-04 才被判
 * confirmed 的線，今天用任何 asOf 查都不會回來——要修得存 status 變更史。
 *
 * 不帶 `asOf` 就是現況視角，給每日跑用（報告日就是今天，兩個上界都是 no-op）。
 */
export async function getOpenStorylines(asOf?: string): Promise<Storyline[]> {
  const db = getDb()
  // 台北日界：reportDate 是台北曆日，用 UTC 日界會把台北當天稍晚建立的線算成隔天。
  const rows = await db.select().from(storylines).where(asOf === undefined
    ? eq(storylines.status, 'open')
    : and(eq(storylines.status, 'open'), lte(storylines.createdAt, new Date(`${asOf}T23:59:59.999+08:00`)))).orderBy(asc(storylines.createdAt))
  return rows.flatMap((row) => {
    const s = toStorylineSafe(row)
    if (s === null)
      return []
    if (asOf === undefined)
      return [s]
    const updates = s.updates.filter(u => u.briefDate <= asOf)
    // ★ 不信任 updates 的寫入序（同 `storyline-block.ts` 那條）：`upsertSameDay` 寫入時是有
    //   排序，但那只是紀律、不是保證（見它的註解），所以這裡用 max 而不是 at(-1)。
    //   ISO date 字典序＝時間序。
    const lastTouchedBriefDate = updates.reduce<string | null>(
      (acc, u) => (acc === null || u.briefDate > acc ? u.briefDate : acc),
      null,
    )
    return [{ ...s, updates, lastTouchedBriefDate }]
  })
}

export async function getStorylinesTouchedOn(briefDate: string): Promise<Storyline[]> {
  const db = getDb()
  const rows = await db.select().from(storylines).where(sql`${storylines.updates} @> ${JSON.stringify([{ briefDate }])}::jsonb`)
  return rows.flatMap(row => toStorylineSafe(row) ?? [])
}

// 週末回顧：撈 updates 陣列中任一 briefDate 落在 [start, end]（含端點）的 storyline、不分 status
// （confirmed/refuted 的線是「本週兌現/被證偽」回顧最有價值的料）。jsonb array 用 EXISTS + BETWEEN。
export async function getStorylinesUpdatedInRange(start: string, end: string): Promise<Storyline[]> {
  const db = getDb()
  const rows = await db.select().from(storylines).where(
    sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${storylines.updates}) e WHERE e->>'briefDate' BETWEEN ${start} AND ${end})`,
  )
  return rows.flatMap(row => toStorylineSafe(row) ?? [])
}

export async function insertStoryline(p: { title: string, thesis: string, entities: string[] }): Promise<number> {
  const db = getDb()
  const [row] = await db.insert(storylines)
    .values({ title: p.title, thesis: p.thesis, entities: p.entities })
    .returning({ id: storylines.id })
  if (!row)
    throw new Error('insertStoryline: insert returned no row')
  return row.id
}

// 14 天無進展自動轉 dormant：editor 只看 open 線、過時線需自動退場避免 prompt 越塞越長
const DORMANT_AFTER_DAYS = 14
// open 線硬上限 10：editor prompt 已要求 ≥10 不提新線、此處為程式兜底防 LLM 失控
const OPEN_CAP = 10

/**
 * 這一批能新建幾條線＝上限扣掉目前 open 數（不為負）。
 *
 * 抽成純函式是為了讓 cap 的邊界能在**不依賴 DB 狀態**的情況下被測到：`applyEditorResult`
 * 裡的 open 數是全表 count，開發者本機（有真實資料、open 已頂在 10）跑的時候，
 * 任何踩在 cap 邊界上的斷言都會被既有資料決定，改壞 `OPEN_CAP` 也測不出來。
 */
export function newStorylineQuota(openCount: number, cap: number = OPEN_CAP): number {
  return Math.max(0, cap - openCount)
}

// 字串日期減 n 天 → ISO date（UTC 基準、純函式、避免時區漂移）
export function isoDateMinusDays(date: string, n: number): string {
  const ms = new Date(`${date}T00:00:00Z`).getTime() - n * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export interface ApplyEditorResultParams {
  briefDate: string
  touches: { storylineId: number, valence: 'support' | 'challenge' | 'extend', note: string }[]
  resolves: { storylineId: number, disposition: 'confirmed' | 'refuted', note: string }[]
  newStorylines: { title: string, thesis: string, entities: string[] }[]
  /**
   * open 線上限，預設 `OPEN_CAP`（10）。**只有測試會傳**：cap 看的是全表 open 數，
   * 本機有真實資料時會把測試想新建的線一併吃掉（症狀是 `created` 回 0 而非 1）。
   * production 呼叫端（`apps/server/src/jobs/handlers/brief-worker.ts`）不傳。
   */
  openCap?: number
  /**
   * 這一批看到的 open 線數，預設是 tx 內對全表現數的結果。**只有測試會傳**，理由與
   * `openCap` 不同、值得寫清楚：
   *
   * cap 解析（`p.openCap ?? OPEN_CAP`）唯一的外部可觀測後果是「配額夠不夠建新線」，
   * 而那要在 `openCount < cap` 的邊界上才看得出來——DB 已有 10 條以上 open 時，用的
   * cap 是 10 還是 0，`created` 都是 0，行為上無從分辨。而全表 open 數在並行測試下
   * 不穩定（同 package 的 `storyline-activity.db.test.ts` 會 seed／刪 open 列，那正是
   * 這個問題的成因）。所以要測「呼叫點的 `??` 右側是不是 OPEN_CAP」，就得讓測試把
   * openCount 釘在一個已知值上；否則判定會取決於執行當下 DB 裡有幾條 open，而那
   * 恰恰是好幾輪都沒解掉的那一格。
   *
   * production 呼叫端不傳。
   */
  openCount?: number
}

const DISPOSITION_TO_VALENCE = { confirmed: 'support', refuted: 'challenge' } as const

// 同日幂等：同 (storyline, briefDate) 取代而非疊加，避免 regen 重複、保每日 ≤1 筆不變式。
//
// 排序（ISO date 字典序＝時間序）純粹是為了**資料自洽**：純 append 在補跑舊報告日時會造出
// [09-05, 09-02] 這種陣列序≠時間序的列。★ 它**不是承重的不變式**，下游不准依賴它——
// 曾經的處置是把最後一個吃陣列尾巴的消費者（`editor.ts` 的近期進展）改成先依 briefDate
// 排序再取。掃過（`rg '\.updates\b' apps packages`）當時所有讀路徑後：對順序敏感的
// 四條都自己排序——`getOpenStorylines` 用 max、`storyline-block.ts:34` 用 reduce、
// `weekly-recap-block.ts:18` 自己 sort、`editor.ts:61` 排序後 slice；其餘（`podcast/generate.ts`
// 與內部評測 CLI 的 `find`、`storyline-activity.ts` 的計數）與順序無關。
// 理由：jsonb 欄位沒有 DB 約束、`0014` 是一次性 data migration、任何直寫
// `storylines.updates` 的程式（例如測試 helper `appendUpdateForTest`）都能無聲重建亂序，
// 所以「寫入端排好序」只能是紀律、當不了保證。新增讀路徑時照樣自己排序，
// 不要因為看到這裡有 sort 就省掉。
function upsertSameDay(updates: StorylineUpdate[], next: StorylineUpdate): StorylineUpdate[] {
  return [...updates.filter(u => u.briefDate !== next.briefDate), next]
    .sort((a, b) => a.briefDate.localeCompare(b.briefDate))
}

/**
 * 「最後進展日」只前進、不倒退（ISO date 字典序＝時間序）。
 *
 * 補跑 09-02 的報告不該讓一條上次進展在 09-05 的線倒退成 09-02——那個欄位的語意是
 * 「這條線最後一次有進展是哪天」，跟「這批寫入屬於哪個報告日」是兩回事。倒退會餵給
 * auto-dormant 的 `coalesce(last_touched_brief_date, created_at::date) < cutoff`，
 * 讓一條活著的線提早被判 dormant。
 */
export function laterBriefDate(existing: string | null, next: string): string {
  return existing !== null && existing > next ? existing : next
}

/**
 * 回傳值的 `openCap` 是**這一批實際套用的 open 上限**。
 *
 * 它存在的理由是可測性：cap 看的是全表 open 數，開發者本機（真實 open 已頂在 10）
 * 與別的測試檔並行 seed／刪列都會讓那個數字浮動，所以「配額為 0」這個外顯行為對
 * 「預設 cap 是 10 還是 0」天生無感——兩者都給 `created: 0`。在這個欄位之前，唯一印出
 * 實際 cap 的地方是下面那句 warn，而字串與 cap 的來源是同一份程式碼：把 `?? OPEN_CAP`
 * 改成 `?? 0`、同時把字串裡的 `${cap}` 寫死成 10，全檔測試照樣全綠。
 */
export async function applyEditorResult(p: ApplyEditorResultParams): Promise<{ touched: number, created: number, dormanted: number, resolved: number, openCap: number }> {
  const db = getDb()
  // 並發假設：同日重跑經 job dedupe 防護、force 重跑與排程並發的 lost-update 視窗已知且可接受（最壞丟一筆 append）、若 force 重跑常態化再加 SELECT FOR UPDATE
  return db.transaction(async (tx) => {
    // 1. auto-dormant：open 且 coalesce(lastTouched, createdAt::date) < cutoff（briefDate − 14 天）
    const cutoff = isoDateMinusDays(p.briefDate, DORMANT_AFTER_DAYS)
    const dormantRes = await tx.update(storylines)
      .set({ status: 'dormant' })
      .where(sql`${storylines.status} = 'open' AND coalesce(${storylines.lastTouchedBriefDate}, ${storylines.createdAt}::date) < ${cutoff}::date`)
      .returning({ id: storylines.id })

    // 2. valence touches：套用、維持 open、同日幂等（不再有終態邏輯）
    let touched = 0
    for (const t of p.touches) {
      const [row] = await tx.select().from(storylines).where(eq(storylines.id, t.storylineId))
      if (!row || row.status !== 'open') {
        console.warn(`[storylines-repo] skip touch for storyline id=${t.storylineId}: not found or not open`)
        continue
      }
      // note 是 LLM 給的、超 200 截斷後再 parse 比直接 fail 好（寫入邊界防呆）
      // parse 失敗（如空 note 被 min(1) 擋下）只 skip 該 touch + warn、不 throw 整批 rollback（與 unknown-id 同款防呆）
      let update: StorylineUpdate
      try {
        update = StorylineUpdateSchema.parse({ briefDate: p.briefDate, valence: t.valence, note: t.note.slice(0, 200) })
      }
      catch (err) {
        const summary = err instanceof z.ZodError ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err)
        console.warn(`[storylines-repo] skip malformed touch for storyline id=${t.storylineId}: ${summary}`)
        continue
      }
      const current = UpdatesSchema.parse(row.updates ?? [])
      await tx.update(storylines)
        .set({ updates: upsertSameDay(current, update), lastTouchedBriefDate: laterBriefDate(row.lastTouchedBriefDate, p.briefDate) })
        .where(eq(storylines.id, t.storylineId))
      touched += 1
    }

    // 2b. resolves：顯式了結→終態 confirmed/refuted（條件見下方 ★）、寫一筆 resolution update（同日取代）
    // 「須仍 open」的 guard 天然處理 resolve 的 regen 重複（第二次已非 open → skip、不重複收尾）
    //
    // ★ 補跑舊報告日**不改當前 status**：補跑是重建那一天的視角，不是重新宣判。
    //   `status` 沒有變更史，就地改寫不可逆——一條 09-05 還活著的線，被補跑 09-02 判成
    //   confirmed 之後就再也回不去，而且 as-of 查詢也查不回它當時是 open。判準借用
    //   `laterBriefDate`：這批寫入是該線最新的一筆時才改 status。三個邊界：
    //   同日（相等）→ 改；`lastTouchedBriefDate` 為 null → 改；補跑舊日 → 不改。
    //   resolution update 照樣寫進 `updates`（那天的 editor 確實下了這個判斷、是該報告日的
    //   真實紀錄），只是不動今天的 status。
    //
    //   ★ **判準擋得比你以為的少**：它比的是「這批寫入 vs **該線自己**最後一次進展」，
    //   不是「vs 今天」——`applyEditorResult` 只拿得到 `briefDate`、沒有今天的視角。所以
    //   擋住的只有「補跑日**早於**該線的 `lastTouchedBriefDate`」；等於或晚於它時照樣就地
    //   宣判。null 是這件事的極端情形而不是特例：它的意思是「從未被 touch 過」、不是
    //   「新線」（`insertStoryline` 不寫這個欄位，一條老線也可以一直是 null）。
    //   ★ **止不到多少、還有哪些擋牆、實測數字，刻意不抄進這裡**：
    //   那些是隨資料變動的量測結果，寫進註解就會腐爛，而且沒有任何機械物在守它
    //   （這一段連續被三輪獨立複查推翻，兩次方向還相反）。要真正擋住得有
    //   status 變更史，也就是刻意不做的另一半。
    //
    //   `resolved` 只計**真的發生狀態轉換**的那些：這個回傳值目前只有測試在讀
    //   （`brief-worker.ts:246` 丟棄它），語意上「了結了幾條線」不該把沒了結的算進去。
    let resolved = 0
    for (const r of p.resolves) {
      const [row] = await tx.select().from(storylines).where(eq(storylines.id, r.storylineId))
      if (!row || row.status !== 'open') {
        console.warn(`[storylines-repo] skip resolve for storyline id=${r.storylineId}: not found or not open`)
        continue
      }
      let update: StorylineUpdate
      try {
        update = StorylineUpdateSchema.parse({ briefDate: p.briefDate, valence: DISPOSITION_TO_VALENCE[r.disposition], note: r.note.slice(0, 200) })
      }
      catch (err) {
        const summary = err instanceof z.ZodError ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err)
        console.warn(`[storylines-repo] skip malformed resolve for storyline id=${r.storylineId}: ${summary}`)
        continue
      }
      const current = UpdatesSchema.parse(row.updates ?? [])
      const isLatestWrite = laterBriefDate(row.lastTouchedBriefDate, p.briefDate) === p.briefDate
      if (!isLatestWrite)
        console.warn(`[storylines-repo] backfill resolve for storyline id=${r.storylineId}: recorded the update for ${p.briefDate} but kept status (last touched ${row.lastTouchedBriefDate})`)
      await tx.update(storylines)
        .set({
          updates: upsertSameDay(current, update),
          ...(isLatestWrite ? { status: r.disposition } : {}),
          lastTouchedBriefDate: laterBriefDate(row.lastTouchedBriefDate, p.briefDate),
        })
        .where(eq(storylines.id, r.storylineId))
      if (isLatestWrite)
        resolved += 1
    }

    // 3. new lines：tx 內 count open（含本 tx 變動後）、配額 = OPEN_CAP − openCount、超額 slice + warn
    const [{ count: countedOpen } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(storylines)
      .where(eq(storylines.status, 'open'))
    const openCount = p.openCount ?? countedOpen
    const cap = p.openCap ?? OPEN_CAP
    const quota = newStorylineQuota(openCount, cap)
    const toCreate = p.newStorylines.slice(0, quota)
    if (toCreate.length < p.newStorylines.length)
      console.warn(`[storylines-repo] open cap ${cap} reached: dropped ${p.newStorylines.length - toCreate.length} new storyline(s)`)
    for (const n of toCreate)
      await tx.insert(storylines).values({ title: n.title, thesis: n.thesis, entities: n.entities })

    return { touched, created: toCreate.length, dormanted: dormantRes.length, resolved, openCap: cap }
  })
}
