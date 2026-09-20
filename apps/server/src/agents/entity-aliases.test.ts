import type { AliasGroup } from './entity-aliases.js'
import type { AnalystOutput } from './types.js'
import { describe, expect, it } from 'vitest'
import {

  buildAliasMap,
  canonicalizeEntities,
  canonicalizeEntity,
  expandEntities,
  expandEntity,
  extractCanonicalEntities,
  extractCanonicalEntitiesFromAnalyst,
  loadAliasMap,
} from './entity-aliases.js'

const GROUPS: AliasGroup[] = [
  { canonical: 'fed', aliases: ['Fed', 'FOMC', '聯準會', '美聯儲'] },
  { canonical: 'tsmc', aliases: ['TSMC', '台積電', '2330'] },
  { canonical: 'rate-cut', aliases: ['降息', 'rate cut', '利率下調'] },
  { canonical: 'semiconductor', aliases: ['半導體', 'semiconductor', 'sem'] },
  { canonical: 'oil-price', aliases: ['油價', 'oil price', '原油'] },
]

describe('buildAliasMap', () => {
  it('should index every alias (case-insensitive, trimmed) back to canonical', () => {
    const map = buildAliasMap(GROUPS)
    expect(map.formToCanonical.get('fed')).toBe('fed')
    expect(map.formToCanonical.get('fomc')).toBe('fed')
    expect(map.formToCanonical.get('聯準會')).toBe('fed')
    expect(map.formToCanonical.get('tsmc')).toBe('tsmc')
    expect(map.formToCanonical.get('2330')).toBe('tsmc')
  })

  it('should expose canonical → user-provided aliases only (canonical slug excluded)', () => {
    const map = buildAliasMap(GROUPS)
    const fedForms = map.canonicalToAliases.get('fed') ?? []
    expect(fedForms).toContain('Fed')
    expect(fedForms).toContain('FOMC')
    expect(fedForms).toContain('聯準會')
    // canonical 'fed' (slug) 預設不入 aliases 集；real-world article tag 用
    // 大小寫敏感的可讀 form、查 'fed' slug 永遠不會命中
    expect(fedForms).not.toContain('fed')
  })
})

describe('expandEntity', () => {
  const map = buildAliasMap(GROUPS)

  it('should expand a known alias to all forms in the group', () => {
    const out = expandEntity('Fed', map)
    expect(out.sort()).toEqual(['FOMC', 'Fed', '美聯儲', '聯準會'].sort())
  })

  it('should be case-insensitive and trim-tolerant', () => {
    const out = expandEntity('  fomc  ', map)
    expect(out).toContain('Fed')
    expect(out).toContain('聯準會')
  })

  it('should match Chinese aliases too', () => {
    const out = expandEntity('聯準會', map)
    expect(out).toContain('Fed')
    expect(out).toContain('FOMC')
  })

  it('should map TSMC ↔ 台積電 ↔ 2330 bidirectionally', () => {
    expect(expandEntity('TSMC', map)).toContain('台積電')
    expect(expandEntity('台積電', map)).toContain('TSMC')
    expect(expandEntity('2330', map)).toContain('台積電')
    expect(expandEntity('台積電', map)).toContain('2330')
  })

  it('should map 降息 ↔ rate cut ↔ 利率下調', () => {
    expect(expandEntity('降息', map)).toContain('rate cut')
    expect(expandEntity('rate cut', map)).toContain('降息')
    expect(expandEntity('利率下調', map)).toContain('rate cut')
  })

  it('should map 半導體 ↔ semiconductor ↔ sem', () => {
    expect(expandEntity('半導體', map)).toContain('semiconductor')
    expect(expandEntity('semiconductor', map)).toContain('半導體')
    expect(expandEntity('sem', map)).toContain('半導體')
  })

  it('should pass unknown name through as a singleton list', () => {
    expect(expandEntity('UNKNOWN_ENTITY_X', map)).toEqual(['UNKNOWN_ENTITY_X'])
  })

  it('should return [trimmed input] for empty alias map', () => {
    const empty = buildAliasMap([])
    expect(expandEntity('  Fed  ', empty)).toEqual(['Fed'])
  })

  it('should fallback to [trimmed input] when group registers canonical but empty aliases', () => {
    // Defensive：避免 yml 上有人寫 `aliases: []` 時 expand 回空陣列、
    // 害 retriever 用空集合查 GIN 永遠 0 命中
    const degenerate = buildAliasMap([{ canonical: 'foo', aliases: [] }])
    expect(expandEntity('foo', degenerate)).toEqual(['foo'])
    expect(expandEntity('FOO', degenerate)).toEqual(['FOO'])
  })
})

