import type { CascadeChain } from '@suanomics/shared'
import type { LlmCallRecord } from './llm-wrapper.js'
import { CHAIN_GROUPER_SYSTEM_PROMPT } from '../prompts/chain-grouper.prompt.js'
import { CHAIN_GROUPER_USER_TEXT } from '../prompts/chain-grouper.user-content.js'
import { callAgentLLM } from './llm-wrapper.js'

/**
 * 把每條 cascade chain 標上它所屬的力場分組。
 *
 * 為什麼需要一次 LLM 呼叫：`industry` 是 analyst 每條 chain 各自命名的自由字串（2026-07-31
 * 的報告 51 條 chain 有 49 個不同名字），而力場名是 synthesizer 當天現產的。兩邊都不是固定
 * 詞彙表，程式的字串比對接不起來——`Semiconductors` 與「半導體與先進代工」沒有共同子字串。
 *
 * 這一步**永遠不阻擋 brief**：失敗就回傳原 chains，讀者面退回不分組呈現。
 */

const RESPONSE_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    mapping: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          force: { type: 'string' },
        },
        required: ['label', 'force'],
      },
    },
  },
  required: ['mapping'],
}

export interface CallChainGrouperParams {
  chains: CascadeChain[]
  /** 力場名稱。**只餵名稱**——spike 實測名稱後面帶「（mixed）」之類的後綴，模型會照抄進 force */
  forceNames: string[]
  onCallRecord?: (r: LlmCallRecord) => void
}

function buildUserContent(labels: string[], forceNames: string[]): string {
  return [
    CHAIN_GROUPER_USER_TEXT.forceGroupsHeading,
    forceNames.map(n => `- ${n}`).join('\n'),
    '',
    CHAIN_GROUPER_USER_TEXT.labelsHeading(labels.length),
    labels.map(l => `- ${l}`).join('\n'),
  ].join('\n')
}

/**
 * 回傳標好 `forceGroup` 的 chains。歸不進任何力場的標 `null`。
 *
 * 三種情況原樣回傳（不標任何 forceGroup）：沒有 chain、沒有力場名、LLM 呼叫失敗。
 * 讀者面靠 `forceGroup === undefined` 判斷要不要退回不分組呈現，所以這三種情況必須
 * 留 undefined 而不是塞一堆 null——後者會讓「全部歸不進去」與「根本沒跑過」長得一樣。
 */
export async function tagChainForceGroups(p: CallChainGrouperParams): Promise<CascadeChain[]> {
  const labels = [...new Set(p.chains.map(c => c.industry))]
  if (labels.length === 0 || p.forceNames.length === 0)
    return p.chains

  let mapping: { label: string, force: string }[]
  try {
    const out = await callAgentLLM<{ mapping: { label: string, force: string }[] }>({
      agentName: 'chain-grouper',
      systemPrompt: CHAIN_GROUPER_SYSTEM_PROMPT,
      userContent: buildUserContent(labels, p.forceNames),
      responseSchema: RESPONSE_GEMINI_SCHEMA,
      ...(p.onCallRecord ? { onCallRecord: p.onCallRecord } : {}),
    })
    mapping = out.mapping ?? []
  }
  catch {
    // 分組是加分項不是必需品：grouper 掛掉不該讓整份 brief 產不出來
    return p.chains
  }

  const valid = new Set(p.forceNames)
  const byLabel = new Map<string, string | null>()
  for (const m of mapping) {
    // 模型自創或改寫過的分組名一律當歸不進去——寧可少一組，也不要在讀者面生出一個
    // 力場圖上沒有的分類，那會讓「同一套產業語彙」這件事失效
    byLabel.set(m.label, valid.has(m.force) ? m.force : null)
  }

  return p.chains.map(c => ({ ...c, forceGroup: byLabel.get(c.industry) ?? null }))
}
