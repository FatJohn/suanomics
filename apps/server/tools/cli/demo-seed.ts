#!/usr/bin/env tsx

// Demo 路徑第一步：把 canary-example 的合成新聞（8 篇虛構財經新聞，見
// `../eval/fixtures/canary-example/README.md`）灌進 `news_items`，讓 `brief:generate`
// 不必先跑約 30 分鐘、會打外部網路的 `news:refresh` 就有素材可選。
//
// ★★ 這支腳本只碰 DB，絕對不打任何 LLM——topicTags 直接沿用 fixture 裡已經標好的值，
//    不經過 `tag.ts` 的 LLM 打標；`brief:generate` 才是打 LLM 的那一步，由使用者自己
//    決定要不要跑、要跑哪一天。
import type { ItemCategory } from '@suanomics/db/news-categories'
import type { CanarySource } from '../eval/canary-fixtures.js'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { closeDb, getDb } from '@suanomics/db/client'
import { newsItems, newsSources } from '@suanomics/db/schema'
import { taipeiDateOf } from '@suanomics/shared'
import { loadCanarySources } from '../eval/canary-fixtures.js'
import { isValidEvalDate } from '../eval/date.js'
import { argValue } from './lib/smoke-args.js'

// ★ 顯式指向 example 目錄、不用 canary-fixtures.ts 匯出的 `CANARY_DIR`——那個常數優先
//   指向作者本機才有的「真」canary fixtures（第三方新聞全文，不隨公開 repo 發佈，見
//   `canary-fixtures.ts` 的 `resolveCanaryDir()`）。demo-seed 若跟著預設值走，會在作者
//   本機悄悄灌真新聞、只有在乾淨 clone 上才踩到合成資料——兩邊行為不一致，而這支腳本
//   存在的意義正是「乾淨 clone 也能看到報告」，顯式指定路徑讓兩邊行為一致。
const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLE_DIR = resolve(HERE, '../eval/fixtures/canary-example')

export const DEMO_SOURCE_SLUG = 'demo-example'
const DAY_MS = 86_400_000

// canary-example 底下有兩個日期目錄、各 4 筆，原始 publishedAt 寫死在 2026-03-01～03。
// 這裡把它們重新錨到 --date：第一個目錄的 4 筆錨在「--date 前一天」，第二個目錄的
// 4 筆錨在「--date 當天」，保留原本兩天陸續發生的敘事節奏，同時保留每筆相對於自己
// 那一天的時鐘時間（見 shiftToAnchor）。
const FIXTURE_DATES = ['2026-03-02', '2026-03-03'] as const

// 按原始 fixture id 手動標的 item-level 分類（依 topicTags 的內容判斷），依據見
// packages/db/src/news-categories.ts 的 ITEM_CATEGORIES。刻意手動標好、不留給
// resolveItemCategory 的 fallback 去猜：那條路會先查 categoryForSlug('demo-example')，
// 這個 slug 不在 SEED 裡、每次選稿都會印一次「未知來源」警告，且一律 fallback 'macro'。
const CATEGORY_BY_ID: Record<number, ItemCategory> = {
  1001: 'tech-semi', // 北成電子出口值＋AI 晶片訂單
  1002: 'international', // 紅海航道＋海緯航運運價
  1003: 'macro', // CPI 年增率
  1004: 'tw-equity-other', // 龍鼎金控法說、商用不動產放款
  1005: 'tech-semi', // 資料中心資本支出
  1006: 'macro', // Fed 政策、台股連動
  1007: 'international', // 紅海航道、供應鏈
  1008: 'macro', // 就業與薪資成長
}

interface DemoRow {
  externalId: string
  title: string
  url: string
  contentText: string
  topicTags: string[]
  publishedAt: Date
  category: ItemCategory
}

/**
 * 把 `original` 搬到 `anchorDay`，保留當天的時鐘時間。
 *
 * ★ 基準是 `original` **自己那一天**，不是它所屬的 fixture 目錄名。兩者差一天：
 *   fixture 的 publishedAt 是 `2026-03-01T22:10Z` 而目錄叫 `2026-03-02`（台北早上等於
 *   UTC 前一天晚上）。用目錄名當基準會讓整批比 anchorDay 早一天落地——CI 的真 DB 測試
 *   實際抓到過這件事（預期 01-14、實得 01-13）。
 */
function shiftToAnchor(original: string, fixtureDay: string, anchorDay: string): Date {
  const offsetMs = new Date(original).getTime() - new Date(`${fixtureDay}T00:00:00.000Z`).getTime()
  return new Date(new Date(`${anchorDay}T00:00:00.000Z`).getTime() + offsetMs)
}

function buildRows(reportDate: string): DemoRow[] {
  const reportDateMs = new Date(`${reportDate}T00:00:00.000Z`).getTime()
  const rows: DemoRow[] = []
  FIXTURE_DATES.forEach((fixtureDay, i) => {
    // i=0（較舊的那個目錄）錨在「前一天」；i=1（較新的那個目錄）錨在「當天」。
    const anchorDay = new Date(reportDateMs - (FIXTURE_DATES.length - 1 - i) * DAY_MS).toISOString().slice(0, 10)
    const sources: CanarySource[] = loadCanarySources(fixtureDay, EXAMPLE_DIR)
    for (const s of sources) {
      rows.push({
        externalId: `example-${s.id}`,
        title: s.title,
        url: s.url,
        contentText: s.contentText,
        topicTags: s.topicTags ?? [],
        publishedAt: shiftToAnchor(s.publishedAt, s.publishedAt.slice(0, 10), anchorDay),
        category: CATEGORY_BY_ID[s.id] ?? 'macro',
      })
    }
  })
  return rows
}

