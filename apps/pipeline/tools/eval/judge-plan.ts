import type { AgentName } from '../../src/agents/models.js'
import type { JudgeKind } from './judge-args.js'

export const JUDGE_AGENT = {
  quality: 'brief-quality-judge',
  continuity: 'brief-continuity-judge',
} as const satisfies Record<JudgeKind, AgentName>

/** 去掉帳本裡已有 ok 紀錄的 judge；只算 ok，失敗或輸出不合格的那次仍要重評。 */
export function pendingJudges(requested: readonly JudgeKind[], judgedAgents: readonly string[]): JudgeKind[] {
  const judged = new Set(judgedAgents)
  return requested.filter(kind => !judged.has(JUDGE_AGENT[kind]))
}
