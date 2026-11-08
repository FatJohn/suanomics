import { z } from 'zod'
import { EvidenceClaimSchema } from './evidence-claim.js'
import { CalendarCoverageSchema, CalendarEventSchema } from './market-calendar.js'
import { SeriesFreshnessSchema } from './market-freshness.js'

export const RelationTypeSchema = z.enum(['cause', 'effect', 'context', 'contrast'])
export type RelationType = z.infer<typeof RelationTypeSchema>
export const IndustryDirectionSchema = z.enum(['positive', 'negative', 'mixed', 'uncertain'])
export const IndustryConfidenceSchema = z.enum(['high', 'medium', 'low'])

export const RelatedNewsSchema = z.object({
  title: z.string().min(1),
  // 真 source URL（組裝層 resolveRelatedNews 由 selected news id 反查真 url、再經此驗）
  url: z.string().url(),
  relationType: RelationTypeSchema,
  reasoning: z.string().max(600),
})
export type RelatedNews = z.infer<typeof RelatedNewsSchema>

export const AffectedIndustrySchema = z.object({
  name: z.string().min(1),
  direction: IndustryDirectionSchema,
  confidence: IndustryConfidenceSchema,
  reasoning: z.string().max(600),
})

export const RelatedEtfSchema = z.object({
  ticker: z.string().min(1),
  name: z.string().min(1),
  rationale: z.string().max(600),
})

export const MarketBriefCitationSchema = z.object({
  title: z.string().min(1),
  // 真 source URL（組裝層 assembleBriefCitations 由 analyst cascade citations http(s)-filter + 去重）
  url: z.string().url(),
  // quote 放寬到 600（Cascade depth analysis）、Gemini 對深度分析自然引用 300-500 字段落、
  // 200 常切句中、可信度降；UI 用 line-clamp 處理顯示。
  quote: z.string().min(1).max(600),
})
export type MarketBriefCitation = z.infer<typeof MarketBriefCitationSchema>

export const MarketBriefDisclaimer = '本分析僅供參考、非投資建議、實際投資請諮詢專業人士' as const

// Cascade chain schema 從 apps/server 移過來、跨 package 共用
// 結構性決策：所有 tier metadata 欄位 optional、refinement 對 undefined pass-through
// 理由：cache rows 沒這些欄位、required 會 502；orchestrator 後處理才蓋
export const CascadeChainSchema = z.object({
  industry: z.string().min(1),
  mechanism: z.string().min(1),
  affectedTickers: z.array(z.string()),
  direction: z.enum(['positive', 'neutral', 'negative']),
  citations: z.array(z.object({
    url: z.string().min(1),
    title: z.string(),
    quote: z.string().max(600),
  })).min(0).max(5),
  // tier 1 Analyst 自提名 partner
  nextTierEntities: z.array(z.string().min(1)).max(5).optional(),
  // orchestrator 後處理蓋
  chainId: z.string().regex(/^t[123]-\d+$/).optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  parentChainId: z.string().regex(/^t[123]-\d+$/).optional(),
  // 無 citation 的二階推演由 tier2-fanout 程式判定標記（非 LLM 自報）
  speculative: z.boolean().optional(),
  /**
   * 這條 chain 屬於當日哪一股力（值＝`affectedIndustries[].name` 之一）。
   *
   * 為什麼需要：`industry` 是 analyst 每條 chain 各自命名的自由字串，2026-07-31 的報告
   * 51 條 chain 有 49 個不同名字，光半導體家族就 14 種寫法（含 `Semiconductors`）。讀者面
   * 拿它當分類軸會碎成一條一格。這個欄位由 chain-grouper 在 synthesizer 之後標上，讓連動
   * 結構與力場圖、長文節標題共用同一套產業語彙。
   *
   * `null` 是正常結果、不是失敗：不屬於當日任何一股力的 chain（建築不動產、生技 CDMO 這類）
   * 寧可留 null 也不硬塞。整個欄位 undefined 代表這份 brief 產於 grouper 之前，或 grouper
   * 當次失敗——兩種情況讀者面都退回不分組呈現。
   */
  forceGroup: z.string().min(1).nullable().optional(),
})
  .refine(
    c => c.tier === undefined || (c.tier === 1) === (c.parentChainId === undefined),
    { message: 'tier 1 chain must have undefined parentChainId; tier ≥ 2 must have one' },
  )
  .refine(
    c => c.tier === undefined || !(c.tier >= 2 && c.nextTierEntities !== undefined),
    { message: 'tier ≥ 2 chains must NOT have nextTierEntities (recursion bound)' },
  )