export interface SeedDemoNewsResult {
  sourceId: number
  insertedCount: number
}

/**
 * 核心邏輯，抽出來讓 `demo-seed.db.test.ts` 可以直接呼叫、不必經過 CLI 的
 * `process.exit`。呼叫端負責驗證 `reportDate` 格式（CLI 入口在下面 `main()` 做）、
 * 也負責在跑完之後決定要不要 `closeDb()`——測試檔通常要在同一個 process 裡連續
 * 呼叫好幾次（驗 idempotent），不該每次都關掉連線。
 */
export async function seedDemoNews(reportDate: string): Promise<SeedDemoNewsResult> {
  const rows = buildRows(reportDate)
  const db = getDb()

  // fetchedAt 釘死在報告日的 UTC 00:00、不用「現在」：`getRelevanceCandidates()` 的候選窗
  // 是 `[reportDate-14天 00:00Z, reportDate 23:59:59.999Z]`，卡的是 `fetched_at`、不是
  // `published_at`（見 packages/db/src/repos/news-repo.ts:176-178, 193）。釘死在報告日
  // 當天，讓這批資料不論 demo:seed 與 brief:generate 實際執行的當下時間差多少都篤定
  // 落在窗內，不必依賴兩支指令剛好在同一天跑。
  const fetchedAt = new Date(`${reportDate}T00:00:00.000Z`)

  // ★ isActive: false，而且 demo 照樣選得到——這兩件事同時成立是刻意的。
  //   `getRelevanceCandidates()`（packages/db/src/repos/news-repo.ts:172）雖然 innerJoin
  //   `news_sources`，但**沒有**過濾 `is_active`，所以停用的來源仍然進得了候選池。
  //   而 `runNewsRefresh()` 撈的是 `getActiveSources()`（同檔 :42，全 repo 只有 refresh
  //   在用），停用之後它就不會去打這個根本不存在的 RSS。
  //   兩邊合起來：demo 跑得起來，而且如果日後在同一個 DB 上接真實新聞來源，這一列
  //   不會變成一個每輪都失敗的死 feed 去污染 `news:health` 的 silent／never 判定。
  // ★ 另外，這裡刻意不經過 packages/db/src/source-policy.ts 的 seed gate——那個 gate 管的
  //   是「隨 repo 發佈的抓取配方」（db:seed／seed:external-sources 的內容），這裡是本機
  //   demo 用的手動素材，不是配方，不受它管轄。
  const [source] = await db.insert(newsSources).values({
    slug: DEMO_SOURCE_SLUG,
    displayName: 'Demo 合成新聞（虛構，供 5 分鐘 demo 路徑使用）',
    rssUrl: 'https://example.com/demo-fixtures',
    isActive: false,
  }).onConflictDoUpdate({
    target: newsSources.slug,
    set: {
      displayName: 'Demo 合成新聞（虛構，供 5 分鐘 demo 路徑使用）',
      rssUrl: 'https://example.com/demo-fixtures',
      isActive: false,
    },
  }).returning({ id: newsSources.id })
  if (!source)
    throw new Error('[demo:seed] news_sources upsert 沒有回傳 id')

  for (const row of rows) {
    await db.insert(newsItems).values({
      sourceId: source.id,
      externalId: row.externalId,
      title: row.title,
      url: row.url,
      publishedAt: row.publishedAt,
      fetchedAt,
      contentText: row.contentText,
      contentSource: 'user-paste',
      category: row.category,
      topicTags: row.topicTags,
    }).onConflictDoUpdate({
      target: [newsItems.sourceId, newsItems.externalId],
      set: {
        title: row.title,
        url: row.url,
        publishedAt: row.publishedAt,
        fetchedAt,
        contentText: row.contentText,
        contentSource: 'user-paste',
        category: row.category,
        topicTags: row.topicTags,
      },
    })
  }

  return { sourceId: source.id, insertedCount: rows.length }
}

async function main(): Promise<void> {
  const dateArg = argValue('--date')
  const reportDate = dateArg ?? taipeiDateOf(new Date())
  if (!isValidEvalDate(reportDate)) {
    console.error(`[demo:seed] 不合法的 --date「${reportDate}」（需 YYYY-MM-DD）`)
    process.exit(1)
  }

  const { insertedCount } = await seedDemoNews(reportDate)

  console.warn(`[demo:seed] 灌入 ${insertedCount} 筆合成新聞（來源 slug=${DEMO_SOURCE_SLUG}），報告日=${reportDate}`)
  console.warn(`[demo:seed] 下一步：pnpm --filter server run brief:generate ${reportDate}`)
  console.warn('[demo:seed] （這一步會打 LLM，需要有效的 GEMINI_API_KEY 或其他已設定的 provider——見 docs/architecture/agents-and-prompts.md「接自己的 LLM」）')

  await closeDb()
}

// 只有直接執行時才跑 CLI（同 brief-rerun.ts 的守衛）；被 vitest import 純函式／
// `seedDemoNews` 時不觸發（argv[1] 為 vitest binary、不相符）。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[demo:seed] failed:', err)
    process.exit(1)
  })
}