describe('expandEntities', () => {
  const map = buildAliasMap(GROUPS)

  it('should flatten + dedupe across multiple input names', () => {
    const out = expandEntities(['Fed', 'FOMC', 'TSMC'], map)
    // Fed + FOMC 同 group、不該重複；TSMC 自帶 group
    const fedForms = ['Fed', 'FOMC', '聯準會', '美聯儲']
    const tsmcForms = ['TSMC', '台積電', '2330']
    for (const f of [...fedForms, ...tsmcForms])
      expect(out).toContain(f)
    // 整體不重複
    expect(new Set(out).size).toBe(out.length)
  })

  it('should preserve unknown names as-is', () => {
    const out = expandEntities(['Fed', 'UNKNOWN_X'], map)
    expect(out).toContain('Fed')
    expect(out).toContain('UNKNOWN_X')
  })

  it('should ignore empty / whitespace strings', () => {
    const out = expandEntities(['', '   ', 'Fed'], map)
    expect(out).not.toContain('')
    expect(out).toContain('Fed')
  })
})

describe('canonicalizeEntity', () => {
  const map = buildAliasMap(GROUPS)

  it('should map any alias form to canonical', () => {
    expect(canonicalizeEntity('FOMC', map)).toBe('fed')
    expect(canonicalizeEntity('聯準會', map)).toBe('fed')
    expect(canonicalizeEntity('Fed', map)).toBe('fed')
  })

  it('should default unknown to lowercased trimmed form', () => {
    expect(canonicalizeEntity('  HelloWorld  ', map)).toBe('helloworld')
  })
})

describe('canonicalizeEntities', () => {
  const map = buildAliasMap(GROUPS)

  it('should produce a deduped set (Fed and FOMC collapse to fed)', () => {
    const out = canonicalizeEntities(['Fed', 'FOMC', 'TSMC'], map)
    expect(out.sort()).toEqual(['fed', 'tsmc'])
  })

  it('should drop empties', () => {
    const out = canonicalizeEntities(['', '   ', 'Fed'], map)
    expect(out).toEqual(['fed'])
  })
})

describe('loadAliasMap (from yml)', () => {
  it('should load the seed yml shipped at apps/server/data/entity-aliases.yml', () => {
    const map = loadAliasMap()
    // Spec calls these out explicitly as required coverage
    expect(map.formToCanonical.get('fed')).toBe('fed')
    expect(map.formToCanonical.get('聯準會')).toBe('fed')
    expect(map.formToCanonical.get('fomc')).toBe('fed')
    expect(map.formToCanonical.get('tsmc')).toBe('tsmc')
    expect(map.formToCanonical.get('台積電')).toBe('tsmc')
    expect(map.formToCanonical.get('2330')).toBe('tsmc')
    expect(map.formToCanonical.get('降息')).toBe('rate-cut')
    expect(map.formToCanonical.get('rate cut')).toBe('rate-cut')
    expect(map.formToCanonical.get('半導體')).toBe('semiconductor')
    expect(map.formToCanonical.get('semiconductor')).toBe('semiconductor')
  })

  it('should fall back to empty map when given a missing path', () => {
    const map = loadAliasMap('/tmp/nonexistent-entity-aliases.yml')
    expect(map.formToCanonical.size).toBe(0)
    expect(map.canonicalToAliases.size).toBe(0)
  })
})

describe('extractCanonicalEntities', () => {
  const map = buildAliasMap(GROUPS)

  it('finds Fed when text contains Fed/FOMC/聯準會 anywhere', () => {
    expect(extractCanonicalEntities('今日 FOMC 會議結果出爐', map)).toContain('fed')
    expect(extractCanonicalEntities('聯準會主席發言', map)).toContain('fed')
    expect(extractCanonicalEntities('the Fed cut rates', map)).toContain('fed')
  })
  it('finds multiple canonicals (Fed + 降息 + 半導體)', () => {
    const out = extractCanonicalEntities('Fed 降息利好半導體 sector', map)
    expect(out.sort()).toEqual(['fed', 'rate-cut', 'semiconductor'].sort())
  })
  it('returns empty when no alias matches', () => {
    expect(extractCanonicalEntities('純文字無關鍵字', map)).toEqual([])
  })
  it('case-insensitive matching', () => {
    expect(extractCanonicalEntities('FED RATE CUT', map).sort()).toEqual(['fed', 'rate-cut'].sort())
  })
  it('substring side effect: 不降息 still hits rate-cut (known v1 behavior)', () => {
    expect(extractCanonicalEntities('預期 Fed 不降息', map)).toContain('rate-cut')
  })
  it('dedupes when multiple aliases of same group hit', () => {
    const out = extractCanonicalEntities('Fed 聯準會 FOMC 同時提到', map)
    expect(out.filter(e => e === 'fed')).toHaveLength(1)
  })
})

