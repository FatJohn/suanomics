import type { RelevanceCandidate } from '@suanomics/db/repos/news-repo'
import type { PublicationDay, SkipReason } from '@suanomics/shared'
import type { EditorStorylineState, SanitizedSelection } from '../../agents/editor-output.js'
import type { LlmCallRecord } from '../../agents/llm-wrapper.js'
import type { RunMetadata } from '../../agents/orchestrator.js'
import type { MarketContext } from '../../market-data/context.js'
import type { SeriesAsOfMap } from '../../market-data/historical-asof.js'
import { ITEM_CATEGORIES } from '@suanomics/db/news-categories'
import { getRecentBriefSummaries, getRelevanceCandidates, selectNewsForBrief } from '@suanomics/db/repos/news-repo'
import { getOpenStorylines, getStorylinesUpdatedInRange } from '@suanomics/db/repos/storylines-repo'
import { classifyPublicationDay } from '@suanomics/shared'
import { sanitizeSelection, sanitizeStoryline } from '../../agents/editor-output.js'
import { callEditor } from '../../agents/editor.js'
import { getDefaultAliasMap } from '../../agents/entity-aliases.js'
import { runDailyBrief } from '../../agents/orchestrator.js'
import { buildStorylineBlock, continuityHintFromEntries, entriesFromEditorResult } from '../../agents/storyline-block.js'
import { buildWeeklyRecapBlock } from '../../agents/weekly-recap-block.js'
import { selectMajorAnnouncements } from '../../brief/major-announcements.js'
import { CAP_DAYS, FLOOR_PER_CATEGORY, rankAndSelect, TOP_K } from '../../brief/news-relevance.js'
import { weekBounds } from '../../brief/report-day.js'
import { EMPTY_MARKET_CONTEXT, loadMarketContext } from '../../market-data/context.js'

export interface BriefNews { id: number, title: string, url: string, text: string, publishedAt: string | null }

interface EditorStageResult {
  news: BriefNews[]
  // 兩個 contract 分開帶：selection 決定選稿與 thesis、storyline 決定敘事線寫回。
  selection: SanitizedSelection | null
  storyline: EditorStorylineState | null
  storylineBlock: string | null
  continuityHint: string | null
}

// generateDailyBrief 的回傳：只產生、不持久化。呼叫端（processBriefJob／brief:rerun）
// 各自決定要不要寫 DB／檔案。
export type GenerateDailyBriefResult
  = | { kind: 'skip', reason?: SkipReason }
    | (EditorStageResult & {
      kind: 'generated'
      pubDay: PublicationDay
      brief: Awaited<ReturnType<typeof runDailyBrief>>
      summaryText: string
    })

/** 候選 → brief 的 news 條目。保留席與 editor 選稿共用，形狀不可分岔。 */
function toBriefNews(c: RelevanceCandidate): BriefNews {
  return {
    id: c.id,
    title: c.title,
    url: c.url,
    text: c.contentText ?? c.title,
    publishedAt: c.publishedAt?.toISOString() ?? null,
  }
}

