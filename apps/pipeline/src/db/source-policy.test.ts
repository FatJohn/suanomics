import { describe, expect, it } from 'vitest'
import { EXTERNAL_SOURCES_SEED, RESOLVED_EXTERNAL_SOURCES_GATE } from './seed-external-sources.js'
import { RESOLVED_SEED_GATE, SEED } from './seed.js'
import { applySeedGate, collectHttpUrls, downgradeAllowed, effectiveEnabled, isOfficialSourceUrl, OFFICIAL_SOURCE_DOMAINS, shouldBlockDowngrade, thirdPartySourcesEnabled } from './source-policy.js'

describe('isOfficialSourceUrl', () => {
  it('oFFICIAL_SOURCE_DOMAINS 裡的網域本身算官方', () => {
    for (const domain of OFFICIAL_SOURCE_DOMAINS)
      expect(isOfficialSourceUrl(`https://${domain}/x`), domain).toBe(true)
  })

  it('官方網域的子網域也算官方', () => {
    expect(isOfficialSourceUrl('https://www.cbc.gov.tw/tw/rss-302-1.xml')).toBe(true)
    expect(isOfficialSourceUrl('https://www.eia.gov/rss/todayinenergy.xml')).toBe(true)
    expect(isOfficialSourceUrl('https://openapi.twse.com.tw/v1/news/newsList')).toBe(true)
  })

  it('★ 反例：偽裝成官方網域尾綴的攻擊網域不算官方', () => {
    expect(isOfficialSourceUrl('https://eia.gov.attacker.com/x')).toBe(false)
  })

  it('★ 反例：以官方網域字串結尾但不是子網域分隔的網域不算官方', () => {
    expect(isOfficialSourceUrl('https://notfsc.gov.tw/x')).toBe(false)
  })

  it('非官方網域回 false', () => {
    expect(isOfficialSourceUrl('https://news.google.com/rss/search?q=x')).toBe(false)
    expect(isOfficialSourceUrl('https://ctee.com.tw/feed')).toBe(false)
  })

  it('壞掉的 URL 回 false 而不是拋', () => {
    expect(isOfficialSourceUrl('not a url')).toBe(false)
  })
})

describe('thirdPartySourcesEnabled', () => {
  it('未設定回 false', () => {
    expect(thirdPartySourcesEnabled({})).toBe(false)
  })

  it('true（不分大小寫、可有前後空白）回 true', () => {
    expect(thirdPartySourcesEnabled({ SEED_THIRD_PARTY_SOURCES: 'true' })).toBe(true)
    expect(thirdPartySourcesEnabled({ SEED_THIRD_PARTY_SOURCES: 'TRUE' })).toBe(true)
    expect(thirdPartySourcesEnabled({ SEED_THIRD_PARTY_SOURCES: '  true  ' })).toBe(true)
  })

  it('其餘任何值一律回 false', () => {
    expect(thirdPartySourcesEnabled({ SEED_THIRD_PARTY_SOURCES: 'false' })).toBe(false)
    expect(thirdPartySourcesEnabled({ SEED_THIRD_PARTY_SOURCES: '1' })).toBe(false)
    expect(thirdPartySourcesEnabled({ SEED_THIRD_PARTY_SOURCES: 'yes' })).toBe(false)
    expect(thirdPartySourcesEnabled({ SEED_THIRD_PARTY_SOURCES: '' })).toBe(false)
  })

  it('預設參數讀 process.env', () => {
    expect(() => thirdPartySourcesEnabled()).not.toThrow()
  })
})