export type CascadeChain = z.infer<typeof CascadeChainSchema>

// Long-form narrative schema（主題式、取代 per-news 漏斗）
// section = 一個當日主題（非一則新聞）；citationUrls 是 MarketBrief.citations[].url 的 subset
// （在 MarketBriefSchema 級用 superRefine 守）
export const NarrativeSectionSchema = z.object({
  heading: z.string().min(1).max(40), // 主題小標（取自當日主軸）
  body: z.string().min(250).max(800), // 該主題連續論述（編織多則新聞 + cascade + 過場）；max=安全天花板、句界截斷已保證完整句
  // 讀者面「一句話結論」：body 首句是刻意寫的過場句（連接組織是本產品賣點）、不能拿來當結論，
  // 所以由 narrative-writer 另產一句自足的結論。nullable=舊 brief 沒這欄位、版面須承受 null（比照 viewpoints）。
  // max 70 是安全 buffer 天花板、刻意高於 prompt 目標 25-45：實跑觀察到 LLM 穩定落在 46-59 字，
  // 天花板貼著 prompt 目標會讓正常波動被 degrade 成 null（裝置整條消失）。勿縮到 45「對齊」prompt。
  takeaway: z.string().min(1).max(70).nullable().default(null),
  relatedNewsIds: z.array(z.string().min(1)).max(8).default([]), // 本主題涉及的新聞（best-effort traceability）
  // 本段論述所依據的 claim ledger id（`MarketBrief.claimLedger[].id`）。
  // .default([]) 而非 optional，理由同 relatedNewsIds：舊 brief 沒這欄位、下游拿到的
  // 一律是陣列。ledger 裡不存在的 id 在 normalize 層就被 strip（不讓整份 narrative 失敗），
  // 所以這裡不做 cross-field 驗證——能落到這裡的 id 已經過白名單。
  claimIds: z.array(z.string().min(1)).max(8).default([]),
  citationUrls: z.array(z.string().url()).min(1).max(3),
})
export type NarrativeSection = z.infer<typeof NarrativeSectionSchema>

export const NarrativeSchema = z.object({
  intro: z.string().min(120).max(320),
  sections: z.array(NarrativeSectionSchema).min(1).max(4), // 1 section = 1 主題
  outro: z.string().min(120).max(320),
})
export type Narrative = z.infer<typeof NarrativeSchema>

// 顯性正反觀點區塊（bounded-debate spike 驗證的平衡價值、獨立可見區塊、不內化 narrative）
// support/risk = 對 dailyThesis 的正反論據；netRead = 綜合淨讀（情境判斷、非投資建議）
export const ViewpointsSchema = z.object({
  supportPoints: z.array(z.string().min(1).max(120)).min(2).max(4),
  riskPoints: z.array(z.string().min(1).max(120)).min(2).max(4),
  // prompt 目標 120-300 字（NET_READ_PROMPT）、max=安全 buffer 天花板：刻意高於 prompt
  // 目標、給 LLM 波動留餘裕、避免偶爾超標就整段 degrade null。勿縮到 300「對齊」prompt。
  netRead: z.string().min(120).max(360),
})
export type Viewpoints = z.infer<typeof ViewpointsSchema>

