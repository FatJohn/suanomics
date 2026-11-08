import { describe, expect, it } from 'vitest'
import {
  hasAudioPath,
  hasNarrativeContent,
  hasPodcastContent,
  hasThesisContent,
  hasViewpointsContent,
  summarizeBriefContent,
  summarizeClaimLedger,
} from './brief-health.js'

// prod 2026-08-23 實測近 21 份報告的形狀：narrative 2-4 段、intro 156-309 字、
// outro 183-320 字、最短 body 378 字；viewpoints support/risk 各 2-4 點、netRead 218-336 字；
// podcast 4-5 act。下面的「健康」樣本刻意取實測下緣，別把它們改小到低於實測值——
// 那會讓測試通過而現實不通過。
const NARRATIVE_OK = {
  intro: '一'.repeat(156),
  outro: '一'.repeat(183),
  sections: [{ heading: 'h1', body: '一'.repeat(378) }, { heading: 'h2', body: '一'.repeat(378) }],
}
const VIEWPOINTS_OK = {
  supportPoints: ['支持一', '支持二'],
  riskPoints: ['風險一', '風險二'],
  netRead: '一'.repeat(218),
}
const PODCAST_OK = {
  hook: { headline: 'h', body: '一'.repeat(178) },
  acts: [{ actTitle: 'a1', body: '一'.repeat(300) }, { actTitle: 'a2', body: '一'.repeat(300) }],
}

describe('hasNarrativeContent', () => {
  it('真實形狀的 narrative 算有內容', () => {
    expect(hasNarrativeContent(NARRATIVE_OK)).toBe(true)
  })

  it.each([
    ['null（既有 graceful degrade）', null],
    ['undefined（舊報告沒有這個欄位）', undefined],
    ['字串', 'prose'],
    ['陣列', []],
  ])('%s 算沒有內容', (_label, v) => {
    expect(hasNarrativeContent(v)).toBe(false)
  })

  it('sections 空陣列＝報告存在但正文沒有段落', () => {
    expect(hasNarrativeContent({ ...NARRATIVE_OK, sections: [] })).toBe(false)
  })

  it('sections 缺欄位或不是陣列一律 false', () => {
    expect(hasNarrativeContent({ intro: 'i', outro: 'o' })).toBe(false)
    expect(hasNarrativeContent({ ...NARRATIVE_OK, sections: {} })).toBe(false)
  })

  it('★ 只要有一段 body 是空白就算沒有內容（讀者面會看到一塊空白）', () => {
    expect(hasNarrativeContent({
      ...NARRATIVE_OK,
      sections: [{ heading: 'h1', body: '一'.repeat(378) }, { heading: 'h2', body: '   ' }],
    })).toBe(false)
  })

  it('段落不是物件也算沒有內容', () => {
    expect(hasNarrativeContent({ ...NARRATIVE_OK, sections: ['一段字'] })).toBe(false)
  })

  it('intro 或 outro 空白就算沒有內容', () => {
    expect(hasNarrativeContent({ ...NARRATIVE_OK, intro: '' })).toBe(false)
    expect(hasNarrativeContent({ ...NARRATIVE_OK, outro: '\n\t ' })).toBe(false)
  })
})

describe('hasThesisContent', () => {
  it('有字的 thesis 為 true', () => {
    expect(hasThesisContent('本日核心論點')).toBe(true)
  })

  it.each([
    ['空字串', ''],
    ['純空白', '   '],
    ['null', null],
    ['undefined', undefined],
    ['數字', 0],
  ])('%s 為 false', (_label, v) => {
    expect(hasThesisContent(v)).toBe(false)
  })
})

describe('hasViewpointsContent', () => {
  it('真實形狀的 viewpoints 算有內容', () => {
    expect(hasViewpointsContent(VIEWPOINTS_OK)).toBe(true)
  })

  it('★ 空陣列算沒有內容——這正是「!= null 會說健康」的形狀', () => {
    expect(hasViewpointsContent([])).toBe(false)
  })

  it('null 與非物件為 false', () => {
    expect(hasViewpointsContent(null)).toBe(false)
    expect(hasViewpointsContent('支持')).toBe(false)
  })

  it('support 或 risk 任一為空陣列就算沒有內容', () => {
    expect(hasViewpointsContent({ ...VIEWPOINTS_OK, supportPoints: [] })).toBe(false)
    expect(hasViewpointsContent({ ...VIEWPOINTS_OK, riskPoints: [] })).toBe(false)
  })

  it('論點裡混進空白字串就算沒有內容', () => {
    expect(hasViewpointsContent({ ...VIEWPOINTS_OK, supportPoints: ['支持一', '  '] })).toBe(false)
  })

  it('netRead 空白就算沒有內容', () => {
    expect(hasViewpointsContent({ ...VIEWPOINTS_OK, netRead: '' })).toBe(false)
  })
})

