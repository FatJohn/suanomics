import type { LlmCallRecord } from '../agents/call-agent.js'
import type { EditorStorylineState, SanitizedSelection } from '../agents/editor-output.js'
import type { RelevanceCandidate } from '../db/repos/news-repo.js'
import type { MarketContext } from '../ingest/market-data/context.js'
import { CostGateError } from '../agents/cost-gate.js'
import { sanitizeSelection, sanitizeStoryline } from '../agents/editor-output.js'
import { callEditor } from '../agents/editor.js'
import { buildStorylineBlock, continuityHintFromEntries, entriesFromEditorResult } from '../agents/storyline-block.js'
import { getRecentBriefSummaries, selectNewsForBrief } from '../db/repos/news-repo.js'
import { getOpenStorylines } from '../db/repos/storylines-repo.js'

export interface BriefNews { id: number, title: string, url: string, text: string, publishedAt: string | null }

export interface EditorStageResult {
  news: BriefNews[]
  // 兩個 contract 分開帶：selection 決定選稿與 thesis、storyline 決定敘事線寫回。
  selection: SanitizedSelection | null
  storyline: EditorStorylineState | null
  storylineBlock: string | null
  continuityHint: string | null
}

const RECENT_BRIEF_COUNT = 3
const EXCERPT_CHARS = 150

function toBriefNews(c: RelevanceCandidate): BriefNews {
  return { id: c.id, title: c.title, url: c.url, text: c.contentText ?? c.title, publishedAt: c.publishedAt?.toISOString() ?? null }
}

interface SelectNewsParams {
  date: string
  selected: RelevanceCandidate[]
  market: MarketContext
  onCallRecord?: (r: LlmCallRecord) => void
}

// editor 是加值層：失敗（LLM、sanitize 後選稿不足）都回退 recency，確保 brief 產得出來。
// 兩層獨立降級：選稿退回 recency 時，editor 對敘事線的判斷仍要寫回 DB。
export async function selectNewsViaEditor(p: SelectNewsParams): Promise<EditorStageResult> {
  let storyline: EditorStorylineState | null = null
  try {
    // 空候選打 editor 只是白花一次呼叫，而且模型會在沒素材時硬編。
    if (p.selected.length === 0)
      throw new Error('沒有候選新聞')
    const [openLines, recentBriefs] = await Promise.all([
      getOpenStorylines(p.date),
      getRecentBriefSummaries(RECENT_BRIEF_COUNT, p.date),
    ])
    console.warn(JSON.stringify({ event: 'editor_input', date: p.date, candidates: p.selected.length, storylineIds: openLines.map(l => l.id), recentBriefDates: recentBriefs.map(b => b.briefDate) }))
    const parsed = await callEditor({
      candidates: p.selected.map(c => ({ id: c.id, title: c.title, excerpt: (c.contentText ?? '').slice(0, EXCERPT_CHARS), category: c.category })),
      storylines: openLines,
      recentBriefs,
      marketSnapshot: p.market.snapshotBlock,
      calendarBlock: p.market.calendarBlock,
      officialBlock: p.market.officialBlock,
      ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
    })
    if (parsed.schemaDroppedEntries > 0)
      console.warn(`[editor] storyline 層丟棄 ${parsed.schemaDroppedEntries} 筆不合 schema 的項目`)
    const sel = parsed.selection ? sanitizeSelection(parsed.selection, p.selected.map(c => c.id)) : null
    storyline = sanitizeStoryline(parsed.storyline, openLines.map(l => l.id))
    if (sel?.ok) {
      const entries = entriesFromEditorResult(storyline.storylineTouches, storyline.resolveStorylines, openLines, p.date)
      // 要照 editor 的順序：主軸新聞排前，下游鋪排依賴這個順序。
      const news = sel.selectedNewsIds
        .map(id => p.selected.find(c => c.id === id))
        .filter((c): c is RelevanceCandidate => c !== undefined)
        .map(toBriefNews)
      return { news, selection: sel, storyline, storylineBlock: buildStorylineBlock(entries), continuityHint: continuityHintFromEntries(entries) }
    }
    console.warn('[editor] 選稿不可用，退回 recency selection')
  }
  catch (err) {
    if (err instanceof CostGateError)
      throw err
    console.warn('[editor] 失敗，退回 recency selection：', err instanceof Error ? err.message : String(err))
  }
  const fallback = await selectNewsForBrief(p.date)
  // storylineBlock／continuityHint 描述的是 editor 選的那批新聞，與 fallback 選稿對不上，不餵給 narrative。
  return { news: fallback.map(n => ({ ...n, publishedAt: n.publishedAt?.toISOString() ?? null })), selection: null, storyline, storylineBlock: null, continuityHint: null }
}
