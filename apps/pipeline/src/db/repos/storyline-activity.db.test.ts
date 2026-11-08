import { closeDb, getDb } from '@suanomics/db/client'
import { storylines } from '@suanomics/db/schema'
import { like } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getStorylineActivity, summarizeStorylineRows } from './storyline-activity.js'

// 真 DB 整合測試。理由同 news-source-activity.db.test.ts：這支讀的是 jsonb 陣列，
// fake 一個 driver 出來只會驗到我自己對 jsonb 的想像。
//
// ★ **這支只驗 DB 那一層**：seed 的列撈得回來、jsonb 讀出來就是純函式吃的形狀、
//   `getStorylineActivity` 的回傳合約（鍵齊全、值是 number）。**計數語意不在這裡**
//   （touched/usable 的判準、雜項防禦、非陣列的列怎麼算）——那些在
//   storyline-activity.test.ts 對 `summarizeStorylineRows` 測，這裡重複一遍只是多一份
//   會腐爛的副本。`open`／`total` 同理：那是全表數字，同 package 的 storylines-repo.test.ts
//   會在同一張表上 insert open 線、還會跑不分前綴的 auto-dormant sweep，vitest 又平行跑
//   檔案（插幾條、怎麼擋 sweep 看那支的 `不傳 openCap 時預設上限就是 10` 與 `applyForTest`，
//   這裡不複述——同一句機制描述在這個 package 裡曾經散成四份，改一次行為就落後四處）。
//
// ★ **絕對值只寫在前綴過濾過的列上**（`seededRows()`），不寫在 `getStorylineActivity`
//   的回傳上。後者是無 where 的全表 select，真實資料只要在那幾天有進展就會把數字墊高。
//   2026-09-07 之前這裡的絕對值是靠**日期錨點**躲開的——錨在 2025-03，而本機真實
//   `briefDate` 落在 2026-06 之後，那三天剛好 0 筆。那不是隔離，是運氣：把舊版的錨點換成
//   現在用的這三天，舊版 6 條裡 4 條立刻紅（`touched: 1` 變成 `5`）。
//
// ★ **沒有斷言守著「production 那條 select 是全表、沒被加上 where」**，這是明知的缺口。
//   試過用 `getStorylineActivity(...) >= 前綴過濾的計數` 來守：實測無效——把 production
//   改成 `.where(notLike(title, 'slact-%'))`（正好濾掉測試列）之後，含那條在內的 5 條照樣
//   全綠——本機真實資料 21 列就讓 `>=` 恆成立；而在空 DB 的 CI 上同一條反而會無故變紅
//   （所以那條已經移除，不是留著當保險）。任何用全表
//   數字寫的斷言都會被真實資料污染，delta 寫法又擋不住 vitest 平行跑檔案時的併發寫入。
//   要真的守住得讓 production 把查詢本身暴露出來（`.toSQL()` 檢查），那是為了測試改
//   production 簽章，先不做。
//
// ★ 前綴刻意**不是** `test-`：storylines-repo.test.ts 的 cleanup 是
//   `like(title, 'test-%')`，撞上去它會刪掉我剛 seed 的列（vitest 平行跑檔案）。
//   ★ 這裡曾寫著「它有一條 `filter(startsWith('test-')).length === 10` 的 OPEN_CAP 斷言」，
//   那條後來刪掉了。留著會讓下一個人去找一條不存在的斷言，並誤以為
//   換前綴能擋掉那支的 open 計數。
//
// ★ **這支 seed 的 open 列曾經會讓那支的 cap 測試間歇紅**：那條舊版先讀
//   不分前綴的 `getOpenStorylines().length` 再補到 10，我的列在兩次讀之間進出就會讓
//   quota 不是 0。**已修掉**——它不再讀全表 open 數，所以
//   這支 seed 幾條 open 列都不影響它。反向的耦合也不必再擔心：那支的
//   `applyEditorResult` 呼叫一律走 `applyForTest`，briefDate 被釘在 2026-06 上半，
//   auto-dormant 的 cutoff 掃不到我這些 `createdAt` 是今天的列。
const P = 'slact-'
// ★ 刻意挑**本機真的有報告的日期**，不挑一個沒人用的年份。錨點若是空的，下一個人看不出
//   隔離是真的還是運氣——而這支測試的全部價值就在「錨點是什麼都不影響結果」。
const D1 = '2026-09-02'
const D2 = '2026-09-03'
const D3 = '2026-09-04'

async function cleanup() {
  await getDb().delete(storylines).where(like(storylines.title, `${P}%`))
}