describe('extractCanonicalEntitiesFromAnalyst', () => {
  const map = buildAliasMap(GROUPS)
  it('extracts canonicals from cascadeChains industries + tickers', () => {
    const analyst: AnalystOutput = {
      primaryImpact: 'p',
      cascadeChains: [
        { industry: '半導體', mechanism: 'm', affectedTickers: ['TSMC'], direction: 'positive', citations: [] },
        { industry: '油價', mechanism: 'm', affectedTickers: [], direction: 'neutral', citations: [] },
      ],
      reasoning: 'r',
    }
    const out = extractCanonicalEntitiesFromAnalyst(analyst, map)
    expect(out.sort()).toEqual(['oil-price', 'semiconductor', 'tsmc'].sort())
  })
  it('returns empty array when no cascadeChains', () => {
    const analyst: AnalystOutput = { primaryImpact: 'p', cascadeChains: [], reasoning: 'r' }
    expect(extractCanonicalEntitiesFromAnalyst(analyst, map)).toEqual([])
  })
})

// === cross-domain alias groups（先寫測試、yml 還沒加、應 RED）===

describe('兩岸 group', () => {
  it('should map 兩岸 ↔ cross-strait ↔ 台海 bidirectionally', () => {
    const map = loadAliasMap()
    expect(expandEntity('兩岸', map)).toContain('cross-strait')
    expect(expandEntity('cross-strait', map)).toContain('兩岸')
    expect(expandEntity('台海', map)).toContain('兩岸')
  })
})

describe('alias group · CHIPS Act', () => {
  it('should map CHIPS Act ↔ 美國晶片法案 ↔ 晶片法案', () => {
    const map = loadAliasMap()
    expect(expandEntity('CHIPS Act', map)).toContain('美國晶片法案')
    expect(expandEntity('晶片法案', map)).toContain('CHIPS Act')
  })
})

describe('friend-shoring group', () => {
  it('should map friend-shoring ↔ 友岸外包 ↔ 供應鏈韌性', () => {
    const map = loadAliasMap()
    expect(expandEntity('friend-shoring', map)).toContain('友岸外包')
    expect(expandEntity('供應鏈韌性', map)).toContain('friend-shoring')
  })
})

describe('川普關稅 group', () => {
  it('should map 川普關稅 ↔ Trump tariff ↔ 美國對等關稅', () => {
    const map = loadAliasMap()
    expect(expandEntity('川普關稅', map)).toContain('Trump tariff')
    expect(expandEntity('Trump tariff', map)).toContain('川普關稅')
  })
})

describe('烏俄戰爭 group', () => {
  it('should map 烏俄戰爭 ↔ Russia Ukraine war ↔ 烏克蘭戰爭', () => {
    const map = loadAliasMap()
    expect(expandEntity('烏俄戰爭', map)).toContain('Russia Ukraine war')
    expect(expandEntity('烏克蘭戰爭', map)).toContain('烏俄戰爭')
  })
})

describe('紅海 group', () => {
  it('should map 紅海 ↔ Red Sea ↔ 葉門胡塞', () => {
    const map = loadAliasMap()
    expect(expandEntity('紅海', map)).toContain('Red Sea')
    expect(expandEntity('Red Sea', map)).toContain('紅海')
  })
})

describe('alias group · OPEC', () => {
  it('should map OPEC ↔ 油國組織 ↔ 石油輸出國組織', () => {
    const map = loadAliasMap()
    expect(expandEntity('OPEC', map)).toContain('油國組織')
    expect(expandEntity('石油輸出國組織', map)).toContain('OPEC')
  })
})

describe('對中出口管制 group', () => {
  it('should map 對中出口管制 ↔ China export control ↔ BIS export control', () => {
    const map = loadAliasMap()
    expect(expandEntity('對中出口管制', map)).toContain('China export control')
    expect(expandEntity('BIS export control', map)).toContain('對中出口管制')
  })
})
