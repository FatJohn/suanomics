// 對真端點驗證 LLM 呼叫層：haiku 與 sonnet 各打兩次，共 4 次，每次不重試。
// 同一個 system prompt 第二次呼叫時 cache_read_input_tokens 要 > 0。會實際計費。
//
// ANTHROPIC_API_KEY='op://suanomics/suanomics · Anthropic (pipeline)/credential' \
//   op run --account johnnyhtw.1password.com -- pnpm --filter @suanomics/pipeline run llm:live-check

import type { LlmCallRecord } from './call-agent.js'
import type { AgentName } from './models.js'
import process from 'node:process'
import { z } from 'zod'
import { callAgent } from './call-agent.js'
import { DailyCostGate } from './cost-gate.js'
import { resolveAgentModel } from './models.js'

const LIMIT_USD = 0.5
const Answer = z.object({ answer: z.string() })

// 要超過 Haiku 5.5 與 Sonnet 5.5 的最低可快取長度（512 token），否則不會寫入快取。
const SYSTEM_PROMPT = [
  '你是 prompt caching 驗證用的助理。用一句話回答使用者的問題，輸出 JSON。',
  ...Array.from({ length: 200 }, (_, i) => `固定段落 ${i}：這段文字只用來讓 system prompt 超過最低可快取長度。`),
].join('\n')

async function check(agent: AgentName, gate: DailyCostGate): Promise<boolean> {
  const { model } = resolveAgentModel(agent)
  const records: LlmCallRecord[] = []
  for (const question of ['台灣的首都是哪裡？', '日本的首都是哪裡？']) {
    const output = await callAgent(agent, { systemPrompt: SYSTEM_PROMPT, userContent: question }, Answer, {
      gate,
      maxAttempts: 1,
      onCallRecord: r => records.push(r),
    })
    const record = records.at(-1)
    console.warn(JSON.stringify({ agent, model, parsed: Answer.parse(output), cache_read_input_tokens: record?.cachedReadTokens, cache_creation_input_tokens: record?.cacheWriteTokens, costUsd: record?.costUsd }))
  }
  return (records[1]?.cachedReadTokens ?? 0) > 0
}

async function main(): Promise<void> {
  const gate = new DailyCostGate(LIMIT_USD)
  const results = [await check('news-tagger', gate), await check('decomposer', gate)]
  console.warn(`totalUsd=${gate.totalUsd.toFixed(6)}`)
  if (results.includes(false)) {
    console.error('FAIL：第二次呼叫沒有讀到快取')
    process.exitCode = 1
  }
}

void main()
