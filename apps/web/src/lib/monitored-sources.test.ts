import { describe, expect, it } from 'vitest'
// 用 Vite 的 ?raw 而不是 node:fs：apps/web 的 tsconfig 只帶 vite/client 型別，
// 為了一支測試把 @types/node 裝進一個瀏覽器 package，等於讓前端程式碼也看得到 node API。
// 副檔名不能省——?raw 是照字面解析檔案路徑，沒有副檔名就找不到那支檔。
// eslint-disable-next-line import-x/extensions -- ?raw 需要完整檔名
import seedSource from '../../../../packages/db/src/seed-external-sources.ts?raw'
import { MONITORED_SOURCE_GROUPS, TOTAL_MONITORED_SOURCES } from './monitored-sources.js'

/**
 * 這份清單是 packages/db 的 external_sources seed 的**手抄快照**——web 不依賴 @suanomics/db
 * （也不該為了一頁靜態清單去依賴它）。所以對齊靠下面的跨檔守衛，不是靠人記得。
 *
 * 兩次被獨立複查修正過方向：
 * ① 第一版寫「TOTAL 等於各組加總」，是恆真的鏡像斷言（逐字重算 TOTAL 自己的定義式）。
 * ② 第二版改成比**數量**，但把某條的 viaAggregator 搬到另一條上照樣全綠——所以現在比的是
 *    `seedSlug` 的**身分集合**。
 *
 * 注意這支測試的失敗形態：seed 檔若被搬走或改名，Vite 在載入期就丟 ENOENT，整個檔案
 * 「no tests」而不是某一條 FAIL——仍然是紅的，但別以為下面哪一條會給你友善訊息。
 */
// ★ 連 enabled 一起讀出來：seed 可以把某個來源標成 enabled: false（getSourceActivity 與
//   corpus dispatcher 都只取啟用中的），那種來源不該出現在讀者的「監測來源」頁上。
//   2026-08-22 之前這支只比 slug 集合，所以停用一個來源之後頁面照樣列它、數量照樣算它，
//   而沒有任何測試會叫。
//
// ★★ 用「切成一筆一段」而不是單行 regex：第一版把 enabled 綁在 slug 同一行上，若哪天有人
//    把某筆寫成多行（或把 enabled 放到 config 之後），**那一整筆會從結果裡消失**——不是誤判
//    成啟用，是整個看不見，於是停用守衛對它完全失明而測試全綠。2026-08-22 的獨立複查
//    實測出這個洞。切段之後 enabled 出現在該筆的哪一行都讀得到，而下面那條數量守衛
//    負責讓「切法失效」變成紅燈而不是靜默。
function seedEntries(): { slug: string, displayName: string, enabled: boolean }[] {
  const chunks = seedSource.split(/(?=slug: ')/).slice(1)
  return chunks.map((chunk) => {
    const slug = /^slug: '([^']+)'/.exec(chunk)?.[1] ?? ''
    const displayName = /displayName: '([^']+)'/.exec(chunk)?.[1] ?? ''
    return { slug, displayName, enabled: !chunk.includes('enabled: false') }
  }).filter(e => e.slug !== '')
}

const allSources = MONITORED_SOURCE_GROUPS.flatMap(g => g.sources)

describe('monitored-sources', () => {
  // 上面那個切法一旦失效（例如 seed 改用別的寫法），下面每一條守衛都會安靜地少驗幾筆。
  // 這條讓「切法失效」本身變成紅燈。
  //
  // ★ 交叉比對刻意用 `displayName: '` 而不是 `slug: '`：後者正是切法自己用的 pattern，
  //   拿它來數等於自己驗自己——pattern 一變兩邊一起瞎。displayName 是獨立訊號，
  //   某筆的 slug 若寫成別的格式，那一筆會被併進前一段，解析筆數就比 displayName 數少。
  it('解析出的筆數等於 seed 裡的 displayName 數（切法失效要紅，不是靜默漏掉）', () => {
    const rawCount = (seedSource.match(/displayName: '/g) ?? []).length
    expect(rawCount).toBeGreaterThan(0)
    expect(seedEntries()).toHaveLength(rawCount)
  })

  it('seedSlug 集合與 external_sources seed 的啟用中來源逐一對應', () => {
    const seeded = seedEntries().filter(e => e.enabled).map(e => e.slug).sort()
    expect(seeded.length).toBeGreaterThan(0)
    expect(allSources.map(s => s.seedSlug).sort()).toEqual(seeded)
    expect(TOTAL_MONITORED_SOURCES).toBe(seeded.length)
  })

  // 反向對照：停用的來源不得出現在讀者頁。頁尾與 SourcesView 都印 TOTAL_MONITORED_SOURCES，
  // 把抓不到的來源算進「監測 N 個頻道」就是對讀者不實。
  it('seed 裡停用的來源不得出現在頁面清單', () => {
    const disabled = seedEntries().filter(e => !e.enabled).map(e => e.slug)
    expect(disabled.length).toBeGreaterThan(0) // 沒有停用來源時這條就失去意義，先確認樣本存在
    const listed = new Set(allSources.map(s => s.seedSlug))
    expect(disabled.filter(slug => listed.has(slug))).toEqual([])
  })

  it('viaAggregator 標在 seed 註明 Google News proxy 的那幾條上', () => {
    // 守的是「頁面上講的取得方式」與資料層對得上——而且是逐條對，不是數量對得上就好。
    // 最初版本在頁面上用一句範圍模糊的散文帶過，結果把兩條官方來源講反了。
    // ★ 也要濾掉停用的：頁面只列啟用中的來源，這裡若拿 seed 全集比，**停用一個 proxy
    //   並照規矩把它從頁面移除，這條就會紅**——做對事被測試擋，正是這一輪在修的形狀。
    //   2026-08-22 的獨立複查實測出這條漏網（前一條改了、這條沒跟上）。
    const seededProxies = seedEntries()
      .filter(e => e.enabled && e.displayName.includes('Google News proxy'))
      .map(e => e.slug)
      .sort()
    const marked = allSources.filter(s => s.viaAggregator).map(s => s.seedSlug).sort()
    expect(marked).toEqual(seededProxies)
  })

  it('每一組都至少有一個來源', () => {
    for (const group of MONITORED_SOURCE_GROUPS)
      expect(group.sources.length).toBeGreaterThan(0)
  })

  it('組名不重複', () => {
    const labels = MONITORED_SOURCE_GROUPS.map(g => g.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('來源名稱全域不重複（同一個頻道不該列兩次）', () => {
    const names = allSources.map(s => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('official 只出現在官方機構那兩組', () => {
    // chip 的 --official 變體是語意標示不是裝飾：它宣稱發布者是官方機構本身。
    // 它與 viaAggregator 正交——官方機構也可能是經聚合器抓到的。
    const officialGroups = MONITORED_SOURCE_GROUPS.filter(g => g.sources.some(s => s.official))
    expect(officialGroups.map(g => g.label)).toEqual(['台灣官方機構', '國際官方機構'])
    for (const group of officialGroups)
      expect(group.sources.every(s => s.official)).toBe(true)
  })
})