/**
 * ★ `lastTouchedBriefDate` 一律留 null。storylines-repo.test.ts 的 applyEditorResult
 * 會跑 auto-dormant sweep，把 `coalesce(lastTouched, createdAt::date) < briefDate-14`
 * 的 open 線全部轉 dormant——**不分前綴**。留 null 時 coalesce 取 createdAt（今天），
 * 而那支的 briefDate 被 `applyForTest` 釘在 2026-06 上半（守門用），算出來的 cutoff
 * 遠早於今天，我的 open 列才不會被它掃掉。
 */
async function seed(title: string, status: string, updates: unknown) {
  await getDb().insert(storylines).values({
    title: `${P}${title}`,
    thesis: 't',
    status,
    entities: [],
    updates: updates as unknown[],
  })
}

/**
 * 只撈這支測試 seed 的列，select 的欄位與 `getStorylineActivity` 那條完全相同。
 * 絕對值斷言都建在這上面——真實資料進不來，錨點日期挑哪一天都不影響。
 */
async function seededRows() {
  return getDb()
    .select({ status: storylines.status, updates: storylines.updates })
    .from(storylines)
    .where(like(storylines.title, `${P}%`))
}

function upd(briefDate: string, note = '這條線今天有進展') {
  return { briefDate, valence: 'support', note }
}

describe('storylines 的 jsonb 讀回來的形狀 (real DB)', () => {
  beforeEach(cleanup)
  afterEach(cleanup)
  afterAll(async () => {
    await closeDb()
  })

  it('★ updates 原樣讀得回來：陣列、非陣列、以及陣列裡的雜項', async () => {
    // 純函式測試假設「Postgres 交回來的就是我寫進去的 JS 值」。這一條就是在驗那個假設——
    // 它是 fake driver 唯一驗不到的東西，也是這支測試存在的理由。
    await seed('array', 'open', [upd(D1), upd(D2)])
    await seed('nonarray', 'open', { nope: true })
    await seed('junk', 'dormant', ['字串', null, { valence: 'support', note: 'x' }, { briefDate: 20260902, note: 'x' }])

    const rows = await seededRows()
    expect(rows).toHaveLength(3)
    expect(rows).toEqual(expect.arrayContaining([
      { status: 'open', updates: [upd(D1), upd(D2)] },
      { status: 'open', updates: { nope: true } },
      // 數字 briefDate 不會被 pg 悄悄轉成字串——純函式的 `typeof d !== 'string'` 那條防禦
      // 守的就是這個形狀，它若在 DB 這一層就變了字串，那條防禦等於沒被測到
      { status: 'dormant', updates: ['字串', null, { valence: 'support', note: 'x' }, { briefDate: 20260902, note: 'x' }] },
    ]))
  })

  it('撈出來的列餵進 summarizeStorylineRows 得到預期計數', async () => {
    // 接縫測試：select 的欄位名與純函式的 `StorylineCountableRow` 對得上。
    // 計數語意本身在 storyline-activity.test.ts，這裡只驗兩邊接得起來。
    await seed('a', 'open', [upd(D1), upd(D2)])
    await seed('b', 'dormant', [upd(D1)])
    await seed('c', 'confirmed', [upd(D2)])

    const r = summarizeStorylineRows(await seededRows(), [D1, D2, D3])
    expect(r).toEqual({
      open: 1,
      total: 3,
      byDate: {
        [D1]: { touched: 2, usable: 2 },
        [D2]: { touched: 2, usable: 2 },
        // 沒人碰過的日子要回 0，不能整個鍵消失
        [D3]: { touched: 0, usable: 0 },
      },
    })
  })

  it('getStorylineActivity 的回傳合約：問到的鍵一個不少、值都是 number', async () => {
    // 監控端常直接用 jq 讀這份 JSON：鍵少一個或值不是 number，下游就讀不到或讀錯。
    // 這裡刻意不寫絕對值——全表 select 的數字會被真實資料墊高。
    await seed('a', 'open', [upd(D1)])

    const a = await getStorylineActivity([D1, D2, D3])
    expect(Object.keys(a.byDate)).toEqual([D1, D2, D3])
    for (const d of [D1, D2, D3]) {
      expect(typeof a.byDate[d]?.touched).toBe('number')
      expect(typeof a.byDate[d]?.usable).toBe('number')
    }
    expect(typeof a.open).toBe('number')
    expect(typeof a.total).toBe('number')
  })

  it('只回問到的日期，不順便把別的日子倒出來', async () => {
    await seed('a', 'open', [upd(D1), upd(D2)])
    expect(Object.keys((await getStorylineActivity([D2])).byDate)).toEqual([D2])
  })
})
