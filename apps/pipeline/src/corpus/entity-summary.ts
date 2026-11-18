import type { AgentInput, CallAgentOptions, LlmCallRecord } from '../agents/call-agent.js'
import { z } from 'zod'
import { callAgent } from '../agents/call-agent.js'
import { CostGateError } from '../agents/cost-gate.js'
import { resolveAgentModel } from '../agents/models.js'
import { CorpusEntitySummaryResponse } from '../agents/response-schemas.js'
import { clampContentSummary, isMostlyChinese } from './entity-summary-normalize.js'
import { buildEntitySummaryPrompt } from './entity-summary-prompt.js'

const AGENT_NAME = 'corpus-entity-summary' as const

// 重試分工（改動前請先讀）：
// - 本檔的迴圈掌握「總共可以問幾次模型」的預算，涵蓋 provider 拋錯（API / timeout /
//   structured output 不符）與本檔 zod 驗證失敗兩種。
// - callAgent 一律以單次模式呼叫（maxAttempts: 1），否則兩層 retry 會相乘成 3x3=9 次 API。
// - 花費閘與帳號錯誤（CostGateError）不在預算內，直接往上拋、中止整輪 refresh。
// zod 失敗必須重試的原因：本檔的 ResponseSchema 嚴於傳給 structured output 的
// CorpusEntitySummaryResponse（confidence 限 0-1、topicTags ≤10，那份刻意不設限），
// 這類偏差只有這裡擋得住，擋到就放棄等於整篇文章無聲失去 entities / topicTags。
const DEFAULT_MAX_ATTEMPTS = 3

const ENTITY_KINDS = ['company', 'ticker', 'sector', 'macro', 'other'] as const
type EntityKind = (typeof ENTITY_KINDS)[number]

// zod 放寬 topicTags 上限（最多 10）、應用層再硬切 5、避免 LLM 多吐幾個就整包失敗
const ResponseSchema = z.object({
  contentSummary: z.string(),
  entities: z.array(z.object({
    kind: z.string(),
    name: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  topicTags: z.array(z.string()).max(10),
})

export interface EntitySummaryResult {
  failed: boolean
  data: {
    contentSummary: string
    entities: Array<{ kind: EntityKind, name: string, confidence: number }>
    topicTags: string[]
  } | null
  tokensIn?: number
  tokensOut?: number
  /** 這次呼叫實際跑的 model 與實算成本、供 corpus-worker 寫進 external_articles 記帳欄 */
  model?: string
  costUsd?: number
}

/** 測試注入點：回傳 callAgent 已 parse 過的物件（unknown、由本檔的 zod 收斂） */
export type EntitySummaryLlmCaller = (input: AgentInput, options: CallAgentOptions) => Promise<unknown>

const defaultCaller: EntitySummaryLlmCaller = (input, options) =>
  callAgent(AGENT_NAME, input, CorpusEntitySummaryResponse, options)

export interface EnrichDeps {
  callLLM: EntitySummaryLlmCaller
  /** 總共可以問幾次模型（含第一次）、預設 DEFAULT_MAX_ATTEMPTS */
  maxAttempts?: number
}

export async function enrichEntitySummary(
  input: { title: string, body: string },
  deps?: Partial<EnrichDeps>,
): Promise<EntitySummaryResult> {
  const callLLM = deps?.callLLM ?? defaultCaller
  const maxAttempts = deps?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const systemPrompt = buildEntitySummaryPrompt()
  const userContent = `標題：${input.title}\n\n正文：${input.body.slice(0, 8000)}`

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const suffix = `(attempt ${attempt}/${maxAttempts})`
    let record: LlmCallRecord | undefined
    let parsed: unknown
    try {
      parsed = await callLLM({ systemPrompt, userContent }, {
        maxAttempts: 1, // 單次模式：重試預算由本迴圈掌握，見檔頭「重試分工」
        onCallRecord: (r) => {
          record = r
        },
      })
    }
    catch (err) {
      if (err instanceof CostGateError)
        throw err
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[entity-summary] llm call failed ${suffix}: ${msg}`)
      continue
    }

    const zodRes = ResponseSchema.safeParse(parsed)
    if (!zodRes.success) {
      console.warn(`[entity-summary] schema validation failed ${suffix}: ${zodRes.error.message}`)
      continue
    }

    const data = zodRes.data
    // 長度規格寫在 prompt 裡、模型不自律時沒人擋得住（實測：flash-lite 出界比例 36.5%、
    // 出界範圍 [58, 218]）。這裡做無損收斂：只截上界、不因長度失敗，否則會連 entities
    // 與 topicTags 一起賠掉。下界救不了，留給 prompt。
    const contentSummary = clampContentSummary(data.contentSummary)
    // 語言的修法在 prompt（原本整份沒有任何語言指示）。這裡不重試——模型跟著原文語言是
    // 系統性行為、重試同一份 prompt 不會變，只會在大量英文來源上白燒 API。留一行 warn
    // 讓殘留偏差在 worker log 上看得見。
    if (!isMostlyChinese(contentSummary))
      console.warn(`[entity-summary] 摘要不是中文（prompt 要求繁中）：${contentSummary.slice(0, 40)}`)
    return {
      failed: false,
      data: {
        contentSummary,
        entities: data.entities.map(e => ({
          kind: (ENTITY_KINDS as readonly string[]).includes(e.kind) ? (e.kind as EntityKind) : 'other',
          name: e.name,
          confidence: e.confidence,
        })),
        topicTags: data.topicTags.slice(0, 5),
      },
      model: record?.model ?? resolveAgentModel(AGENT_NAME).model,
      ...(record ? { tokensIn: record.tokensIn, tokensOut: record.tokensOut, costUsd: record.costUsd } : {}),
    }
  }

  // 這裡不 throw：corpus-worker 依賴 failed 語意繼續保存原文（只是沒有 enrichment）
  return { failed: true, data: null }
}
