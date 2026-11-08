import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callEditor, formatUserContent } from './editor.js'
import * as wrapper from './llm-wrapper.js'

vi.mock('./llm-wrapper.js')
vi.mock('../prompts/editor.prompt.js', () => ({
  EDITOR_SYSTEM_PROMPT: 'TEST_EDITOR_PROMPT',
}))

const VALID_OUTPUT = {
  mainThemes: ['Fed 政策轉向'],
  dailyThesis: '本日市場主線由 AI 算力需求與利率預期拉鋸主導',
  selectedNewsIds: [12],
  storylineTouches: [{ storylineId: 7, valence: 'support' as const, note: 'CPI 低於預期' }],
  newStorylines: [],
}

const OPEN_LINE: Storyline = {
  id: 7,
  title: 'Fed 降息路徑',
  thesis: '年內降息兩碼',
  status: 'open',
  entities: [],
  updates: [{ briefDate: '2026-06-10', valence: 'extend', note: '初步觀察' }],
  lastTouchedBriefDate: '2026-06-10',
}

describe('callEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('editor user content lists candidates, open storylines, recent briefs', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_OUTPUT)

    await callEditor({
      candidates: [{ id: 12, title: '台積電法說', excerpt: '上修全年資本支出', category: 'tw-equity-other' as const }],
      storylines: [OPEN_LINE],
      recentBriefs: [{ briefDate: '2026-06-11', headline: '昨日盤勢', summary: '市場觀望' }],
    })

    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    expect(call?.agentName).toBe('editor')
    expect(call?.systemPrompt).toBe('TEST_EDITOR_PROMPT')
    const userContent = call?.userContent ?? ''
    // 候選帶 item 層分類標籤
    expect(userContent).toContain('[12][台股其他] 台積電法說')
    expect(userContent).toContain('## 進行中敘事線')
    expect(userContent).toContain('[7] Fed 降息路徑')
    expect(userContent).toContain('## 近三日 brief')
  })

  it('renders the item-level category label', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_OUTPUT)

    await callEditor({
      candidates: [{ id: 1, title: '台積電法說', excerpt: 'CoWoS', category: 'tech-semi' }],
      storylines: [],
      recentBriefs: [],
    })

    const userContent = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? ''
    expect(userContent).toContain('[1][科技半導體]')
  })

  it('clamps overlong candidate title and excerpt in user content', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_OUTPUT)

    const longTitle = '標'.repeat(200)
    const longExcerpt = '述'.repeat(300)

    await callEditor({
      candidates: [{ id: 12, title: longTitle, excerpt: longExcerpt, category: 'tw-equity-other' as const }],
      storylines: [],
      recentBriefs: [],
    })

    const call = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]
    const userContent = call?.userContent ?? ''
    const candidateLine = userContent.split('\n').find(l => l.startsWith('[12]')) ?? ''

    // clampString(title, 120) -> 119 chars + '…'; clampString(excerpt, 150) -> 149 + '…'
    expect(candidateLine).not.toContain(longTitle)
    expect(candidateLine).not.toContain(longExcerpt)
    expect(candidateLine).toContain('…')
    // full untrimmed line would be 200 + 300 + framing; clamped is far shorter
    // framing 含 [id][分類] 標籤（5 類 item label）+ ' — '，留 20 字 slack
    expect(candidateLine.length).toBeLessThanOrEqual(120 + 150 + 20)
  })

  it('editor returns zod-parsed output split into selection + storyline layers', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_OUTPUT)

    const result = await callEditor({
      candidates: [{ id: 12, title: '台積電法說', excerpt: 'x', category: 'tw-equity-other' as const }],
      storylines: [],
      recentBriefs: [],
    })

    expect(result.selection?.selectedNewsIds).toEqual([12])
    expect(result.selection?.mainThemes).toEqual(['Fed 政策轉向'])
    expect(result.storyline.storylineTouches).toEqual([{ storylineId: 7, valence: 'support', note: 'CPI 低於預期' }])
  })

  // 選稿層不合 schema 時不再整包 throw，storyline 層照常回來。
  it('editor returns null selection (not throw) on schema-invalid selection, keeping storyline layer', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue({
      // missing selectedNewsIds + mainThemes
      storylineTouches: [{ storylineId: 7, valence: 'support', note: 'CPI 低於預期' }],
      newStorylines: [],
    })

    const result = await callEditor({
      candidates: [{ id: 1, title: 't', excerpt: 'x', category: 'tw-equity-other' as const }],
      storylines: [],
      recentBriefs: [],
    })

    expect(result.selection).toBeNull()
    expect(result.storyline.storylineTouches).toHaveLength(1)
  })

  it('注入 market snapshot + calendar 時 user content 含對應段、null 時略過', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_OUTPUT)

    await callEditor({
      candidates: [{ id: 12, title: 't', excerpt: 'x', category: 'tw-equity-other' as const }],
      storylines: [],
      recentBriefs: [],
      marketSnapshot: 'SNAPSHOT_BLOCK_X',
      calendarBlock: 'CALENDAR_BLOCK_Y',
    })

    const userContent = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? ''
    expect(userContent).toContain('CALENDAR_BLOCK_Y')
    expect(userContent).toContain('SNAPSHOT_BLOCK_X')
    expect(userContent).toContain('本週財經行事曆')
    expect(userContent).toContain('市場數據快照')
  })

  it('marketSnapshot / calendarBlock 省略時不出現對應 heading', async () => {
    vi.mocked(wrapper.callAgentLLM).mockResolvedValue(VALID_OUTPUT)

    await callEditor({
      candidates: [{ id: 12, title: 't', excerpt: 'x', category: 'tw-equity-other' as const }],
      storylines: [],
      recentBriefs: [],
    })

    const userContent = vi.mocked(wrapper.callAgentLLM).mock.calls[0]?.[0]?.userContent ?? ''
    expect(userContent).not.toContain('市場數據快照')
    expect(userContent).not.toContain('本週財經行事曆')
  })

  it('renders up to 3 recent updates per open storyline with valence', () => {
    const content = formatUserContent({
      candidates: [{ id: 1, title: 't', excerpt: 'e', category: 'macro' }],
      storylines: [{
        id: 5,
        title: '能源通膨',
        thesis: '油價滯後',
        status: 'open',
        entities: [],
        lastTouchedBriefDate: '2026-06-22',
        updates: [
          { briefDate: '2026-06-20', valence: 'extend', note: 'u1' },
          { briefDate: '2026-06-21', valence: 'support', note: 'u2' },
          { briefDate: '2026-06-22', valence: 'challenge', note: 'u3' },
          { briefDate: '2026-06-23', valence: 'support', note: 'u4' },
        ],
      }],
      recentBriefs: [],
    })
    expect(content).toContain('u4')
    expect(content).toContain('u2')
    expect(content).not.toContain('u1') // 只留最近 3 筆
    expect(content).toContain('challenge')
  })

  // ★★ 上面那條餵的是**已排序**的陣列，所以「吃陣列尾巴」與「取日期最新三筆」在它眼裡
  //    一模一樣。`updates` 的寫入序不保證等於時間序：補跑一次舊報告日就會把較舊的日期
  //    接在尾巴，slice(-3) 於是把舊進展當成「近期」印給 editor——沒有錯誤訊息、
  //    沒有紅燈。這條餵補跑順序把兩種實作分開。
  it('★ updates 寫入序亂掉時取的是日期最新 3 筆、不是陣列尾巴 3 筆', () => {
    const content = formatUserContent({
      candidates: [{ id: 1, title: 't', excerpt: 'e', category: 'macro' }],
      storylines: [{
        id: 7,
        title: '關稅傳導',
        thesis: '成本轉嫁遞延',
        status: 'open',
        entities: [],
        lastTouchedBriefDate: '2026-09-05',
        // 補跑造出的形狀：09-05 先寫、之後補跑 09-02／09-03／09-01
        updates: [
          { briefDate: '2026-09-05', valence: 'extend', note: 'u-0905' },
          { briefDate: '2026-09-02', valence: 'support', note: 'u-0902' },
          { briefDate: '2026-09-03', valence: 'challenge', note: 'u-0903' },
          { briefDate: '2026-09-01', valence: 'support', note: 'u-0901' },
        ],
      }],
      recentBriefs: [],
    })

    // slice(-3) 會漏掉最新的 09-05、卻印出最舊的 09-01
    expect(content).toContain('u-0905')
    expect(content).not.toContain('u-0901')
    // 連順序一起釘死：擋「排序方向相反」與「排序後取前 3 筆」兩種寫法
    expect(content).toContain('（2026-09-02/support）u-0902；（2026-09-03/challenge）u-0903；（2026-09-05/extend）u-0905')
  })
})
