import { getDb } from '@suanomics/db/client'
import { storylines } from '@suanomics/db/schema'

/** 某個報告日被寫進 `updates` 的敘事線數，以及其中真的帶得動敘事的筆數。 */
export interface StorylineDayActivity {
  touched: number
  /** `note` 有非空白內容的筆數。note 是唯一會進 `storylineBlock` 餵給 narrative 的欄位。 */
  usable: number
}

export interface StorylineActivity {
  /**
   * 目前 `status='open'` 的敘事線數。
   *
   * ★ 這才是「能不能用」：editor 下一輪只看得到 open 線（`getOpenStorylines`），
   * 一旦 open 池歸零，`storylineBlock` 就是空字串、跨日連續性靜默斷掉，而 storylines
   * 這張表照樣有一堆 dormant／confirmed 的列——「有沒有」永遠說健康。
   */
  open: number
  /** 全表列數。與 open 一起看才知道「零 open」是空資料庫還是整池退場。 */
  total: number
  /** 只含呼叫端問的那些日期；沒有任何敘事線被觸及的日期回 `{ touched: 0, usable: 0 }`。 */
  byDate: Record<string, StorylineDayActivity>
}

function hasText(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/** 計數用的最小列形狀。刻意不是 `Storyline`——這支要看的是原始 jsonb，不是 parse 過的。 */
export interface StorylineCountableRow {
  status: string
  updates: unknown
}

/**
 * 純函式：把原始列折成計數。**與 DB 查詢分開是為了測得到 `open`／`total`**——
 * 那兩個數字是全表的，真 DB 測試裡沒有任何前綴隔離擋得住同一張表上的其他測試檔
 * （`storylines-repo.test.ts` 會 insert open 線、還會跑不分前綴的 auto-dormant sweep）。
 * ★ 那支到底插幾條、怎麼擋 sweep，**這裡刻意不複述**——同一句機制描述在這個 package 裡
 * 曾經散成四份，改一次行為就落後四處（不同改動各撞到一次）。要細節去看那支的
 * `不傳 openCap 時預設上限就是 10` 與 `applyForTest`。
 * 用增量斷言也不夠：污染發生在「量測期間」，前後兩次讀之間就變了。
 * 2026-08-23 實測那種寫法三次跑紅一次，而且紅的訊息與真回歸長得一模一樣。
 */
export function summarizeStorylineRows(
  rows: readonly StorylineCountableRow[],
  dates: readonly string[],
): StorylineActivity {
  const byDate: Record<string, StorylineDayActivity> = {}
  for (const d of dates)
    byDate[d] = { touched: 0, usable: 0 }

  let open = 0
  for (const row of rows) {
    if (row.status === 'open')
      open += 1
    const updates = Array.isArray(row.updates) ? row.updates : []
    // 同一條線在同一個 briefDate 只會有一筆（`upsertSameDay`），所以不必去重；
    // 真的出現重複也如實計數——那是資料壞了，不該被訊號抹平。
    for (const u of updates) {
      if (typeof u !== 'object' || u === null)
        continue
      const entry = u as Record<string, unknown>
      const d = entry.briefDate
      if (typeof d !== 'string')
        continue
      const bucket = byDate[d]
      if (!bucket)
        continue
      bucket.touched += 1
      if (hasText(entry.note))
        bucket.usable += 1
    }
  }

  return { open, total: rows.length, byDate }
}

/**
 * 敘事線子系統的健康訊號。之前它一個訊號都沒有——沒有任何 route 讀過敘事線的健康狀態
 * （現在 `ops.ts` 有讀，見 `getStorylineActivity` 的呼叫點），而跨日連續性是這個產品賭的 moat。
 *
 * **為什麼在 JS 數而不是寫 SQL**：判準（note 有沒有內容）要與 `StorylineUpdateSchema`
 * 的意圖一致，用 `jsonb_array_elements` 疊出來的版本遲早與 JS 那份分岔，而分岔的方向
 * 是靜默的。理由與 `news-source-activity.ts` 完全相同。代價是整表撈回來——prod 2026-08-23
 * 是 20 列（上限機制：open 硬上限 10、其餘轉 dormant 後留著），這個函式預期呼叫頻率低：
 * 一天只被排程或外部監控打幾次的量級。
 *
 * **刻意不重用 `storylines-repo.ts` 的 `toStorylineSafe`**：那支對不合 schema 的列
 * `console.warn` 之後回 null、由呼叫端 filter 掉。健康訊號吃了它就會把「這列壞掉」
 * 變成「這列不存在」——正是這支要抓的東西。所以這裡直接讀原始 jsonb、自己防禦。
 */
export async function getStorylineActivity(dates: readonly string[]): Promise<StorylineActivity> {
  const rows = await getDb()
    .select({ status: storylines.status, updates: storylines.updates })
    .from(storylines)
  return summarizeStorylineRows(rows, dates)
}