describe('hasPodcastContent', () => {
  it('真實形狀的 podcast 算有內容', () => {
    expect(hasPodcastContent(PODCAST_OK)).toBe(true)
  })

  it('★ acts 空陣列算沒有內容（整集沒有東西可聽）', () => {
    expect(hasPodcastContent({ ...PODCAST_OK, acts: [] })).toBe(false)
  })

  it('任一 act 的 body 空白就算沒有內容', () => {
    expect(hasPodcastContent({ ...PODCAST_OK, acts: [{ actTitle: 'a1', body: '' }] })).toBe(false)
  })

  it('null 與非物件為 false', () => {
    expect(hasPodcastContent(null)).toBe(false)
    expect(hasPodcastContent([])).toBe(false)
  })

  it('缺 hook 不影響判定——只有 acts 是「聽不聽得到東西」的門檻', () => {
    expect(hasPodcastContent({ acts: PODCAST_OK.acts })).toBe(true)
  })
})

describe('hasAudioPath', () => {
  it('有值為 true、空白與 null 為 false', () => {
    expect(hasAudioPath('podcast/2026-08-23.mp3')).toBe(true)
    expect(hasAudioPath('   ')).toBe(false)
    expect(hasAudioPath(null)).toBe(false)
  })
})

describe('summarizeClaimLedger', () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    claim: '台股加權指數收在 24,000 點',
    evidenceRefs: [{ kind: 'series', seriesId: 'taiex-close', asOf: '2026-08-23' }],
    ...over,
  })

  it('算出總數與可追溯數', () => {
    expect(summarizeClaimLedger([claim(), claim({ id: 'c2', evidenceRefs: [] })]))
      .toEqual({ total: 2, grounded: 1 })
  })

  it('★ 缺欄位回 null 而不是 0——舊報告就是 absent', () => {
    expect(summarizeClaimLedger(undefined)).toBeNull()
  })

  it('★ 空陣列回 total 0，不是 null——那是今天真的沒產出 claim', () => {
    expect(summarizeClaimLedger([])).toEqual({ total: 0, grounded: 0 })
  })

  it('型別不對（物件／字串／null）一律回 null', () => {
    expect(summarizeClaimLedger({})).toBeNull()
    expect(summarizeClaimLedger('c1')).toBeNull()
    expect(summarizeClaimLedger(null)).toBeNull()
  })

  it('claim 文字空白或 evidenceRefs 不是陣列的筆數不算 grounded', () => {
    expect(summarizeClaimLedger([claim({ claim: '  ' }), claim({ id: 'c2', evidenceRefs: 'series' }), claim({ id: 'c3' })]))
      .toEqual({ total: 3, grounded: 1 })
  })

  it('ledger 裡混進非物件的項目只影響 grounded、不影響 total', () => {
    expect(summarizeClaimLedger(['c1', claim()])).toEqual({ total: 2, grounded: 1 })
  })
})

describe('summarizeBriefContent', () => {
  const HEALTHY = {
    briefJson: {
      narrative: NARRATIVE_OK,
      dailyThesis: '本日核心論點：資金輪動',
      viewpoints: VIEWPOINTS_OK,
      claimLedger: [{ id: 'c1', claim: '台股收紅', evidenceRefs: [{ kind: 'citation', url: 'https://x.invalid' }] }],
    },
    podcastJson: PODCAST_OK,
    podcastAudioPath: 'podcast/2026-08-23.mp3',
  }

  it('健康的一列旗標全 true、claims 有數字', () => {
    expect(summarizeBriefContent(HEALTHY)).toEqual({
      narrative: true,
      dailyThesis: true,
      viewpoints: true,
      podcast: true,
      audio: true,
      claims: { total: 1, grounded: 1 },
    })
  })

  it('缺報（三個欄位皆 undefined）旗標全 false、claims null', () => {
    expect(summarizeBriefContent({ briefJson: undefined, podcastJson: undefined, podcastAudioPath: undefined })).toEqual({
      narrative: false,
      dailyThesis: false,
      viewpoints: false,
      podcast: false,
      audio: false,
      claims: null,
    })
  })

  it('★ 舊行為的分水嶺：全部欄位都「非 null 但沒有內容」時旗標一律 false', () => {
    // 這一組正是 `!= null` 會全部說健康的形狀
    expect(summarizeBriefContent({
      briefJson: { narrative: { intro: '', outro: '', sections: [] }, dailyThesis: '', viewpoints: [], claimLedger: [] },
      podcastJson: { acts: [] },
      podcastAudioPath: '',
    })).toEqual({
      narrative: false,
      dailyThesis: false,
      viewpoints: false,
      podcast: false,
      audio: false,
      claims: { total: 0, grounded: 0 },
    })
  })

  it('briefJson 不是物件時不炸、旗標 false', () => {
    expect(summarizeBriefContent({ briefJson: 'oops', podcastJson: PODCAST_OK, podcastAudioPath: 'a.mp3' }))
      .toMatchObject({ narrative: false, dailyThesis: false, viewpoints: false, podcast: true, audio: true, claims: null })
  })

  it('★ 欄位名字釘死在這裡：拼錯 key 的話這一條會紅', () => {
    const only = (key: string) => summarizeBriefContent({
      briefJson: { [key]: key === 'dailyThesis' ? '論點' : key === 'claimLedger' ? [] : key === 'narrative' ? NARRATIVE_OK : VIEWPOINTS_OK },
      podcastJson: undefined,
      podcastAudioPath: undefined,
    })
    expect(only('narrative').narrative).toBe(true)
    expect(only('dailyThesis').dailyThesis).toBe(true)
    expect(only('viewpoints').viewpoints).toBe(true)
    expect(only('claimLedger').claims).toEqual({ total: 0, grounded: 0 })
  })
})