export const MarketBriefSchema = z.object({
  headline: z.string().min(1).max(80),
  // Editor 的本日核心論點；undefined = editor fallback／舊 brief／安全處理後降級不顯示。
  dailyThesis: z.string().min(10).max(150).optional(),
  summary: z.string().min(1).max(300),
  relatedNews: z.array(RelatedNewsSchema).max(5),
  affectedIndustries: z.array(AffectedIndustrySchema).max(5),
  relatedETFs: z.array(RelatedEtfSchema).max(5),
  reasoningChain: z.array(z.string().max(150)).min(2).max(6),
  citations: z.array(MarketBriefCitationSchema).min(1),
  disclaimer: z.literal(MarketBriefDisclaimer),
  // 完整 cascade chain 資料、frontend tier UI 用、optional 為向後相容
  cascadeChains: z.array(CascadeChainSchema).optional(),
  // Long-form narrative
  // null = graceful degrade（NarrativeWriter retry 失敗）
  // undefined = cache rows、向後相容
  narrative: NarrativeSchema.nullable().optional(),
  // 顯性正反觀點區塊（bounded debate）
  // null = graceful degrade（辯論失敗/違規）；undefined = 舊 cache/歷史 brief、不渲染
  viewpoints: ViewpointsSchema.nullable().optional(),
  // newsTitlesById：newsId → title 反查 map、供 relatedNewsIds 反查「本段涉及」標題
  newsTitlesById: z.record(z.string(), z.string()).optional(),
  // 產出當下逐序列的資料新鮮度。與 newsTitlesById 一樣由 pipeline 注入、非 LLM 產出。
  // 存下來才回答得了「這份報告當時用的是哪一天的數字」——DB 的 fetched_at 每輪 refresh
  // 都被推新、事後現算會把「報告產出後才補上的資料」誤算成當時就有。
  dataFreshness: z.array(SeriesFreshnessSchema).optional(),
  // 產出當下 7 天窗內的行事曆事件。與 newsTitlesById / dataFreshness 一樣由 pipeline 注入、
  // 非 LLM 產出——LLM 那邊拿的是同一批事件排成的 markdown（calendarBlock），這裡存的是結構
  // 化原料給讀者面的「接下來會來的」時間軸帶用。存下來而不是讀取時現算，理由跟 dataFreshness
  // 相同：事後現算會把「報告產出後才補上的事件」誤算成當時就在行事曆上。
  // undefined = 舊版 brief 沒有這個欄位；空陣列 = 視窗內真的沒事件（兩者版面都是不渲染整條帶）。
  calendarEvents: z.array(CalendarEventSchema).optional(),
  // 補產除權息涵蓋狀態這次修正：公司事件（除權息／法說會）各自的來源涵蓋狀態。存下來是因為它跟
  // calendarEvents 一樣是「產出當下才判斷得出來」的資訊——事後重算會拿「現在」的來源
  // 涵蓋範圍去判斷「當時」的窗，補產舊報告時兩者不是同一件事。
  // undefined = 舊版 brief 沒有這個欄位；正常會是兩筆（除權息＋法說會各一）。
  calendarCoverage: z.array(CalendarCoverageSchema).optional(),
  // 合併去重後的 claim ledger（`buildClaimLedger` 的產出，非 LLM 直出）。
  // **落地是必要的、不是順手存**：narrative 的 section 會帶 `claimIds` 一起持久化，
  // ledger 若只活在產出當下的記憶體，事後沒有人能把 `c3` 解回一條 claim——brief 裡
  // 會留下一堆懸空引用，traceability 只在產出的那一瞬間可量。
  // 只存 claims 本身；sourceCount／droppedDuplicates 是量測中間值，落地只會放大 payload。
  // undefined = 舊版 brief 沒有這個欄位；空陣列 = 當日真的沒有 claim（例如 claim 產出旗標關閉）。
  claimLedger: z.array(EvidenceClaimSchema).optional(),
}).superRefine((data, ctx) => {
  if (!data.narrative)
    return
  const validUrls = new Set(data.citations.map(c => c.url))
  data.narrative.sections.forEach((s, i) => {
    s.citationUrls.forEach((u) => {
      if (!validUrls.has(u)) {
        ctx.addIssue({
          code: 'custom',
          path: ['narrative', 'sections', i, 'citationUrls'],
          message: `unknown citation url: ${u}`,
        })
      }
    })
  })
})
export type MarketBrief = z.infer<typeof MarketBriefSchema>

export const DailyBriefSchema = z.object({
  briefDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().min(10).max(600),
  selectedNewsIds: z.array(z.number().int().positive()).min(1).max(8),
})
export type DailyBrief = z.infer<typeof DailyBriefSchema>