// editor 是加值層：由 LLM 從近兩日候選新聞挑選稿、並判斷敘事線進展。
// 任何一步失敗（取候選、LLM、sanitize 後選稿不足）都回退到現行 recency selection、
// 確保 brief 一定產得出來、editor 只負責讓選稿更有編輯邏輯。
async function selectNewsViaEditor(date: string, onCall: (r: LlmCallRecord) => void, seriesAsOf?: SeriesAsOfMap): Promise<EditorStageResult> {
  // 兩層獨立降級：選稿退回 recency 時、editor 對敘事線的判斷仍要寫回 DB。
  // 綁在一起時、一次幻覺 id 就讓當天長期狀態更新整個遺失。
  let storyline: EditorStorylineState | null = null

  // 撈 14 天 sanity cap 窗內全部候選 → 純函式相關性 ranker → hybrid top-K（≤36）餵 editor。
  // 取代硬性 7 天窗 + DB 層 recency 砍頂
  //
  // ★ 提到 try 之外：**editor 掛掉走降級時同樣要保留席**——那是「editor 壞了」，不是
  //   「今天沒有重大公告」。取候選失敗就退成空池，後續 rankAndSelect 回空、editor 收到
  //   空候選、sanitize 不過，照舊落到 recency fallback。
  let pool: RelevanceCandidate[] = []
  let poolFailed = false
  try {
    pool = await getRelevanceCandidates(date, CAP_DAYS)
  }
  catch (err) {
    poolFailed = true
    console.warn('[brief] 取候選池失敗、保留席與 editor 選稿都退回降級路徑：', (err as Error).message)
  }
  // 保留席繞過 ranker：官方公告用新聞的尺量必然低分（實測最佳名次 206、中位 4,197），
  // 而 `SOURCE_WEIGHTS` 上限 1.1 的 tiebreaker 推不動。**不是把它塞進候選池加權**，是把它
  // 從池子裡抽出來、直接扣一格 topK——誤判最多浪費那一格，其餘格的相對順序不受影響。
  //
  // ★ 抽出來之後要從池子移除，否則同一則可能又被 ranker 選中一次而重複出現。
  // ★ 上限硬防：`reserved` 若吃掉整個 topK，`rankAndSelect` 內部的
  //   `floorPerCategory × categories > topK` 會拋，而那個拋會被下面的 catch 吞成
  //   「editor failed」——整個 editor 靜默降級、log 還指錯方向。所以在這裡先截斷。
  const MAX_RESERVED = TOP_K - FLOOR_PER_CATEGORY * ITEM_CATEGORIES.length
  const picked = selectMajorAnnouncements(pool, { reportDate: date })
  if (picked.length > MAX_RESERVED)
    console.warn(`[brief] 保留席 ${picked.length} 格超過上限 ${MAX_RESERVED}、截斷（再多會讓 rankAndSelect 拋、被吞成 editor failed）`)
  const reservedCandidates = picked.slice(0, MAX_RESERVED)
  const reservedIds = new Set(reservedCandidates.map(c => c.id))
  const reserved = reservedCandidates.map(toBriefNews)
  if (reserved.length > 0)
    console.warn(`[brief] 重大公告佔用 ${reserved.length} 格保留席：${reserved.map(r => r.title).join('｜')}`)

  try {
    // 取候選失敗時不要繼續打 editor：空候選餵給 LLM 是白花一次呼叫，而且它會在沒有素材的
    // 情況下硬編。改動前這條路是「getRelevanceCandidates 拋 → 直接落 catch」，把取候選
    // 提到 try 外之後要自己把這個等價性補回來。
    if (poolFailed)
      throw new Error('候選池載入失敗')
    const [openLines, recentBriefs, market] = await Promise.all([
      getOpenStorylines(date),
      getRecentBriefSummaries(3, date),
      loadMarketContext({ reportDate: date, ...(seriesAsOf === undefined ? {} : { seriesAsOf }) }).catch((): MarketContext => EMPTY_MARKET_CONTEXT),
    ])
    // ★ editor 仍然「知道」有這則公告：`officialBlock` 已經在它的 prompt 裡（2026-08-28
    //   的附加區塊那次改動）。block 給它知情權、保留席給它出場權，dailyThesis 因此有機會涵蓋。
    const candidates = rankAndSelect(
      pool.filter(c => !reservedIds.has(c.id)),
      { storylines: openLines, aliasMap: getDefaultAliasMap(), briefDate: date },
      { topK: TOP_K - reserved.length },
    )
    const parsed = await callEditor({
      candidates: candidates.map(c => ({ id: c.id, title: c.title, excerpt: (c.contentText ?? '').slice(0, 150), category: c.category })),
      storylines: openLines,
      recentBriefs,
      marketSnapshot: market.snapshotBlock,
      calendarBlock: market.calendarBlock,
      officialBlock: market.officialBlock,
      onCallRecord: onCall,
    })
    // 兩層各自的降級都要留下痕跡：逐筆容錯若不 log 就是靜默降級、看不出 LLM 何時開始吐壞資料。
    // 注意這個數字只涵蓋 schema 檢查、不含幻覺 id 過濾（在 sanitize 層）與超量截斷。
    if (parsed.schemaDroppedEntries > 0)
      console.warn(`[brief] editor storyline 層丟棄 ${parsed.schemaDroppedEntries} 筆不合 schema 的項目`)
    if (!parsed.selection)
      console.warn('[brief] editor 選稿層不合 schema、退回 recency selection（storyline 若有內容仍寫回）')

    const sel = parsed.selection ? sanitizeSelection(parsed.selection, candidates.map(c => c.id)) : null
    storyline = sanitizeStoryline(parsed.storyline, openLines.map(l => l.id))
    if (sel?.ok) {
      const entries = entriesFromEditorResult(storyline.storylineTouches, storyline.resolveStorylines, openLines, date)
      return {
        selection: sel,
        storyline,
        // 須照 editor 的 selectedNewsIds 順序、不可用 candidates.filter（會還原成候選序）：
        // editor 把主軸新聞排前、順序 load-bearing、流經 orchestrator → synthesizer/narrative 影響鋪排
        // 保留席排最前：它就是要當頭條，而順序 load-bearing（流經 orchestrator →
        // synthesizer/narrative 影響鋪排）。
        news: [
          ...reserved,
          ...sel.selectedNewsIds
            .map(id => candidates.find(c => c.id === id))
            .filter((c): c is NonNullable<typeof c> => c != null)
            .map(toBriefNews),
        ],
        storylineBlock: buildStorylineBlock(entries),
        continuityHint: continuityHintFromEntries(entries),
      }
    }
    console.warn('[brief] editor selection not usable after sanitize, falling back to recency selection')
  }
  catch (err) {
    console.warn('[brief] editor failed, falling back to recency selection:', (err as Error).message)
  }
  return {
    // 降級路徑同樣保留席優先：這條路是「editor 掛了」，不是「今天沒有重大公告」。
    // ★ 必須濾掉保留席那則：`selectNewsForBrief` 是獨立的 recency 查詢、不知道保留席，
    //   不濾就會同一則進兩次——重複進 narrative、重複寫 `selected_news_ids`、重複
    //   enqueue analyze（獨立複查實測到 `news ids = ["9001","9001","1"]`）。
    news: [...reserved, ...(await selectNewsForBrief(date)).filter(n => !reservedIds.has(n.id)).map(n => ({ ...n, publishedAt: null }))],
    selection: null,
    storyline,
    // storylineBlock / continuityHint 仍為 null：它們描述的是 editor 對「它選的那批新聞」的敘事線判斷、
    // 與 fallback 選稿對不上，餵給 narrative 會讓當天內文談到當天沒報的線。
    //
    // 為什麼寫回 DB 不受同一個限制：narrative 是「今天這篇」，錯置立刻可見；DB 記的是敘事線本身的進展，
    // 而 editor 的判斷本來就基於它讀過的整個候選池、不是基於最終選了哪幾則。
    // **已知邊界**：週日回顧走 getStorylinesUpdatedInRange，會把 fallback 日寫回的 update 一起收進去，
    // 讀者可能看到「某條線有進展、但那天的報告沒提它」。跨度一週時這個錯置比當天內文輕微，故接受；
    // 要根治得在 update 上標記 fallback 來源讓週報排除。
    storylineBlock: null,
    continuityHint: null,
  }
}