describe('effectiveEnabled', () => {
  it('declared=false 一律 false，不因 optIn 復活', () => {
    expect(effectiveEnabled(['https://www.eia.gov/x'], false, false)).toBe(false)
    expect(effectiveEnabled(['https://www.eia.gov/x'], false, true)).toBe(false)
    expect(effectiveEnabled(['https://ctee.com.tw/feed'], false, true)).toBe(false)
  })

  it('declared=true 且所有 URL 都官方 → true（無論 optIn）', () => {
    expect(effectiveEnabled(['https://www.eia.gov/x'], true, false)).toBe(true)
    expect(effectiveEnabled(['https://www.eia.gov/x'], true, true)).toBe(true)
  })

  it('declared=true 且所有 URL 都是官方（多個 URL）→ true', () => {
    expect(effectiveEnabled(['https://www.eia.gov/a', 'https://www.cbc.gov.tw/b'], true, false)).toBe(true)
  })

  it('★ declared=true 且有任一 URL 非官方 → 沒開 optIn 就是 false（不是「有任一官方就算」）', () => {
    expect(effectiveEnabled(['https://www.eia.gov/a', 'https://ctee.com.tw/b'], true, false)).toBe(false)
  })

  it('declared=true 且有任一 URL 非官方，但 optIn=true → true', () => {
    expect(effectiveEnabled(['https://www.eia.gov/a', 'https://ctee.com.tw/b'], true, true)).toBe(true)
  })

  it('declared=true 且全部 URL 都非官方，optIn=true → true；optIn=false → false', () => {
    expect(effectiveEnabled(['https://ctee.com.tw/feed'], true, true)).toBe(true)
    expect(effectiveEnabled(['https://ctee.com.tw/feed'], true, false)).toBe(false)
  })

  it('declared=true 但沒有任何 URL（空陣列）→ 不算官方，需要 optIn', () => {
    expect(effectiveEnabled([], true, false)).toBe(false)
    expect(effectiveEnabled([], true, true)).toBe(true)
  })
})

describe('collectHttpUrls', () => {
  it('從巢狀物件與陣列收集所有 http(s) 字串', () => {
    const config = {
      feedUrl: 'https://example.com/a.xml',
      nested: { listingUrl: 'https://example.com/b', headers: { Authorization: 'not-a-url' } },
      list: ['https://example.com/c', 42, null],
    }
    expect(collectHttpUrls(config).sort()).toEqual([
      'https://example.com/a.xml',
      'https://example.com/b',
      'https://example.com/c',
    ])
  })

  it('忽略非 http(s) 字串與非字串值', () => {
    expect(collectHttpUrls({ itemSelector: 'div.list', bodySelector: null, count: 3 })).toEqual([])
  })

  it('單一字串輸入（非物件）也能處理', () => {
    expect(collectHttpUrls('https://example.com/x')).toEqual(['https://example.com/x'])
  })
})

// 守門測試：新增來源時，若沒人判斷過它該歸官方還是第三方，這裡要紅。
// 這個 repo 的盤點類錯誤一律是「漏掉整列」，所以用窮舉、不用抽樣。
describe('官方 slug 窮舉（防清單腐爛）', () => {
  it('seed.ts：導出的官方 slug 集合等於預期清單', () => {
    const official = SEED
      .filter(s => s.isActive && effectiveEnabled([s.rssUrl], s.isActive, false))
      .map(s => s.slug)
      .sort()
    expect(official).toEqual(['cbc-press', 'eia'])
  })

  it('seed-external-sources.ts：導出的官方 slug 集合等於預期清單', () => {
    const official = EXTERNAL_SOURCES_SEED
      .filter(s => effectiveEnabled(collectHttpUrls(s.config), s.enabled ?? true, false))
      .map(s => s.slug)
      .sort()
    expect(official).toEqual([
      'cbc-press',
      'ey-press',
      'eia',
      'fomc-statements',
      'fsc-news',
      'twse-announcements',
      'twse-mops-news',
      'whitehouse-statements',
    ].sort())
  })
})

