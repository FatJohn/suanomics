import type { EnqueueFn, JobPayloadByKind } from '@suanomics/jobs'
import type { SkipReason } from '@suanomics/shared'
import type { LlmCallRecord } from '../../agents/llm-wrapper.js'
import type { RunMetadata } from '../../agents/orchestrator.js'
import { saveDailyBrief } from '@suanomics/db/repos/news-repo'
import { applyEditorResult } from '@suanomics/db/repos/storylines-repo'
import { generateDailyBrief } from './brief-generate.js'

export interface ProcessBriefJobParams {
  payload: JobPayloadByKind['daily-brief']
  updateProgress?: (n: number) => Promise<void> | void
  // runner 注入（`ctx.enqueue`）。沒有 module 單例可退回——單 process 之後 enqueue
  // 就是「推進這個 runner 的佇列」，不再是一個誰都能 import 的全域動作。
  enqueue: EnqueueFn
}

export interface BriefJobResult {
  briefId?: number
  metadata: RunMetadata
  skipped?: boolean
  skipReason?: SkipReason
}

// AnalyzePayloadSchema content min 20 字、若 news.text 太短直接 enqueue 會被 zod 拒。
// pad 一下避免 daily brief 列表的新聞「點下去才發現分析未產生」。
function buildAnalyzeContent(text: string, title: string): string {
  const base = text && text.length >= 20 ? text : `${title}\n${text || title}`
  return base.length >= 20 ? base : base.padEnd(20, '。')
}

export async function processBriefJob(p: ProcessBriefJobParams): Promise<BriefJobResult> {
  const metadata: RunMetadata = { llmCalls: [], totalCostUsd: 0, totalLatencyMs: 0 }
  // editor 的 LLM call 與 runDailyBrief 內部共用同一 metadata、成本/延遲一起計入
  // （generateDailyBrief 把兩者都轉發給這裡的 onCall，見該檔函式註解）
  const onCall = (r: LlmCallRecord): void => {
    metadata.llmCalls.push(r)
    metadata.totalCostUsd += r.costUsd
    metadata.totalLatencyMs += r.latencyMs
  }

  const result = await generateDailyBrief(p.payload.date, onCall)
  if (result.kind === 'skip') {
    return { metadata, skipped: true, ...(result.reason ? { skipReason: result.reason } : {}) }
  }
  const { news, brief, summaryText, storyline } = result
  await p.updateProgress?.(10)
  await p.updateProgress?.(90)

  // 把完整 MarketBrief 存進 daily_briefs.brief_json (jsonb)
  // 之前只存 summaryText、narrative / cascadeChains / newsTitlesById 全丟掉、frontend 看不到
  const briefId = await saveDailyBrief(p.payload.date, news.map(n => n.id), summaryText, brief)

  // storyline 寫回是加值、寫回失敗不影響 brief（下次 editor 看到舊狀態、自癒）。
  // 注意 applyEditorResult 不只寫 touches：它開頭的 auto-dormant sweep 與 touches 無關、無條件跑
  // （storylines-repo.ts 的 `// 1. auto-dormant` 那一步，14 天未觸及的 open 線轉 dormant）。選稿層失敗的日子現在也會走到這裡，
  // 等於那天照樣推進 dormant 時鐘——這是刻意的：editor 有跑、有讀完整候選池，只是選稿不足。
  // 必須在 saveDailyBrief 之後：寫進 updates 的 briefDate 要對應已存在的 brief。
  if (storyline) {
    try {
      await applyEditorResult({
        briefDate: p.payload.date,
        touches: storyline.storylineTouches,
        resolves: storyline.resolveStorylines,
        newStorylines: storyline.newStorylines,
      })
    }
    catch (err) {
      console.warn('[brief] applyEditorResult failed:', (err as Error).message)
    }
  }

  // 預跑每則 selected news 的 cascade 分析、user 點 daily brief 列表時不用等。
  // fire-and-forget：個別 enqueue 失敗不影響 daily brief 主結果。
  const enq = p.enqueue
  for (const n of news) {
    try {
      await enq('analyze', {
        title: n.title.slice(0, 300),
        content: buildAnalyzeContent(n.text, n.title),
        newsItemId: n.id,
        // 預跑分析屬於**這份 brief 的日子**，不是執行當下。重生 08-01 的報告時，
        // 它的預跑分析要掛回 08-01；用「今天」會讓 claims 的 asOf 跟報告本身對不上。
        reportDate: p.payload.date,
      })
    }
    catch (err) {
      console.warn(`[brief] enqueue analyze for news ${n.id} failed:`, (err as Error).message)
    }
  }

  // daily-brief 成功後 fire-and-forget enqueue podcast-generate。
  // chainPodcast 預設 true (DailyBriefPayloadSchema default)，可由 caller payload 顯式關掉。
  // 失敗路徑（runDailyBrief 拋例外）自然跳過本區塊，不浪費 podcast LLM 呼叫。
  if (p.payload.chainPodcast !== false) {
    try {
      await enq('podcast-generate', { date: p.payload.date })
    }
    catch (err) {
      console.warn(`[brief] enqueue podcast-generate for ${p.payload.date} failed:`, (err as Error).message)
    }
  }

  await p.updateProgress?.(100)
  return { briefId, metadata }
}