/**
 * 只產生、不持久化：gate → 週末素材 → editor 選稿 → runDailyBrief。
 *
 * 從 `processBriefJob` 抽出（brief:rerun 需要「同素材重跑不寫 DB」的路——見
 * `../../../tools/cli/brief-rerun.ts` 檔頭），`onCall` 會收到這次生成期間**所有**
 * LLM 呼叫紀錄，包含 editor 自己的與 `runDailyBrief` 內部各 agent 的——
 * `runDailyBrief` 把新紀錄直接推進自己的 `metadata` 參數、不經過呼叫端的
 * `onCall`，所以這裡在它跑完後把新增的那段逐筆轉發，讓外部 onCall 拿到完整
 * 成本／延遲、不必自己再組一份 metadata。
 */
export interface GenerateDailyBriefOpts {
  /**
   * 補跑歷史日期時的逐序列 as-of 覆寫，接進 editor 與 `runDailyBrief` 兩次
   * `loadMarketContext` 呼叫（見檔頭 selectNewsViaEditor 與下方 runDailyBrief 呼叫）。
   * `processBriefJob` 的正常路徑不傳，行為不變。
   */
  seriesAsOf?: SeriesAsOfMap
}

export async function generateDailyBrief(date: string, onCall: (r: LlmCallRecord) => void, opts?: GenerateDailyBriefOpts): Promise<GenerateDailyBriefResult> {
  // gate 之前不需要任何一次 DB／LLM 呼叫，故 metadata 建在這裡即可、不必上提給呼叫端。
  const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
  const trackedCall = (r: LlmCallRecord): void => {
    metadata.llmCalls.push(r)
    metadata.totalCostUsd += r.costUsd
    metadata.totalLatencyMs += r.latencyMs
    onCall(r)
  }

  // 非應產日不產 brief（無新聞、無 podcast chain）。放最前面、省整條 pipeline（含 news DB 呼叫）。
  const pubDay = classifyPublicationDay(date)
  if (pubDay.kind === 'skip') {
    console.warn(`[brief] skip ${date}: ${pubDay.reason}`)
    return { kind: 'skip', ...(pubDay.reason ? { reason: pubDay.reason } : {}) }
  }

  // 週日特輯：組本週敘事線回顧（graceful：任何失敗回 null、不擋 brief 照常成稿）。
  let weeklyRecapBlock: string | null = null
  if (pubDay.kind === 'weekly-recap') {
    try {
      const { start, end } = weekBounds(date)
      weeklyRecapBlock = buildWeeklyRecapBlock(await getStorylinesUpdatedInRange(start, end), start, end)
    }
    catch (err) {
      console.warn('[brief] weekly recap 組裝失敗、weekend 仍成稿:', (err as Error).message)
    }
  }

  const { news, selection, storyline, storylineBlock, continuityHint } = await selectNewsViaEditor(date, trackedCall, opts?.seriesAsOf)
  if (news.length === 0)
    throw new Error(`processBriefJob: no news for ${date}`)

  const beforeRunCount = metadata.llmCalls.length
  const brief = await runDailyBrief({
    news: news.map(n => ({ id: String(n.id), title: n.title, url: n.url, text: n.text, publishedAt: n.publishedAt })),
    date,
    metadata,
    storylineBlock,
    continuityHint,
    ...(selection?.mainThemes ? { mainThemes: selection.mainThemes } : {}),
    ...(selection?.dailyThesis ? { dailyThesis: selection.dailyThesis } : {}),
    ...(pubDay.kind === 'weekly-recap' ? { reportKind: 'weekend' as const, weeklyRecapBlock } : {}),
    ...(opts?.seriesAsOf === undefined ? {} : { seriesAsOf: opts.seriesAsOf }),
  })
  // runDailyBrief 內部各 agent 的呼叫紀錄是直接推進 metadata、不經過 trackedCall，
  // 這裡補轉發給外部 onCall（見上方函式註解）。
  for (const r of metadata.llmCalls.slice(beforeRunCount))
    onCall(r)

  const summaryText = `${brief.headline}\n\n${brief.summary}`

  return { kind: 'generated', pubDay, news, selection, storyline, storylineBlock, continuityHint, brief, summaryText }
}