// ★ 這個 describe 補的是核心安全屬性：上面「官方 slug 窮舉」那組測試只驗
// `effectiveEnabled` 對單筆的判斷，從未驗過「實際交給 DB 的那份陣列，在沒設
// SEED_THIRD_PARTY_SOURCES 時到底剩幾筆」——把兩支 seed CLI entry 的
// `const optIn = thirdPartySourcesEnabled()` 手動改成 `= true`，上一輪的 110 條測試
// 逐字全綠，就是因為缺這一段。
//
// 直接斷言 `RESOLVED_SEED_GATE` / `RESOLVED_EXTERNAL_SOURCES_GATE`（seed.ts /
// seed-external-sources.ts 在 module 頂層算好、CLI 與測試共用同一份）而不是重新呼叫
// `applySeedGate`，就是為了讓這個 mutation 真的會被 import 觸發到——`optIn` 現在是
// module 頂層的 binding，不再藏在只有連 DB 才會執行到的 `main()` / CLI guard 裡面。
describe('第三方來源 gate 的實際套用結果（RESOLVED_SEED_GATE / RESOLVED_EXTERNAL_SOURCES_GATE）', () => {
  it('news_sources：預設（optIn=false）剛好 2 筆會被啟用，且是 cbc-press / eia', () => {
    const enabledSlugs = RESOLVED_SEED_GATE.gated
      .filter(g => g.resolvedEnabled)
      .map(g => g.entry.slug)
      .sort()
    expect(enabledSlugs).toEqual(['cbc-press', 'eia'])
  })

  it('news_sources：25 筆全宣告 active，其中 23 筆被 withhold、2 筆官方放行', () => {
    // SEED 目前全部宣告 isActive:true，扣掉官方的 2 筆，其餘 23 筆在 optIn=false 時
    // 應該全數進 withheldSlugs。
    expect(SEED.length).toBe(25)
    expect(RESOLVED_SEED_GATE.withheldSlugs).toHaveLength(23)
  })

  it('external_sources：預設（optIn=false）剛好 8 筆會被啟用，且等於官方 slug 清單', () => {
    const enabledSlugs = RESOLVED_EXTERNAL_SOURCES_GATE.gated
      .filter(g => g.resolvedEnabled)
      .map(g => g.entry.slug)
      .sort()
    expect(enabledSlugs).toEqual([
      'cbc-press',
      'ey-press',
      'eia',
      'fomc-statements',
      'fsc-news',
      'twse-announcements',
      'twse-mops-news',
      'whitehouse-statements',
    ].sort())
  })

  it('external_sources：預設（optIn=false）有 18 筆被 withhold，且不含 declared-false 那 4 筆', () => {
    expect(RESOLVED_EXTERNAL_SOURCES_GATE.withheldSlugs).toHaveLength(18)
    for (const retiredSlug of ['moneydj', 'udn-money', 'commercial-times', 'udn-main'])
      expect(RESOLVED_EXTERNAL_SOURCES_GATE.withheldSlugs, retiredSlug).not.toContain(retiredSlug)
  })

  // optIn=true 不是 module 頂層的常態（頂層的 RESOLVED_*_GATE 讀的是實際 env），
  // 這裡直接呼叫 applySeedGate 驗證「開了 optIn 之後」的最終筆數。
  it('news_sources：optIn=true → 25 筆全數啟用', () => {
    const { gated } = applySeedGate(SEED, true, s => ({ slug: s.slug, urls: [s.rssUrl], declared: s.isActive }))
    expect(gated.filter(g => g.resolvedEnabled)).toHaveLength(25)
  })

  it('external_sources：optIn=true → 26 筆啟用（4 筆 declared-false 仍維持停用）', () => {
    const { gated } = applySeedGate(
      EXTERNAL_SOURCES_SEED,
      true,
      s => ({ slug: s.slug, urls: collectHttpUrls(s.config), declared: s.enabled ?? true }),
    )
    expect(gated.filter(g => g.resolvedEnabled)).toHaveLength(26)
    const stillDisabled = gated.filter(g => !g.resolvedEnabled).map(g => g.entry.slug).sort()
    expect(stillDisabled).toEqual(['commercial-times', 'moneydj', 'udn-main', 'udn-money'].sort())
  })
})

