import type { CascadeChain, EvidenceClaim, Viewpoints } from '@suanomics/shared'
import type { LlmCallRecord } from './llm-wrapper.js'
import { checkCompliance, ViewpointsSchema } from '@suanomics/shared'
import {
  buildDebateMaterial,
  NET_READ_GEMINI_SCHEMA,
  NET_READ_PROMPT,
  POINTS_GEMINI_SCHEMA,
  RISK_PROMPT,
  SUPPORT_PROMPT,
} from '../prompts/viewpoints-debate.prompt.js'
import { VIEWPOINTS_DEBATE_USER_TEXT } from '../prompts/viewpoints-debate.user-content.js'
import { stripViolatingProse } from './_compliance-strip.js'
import { hasGarbledChars } from './_garbled-text.js'
import { callAgentLLM } from './llm-wrapper.js'

export interface RunViewpointsDebateParams {
  thesis: string
  headline: string
  summary: string
  marketSnapshot: string | null
  cascadeChains: CascadeChain[]
  // analyst 已核對過的證據；缺席時辯論只剩 headline/summary/snapshot/chains，
  // 反向數字會兩個讀者面欄位都到不了
  claimLedger?: readonly EvidenceClaim[]
  onCallRecord?: (r: LlmCallRecord) => void
}

// 所有 reader-facing viewpoints 文字拼成一字串、供 checkCompliance 掃描
function viewpointsText(v: Viewpoints): string {
  return [...v.supportPoints, ...v.riskPoints, v.netRead].join('\n')
}

// bounded debate：support ‖ risk（平行各一輪）→ net-read 收斂 → 合規 gate。
// 任一步失敗 / 違規 / 不合 schema → 回 null（graceful degrade、brief 照常出稿、不阻擋）。
export async function runViewpointsDebate(
  p: RunViewpointsDebateParams,
): Promise<Viewpoints | null> {
  try {
    const material = buildDebateMaterial({
      thesis: p.thesis,
      headline: p.headline,
      summary: p.summary,
      marketSnapshot: p.marketSnapshot,
      cascadeChains: p.cascadeChains,
      ...(p.claimLedger ? { claimLedger: p.claimLedger } : {}),
    })
    const onCall = p.onCallRecord
    const opt = onCall ? { onCallRecord: onCall } : {}

    const [support, risk] = await Promise.all([
      callAgentLLM<{ points: string[] }>({
        agentName: 'viewpoints-debate',
        systemPrompt: SUPPORT_PROMPT,
        userContent: VIEWPOINTS_DEBATE_USER_TEXT.supportUserContent(material),
        responseSchema: POINTS_GEMINI_SCHEMA,
        ...opt,
      }),
      callAgentLLM<{ points: string[] }>({
        agentName: 'viewpoints-debate',
        systemPrompt: RISK_PROMPT,
        userContent: VIEWPOINTS_DEBATE_USER_TEXT.riskUserContent(material),
        responseSchema: POINTS_GEMINI_SCHEMA,
        ...opt,
      }),
    ])

    const netReadOut = await callAgentLLM<{ netRead: string }>({
      agentName: 'viewpoints-debate',
      systemPrompt: NET_READ_PROMPT,
      userContent: VIEWPOINTS_DEBATE_USER_TEXT.netReadUserContent(material, support.points, risk.points),
      responseSchema: NET_READ_GEMINI_SCHEMA,
      ...opt,
    })

    // 句級降級（取代整包 all-or-nothing）：逐點濾除違規 point、netRead 逐句 strip 違規句。
    // 一個方向詞不再讓整個 viewpoints 消失；清乾淨後才驗 schema。
    //
    // 亂碼與合規並列在同一道濾網：2026-08-12 的 A/B 觀察到模型偶爾整句吐出被替換掉的字元
    // （`成由攥䍕挧攥萱刑甘成甥、嘐瀕外資售日買超台股達903.08億元`），而 compliance gate
    // 與 schema 都會放行。見 `_garbled-text.ts`。
    const clean = (pt: string): boolean => checkCompliance(pt) === null && !hasGarbledChars(pt)
    const candidate = {
      supportPoints: support.points.map(s => s.trim()).filter(Boolean).filter(clean),
      riskPoints: risk.points.map(s => s.trim()).filter(Boolean).filter(clean),
      netRead: stripViolatingProse(netReadOut.netRead.trim()),
    }
    // netRead 是單一段連續文字、沒有「丟掉壞的那一點」這個選項；亂碼就整包 degrade。
    // brief 照常出稿（少了 viewpoints 區塊），比讓亂碼上讀者面好。
    if (hasGarbledChars(candidate.netRead)) {
      console.warn('[viewpoints-debate] degrade reason=garbled-netread')
      return null
    }
    // strip 後若不足門檻（support/risk 各 <2、或 netRead <120）→ schema 擋下 → degrade null。
    const parsed = ViewpointsSchema.safeParse(candidate)
    if (!parsed.success) {
      console.warn(`[viewpoints-debate] degrade reason=schema-invalid issues=${JSON.stringify(parsed.error.issues).slice(0, 800)}`)
      return null
    }
    // 逐點/逐句 strip 後理應全 clean；防禦性複查跨點/跨句 proximity 殘留。
    const violation = checkCompliance(viewpointsText(parsed.data))
    if (violation) {
      console.warn(`[viewpoints-debate] degrade reason=compliance violation=${violation.violation} matched=${violation.matched}`)
      return null
    }
    return parsed.data
  }
  catch (err) {
    console.warn(`[viewpoints-debate] degrade reason=error err=${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
