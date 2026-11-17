import type { z } from 'zod'
import type { AgentInput } from '../../src/agents/call-agent.js'
import type { AgentName } from '../../src/agents/models.js'

// judge 只依賴這個簽章，測試注入假的 call，CLI 注入綁好花費閘與帳本的 callAgent。
export type JudgeCall = <T>(name: AgentName, input: AgentInput, schema: z.ZodType<T>) => Promise<T>