describe('downgradeAllowed', () => {
  it('未設定回 false', () => {
    expect(downgradeAllowed({})).toBe(false)
  })

  it('true（不分大小寫、可有前後空白）回 true', () => {
    expect(downgradeAllowed({ SEED_ALLOW_DOWNGRADE: 'true' })).toBe(true)
    expect(downgradeAllowed({ SEED_ALLOW_DOWNGRADE: 'TRUE' })).toBe(true)
    expect(downgradeAllowed({ SEED_ALLOW_DOWNGRADE: '  true  ' })).toBe(true)
  })

  it('其餘任何值一律回 false', () => {
    expect(downgradeAllowed({ SEED_ALLOW_DOWNGRADE: '1' })).toBe(false)
    expect(downgradeAllowed({ SEED_ALLOW_DOWNGRADE: 'yes' })).toBe(false)
    expect(downgradeAllowed({ SEED_ALLOW_DOWNGRADE: '' })).toBe(false)
  })

  it('預設參數讀 process.env', () => {
    expect(() => downgradeAllowed()).not.toThrow()
  })
})

// ★ shouldBlockDowngrade 補的是核心安全屬性：複查指出 onConflictDoUpdate
// 會把作者手動啟用過的第三方來源悄悄翻成停用，而使用者只會看到兩行滾過去的
// console.warn。這組測試釘住「optIn 短路」與「非空才中止」這兩個判斷，兩者任一被
// 改壞都要讓這裡的測試紅（見驗收條件的突變測試）。
describe('shouldBlockDowngrade', () => {
  it('optIn=true 時，不論 enabledThirdParty 多長都不中止', () => {
    expect(shouldBlockDowngrade([], true, false)).toBe(false)
    expect(shouldBlockDowngrade(['a', 'b'], true, false)).toBe(false)
  })

  it('allowDowngrade=true 時不中止', () => {
    expect(shouldBlockDowngrade(['a'], false, true)).toBe(false)
  })

  it('optIn=false 且 allowDowngrade=false，enabledThirdParty 非空 → 中止', () => {
    expect(shouldBlockDowngrade(['a'], false, false)).toBe(true)
    expect(shouldBlockDowngrade(['a', 'b', 'c'], false, false)).toBe(true)
  })

  it('enabledThirdParty 空陣列 → 不中止（不論 optIn / allowDowngrade）', () => {
    expect(shouldBlockDowngrade([], false, false)).toBe(false)
    expect(shouldBlockDowngrade([], true, false)).toBe(false)
    expect(shouldBlockDowngrade([], false, true)).toBe(false)
  })
})

describe('applySeedGate（合成 fixture，測邊界規則）', () => {
  it('withheldSlugs 只收「宣告啟用但被擋」，不收宣告就停用的（declared=false）', () => {
    const entries = [
      { slug: 'a', urls: ['https://ctee.com.tw/feed'], declared: true }, // 商業、被擋
      { slug: 'b', urls: ['https://ctee.com.tw/feed'], declared: false }, // 壞掉退役、不算被擋
      { slug: 'c', urls: ['https://www.eia.gov/x'], declared: true }, // 官方、不受擋
    ]
    const { withheldSlugs, gated } = applySeedGate(entries, false, e => e)
    expect(withheldSlugs).toEqual(['a'])
    expect(gated.map(g => g.resolvedEnabled)).toEqual([false, false, true])
  })

  it('optIn=true 時，declared=false 依然不會被 gate 復活', () => {
    const entries = [{ slug: 'x', urls: ['https://ctee.com.tw/feed'], declared: false }]
    const { gated, withheldSlugs } = applySeedGate(entries, true, e => e)
    expect(gated[0]?.resolvedEnabled).toBe(false)
    expect(withheldSlugs).toEqual([])
  })

  it('空輸入回空結果', () => {
    const { gated, withheldSlugs } = applySeedGate([], false, (e: never) => e)
    expect(gated).toEqual([])
    expect(withheldSlugs).toEqual([])
  })
})
