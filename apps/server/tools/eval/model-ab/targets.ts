import type { MarketBrief } from '@suanomics/shared'
import type { CallAgentLLMParams, LlmCallRecord } from '../../../src/agents/llm-wrapper.js'
import type { AgentName } from '../../../src/agents/providers/resolve.js'
import type { DivergenceField } from './pair-compare.js'
import type { ArticleRun, CallRow, RunFile } from './types.js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GoogleGenAI } from '@google/genai'
import { pMap } from '../../../src/_p-map.js'
import { callAgentLLM } from '../../../src/agents/llm-wrapper.js'
import { clampString } from '../../../src/agents/narrative-shared.js'
import { normalizeTaggerResponse } from '../../../src/agents/news-tagger.js'
import { runViewpointsDebate } from '../../../src/agents/viewpoints-debate.js'
import { enrichEntitySummary } from '../../../src/corpus/entity-summary.js'
import { NEWS_TAGGER_SYSTEM_PROMPT } from '../../../src/prompts/news-tagger.prompt.js'
import { ENTITY_SUMMARY_CALLS_PER_ARTICLE, VIEWPOINTS_DEBATE_CALLS_PER_RUN, VIEWPOINTS_DEBATE_PEAK } from '../../cli/lib/llm-run-estimates.js'
import { CANARY_DIR, listCanaryDates } from '../canary-fixtures.js'
import { loadBrief } from '../load-brief.js'

// 受測 agent 的註冊表。要 A/B 一個新 agent＝在 TARGETS 加一格，
// 切臂、記帳、雜訊底線判讀與落檔都由 model-ab.ts 與 eval/model-ab/* 負責。

export interface SampleArticle { id: number, title: string, body: string, url: string, prodTags: string[] }

/**
 * canary fixture 是 news_items dump；同一則新聞會出現在多天、以 url 去重。
 * 排序用 id 而非日期，讓 `--samples=N` 取到的子集跨日期分散、不會全塞同一天。
 */
export function loadSamples(limit: number): SampleArticle[] {
  const dates = listCanaryDates()
  const byUrl = new Map<string, SampleArticle>()
  for (const d of dates) {
    const raw = JSON.parse(readFileSync(resolve(CANARY_DIR, d, 'sources.json'), 'utf8')) as {
      id: number
      title: string
      url: string
      contentText: string | null
      topicTags: string[] | null
    }[]
    for (const r of raw) {
      if (!byUrl.has(r.url))
        byUrl.set(r.url, { id: r.id, title: r.title, body: r.contentText ?? r.title, url: r.url, prodTags: r.topicTags ?? [] })
    }
  }
  return [...byUrl.values()].sort((a, b) => a.id - b.id).slice(0, limit)
}

/**
 * 直接打 API 問 modelVersion：確認兩個 model 名稱是不同的真實 backend、不是同一個 alias。
 *
 * ★ Gemini 專屬、換 provider 換不掉：它讀的是 Gemini 回應裡的 `modelVersion` 欄位，
 * `apps/server/src/agents/providers/types.ts` 的 provider-neutral `ProviderCallResult`
 * 沒有、也不該定義這個概念（不同 provider 對「這次回應實際打到哪個 backend build」
 * 沒有共同語意）。這支只在 model A/B eval 工具用，不影響主 pipeline 的 provider 抽象。
 * 見 `apps/server/tools/ci/gemini-only-paths.ts`。
 */
export async function probeModelVersions(models: readonly string[], apiKey: string): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey })
  const out: string[] = []
  for (const m of models) {
    const res = await ai.models.generateContent({
      model: m,
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      config: { responseMimeType: 'application/json', responseSchema: { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'] } },
    })
    out.push(`requested=${m} -> modelVersion=${(res as { modelVersion?: string }).modelVersion ?? '(none)'}`)
  }
  return out
}

/** 攔 console.warn 收 degrade 原因（schema-invalid / compliance / llm error）。 */
async function captureWarnings<T>(fn: () => Promise<T>): Promise<{ value: T, warns: string[] }> {
  const warns: string[] = []
  const orig = console.warn
  console.warn = (...args: unknown[]): void => {
    warns.push(args.map(String).join(' '))
  }
  try {
    return { value: await fn(), warns }
  }
  finally {
    console.warn = orig
  }
}

export interface TargetRunInput {
  label: string
  samples: readonly SampleArticle[]
  dates: readonly string[]
  concurrency: number
  outDir: string
  log: (line: string) => void
}
export interface TargetRunOutput { articles: ArticleRun[], calls?: CallRow[], artifacts?: string[] }

/**
 * `model-ab.ts` 開跑前用這個估算「跑完要打幾次 LLM、尖峰多少」，交
 * `enforceLlmRunBudget` 判定要不要要求 `--yes`。刻意跟 `TargetRunInput` 分開——
 * 估算階段不需要 `outDir`／`log` 這些跟「算幾次」無關的東西，且 `armCount` 是
 * model-ab.ts 算好的臂數（`planArms` 的結果），不是 target 自己能推導的。
 */
export interface ModelAbEstimateInput {
  armCount: number
  sampleCount: number
  dateCount: number
}

export interface ModelAbTarget {
  agentName: AgentName
  /** structured＝可算機械指標；prose＝只能交 pairwise judge */
  mode: 'structured' | 'prose'
  divergenceField: DivergenceField
  input: 'samples' | 'dates'
  run: (i: TargetRunInput) => Promise<TargetRunOutput>
  /**
   * 開跑前預估這次執行會打幾次「成功」LLM 呼叫（不含 retry，口徑同
   * llm-run-estimates.ts）。必填：新增 target 時型別會強制想清楚這個數字，
   * 不會被漏掉。
   */
  estimateCalls: (i: ModelAbEstimateInput) => number
  /**
   * 開跑前預估這次執行的尖峰並行。`concurrency` 是呼叫端（`--concurrency`，
   * 只對 entity-summary 這種 pMap 型 target 有意義）；其餘 target 忽略它、回固定值。
   */
  estimatePeak: (i: ModelAbEstimateInput & { concurrency: number }) => number
}

// entity-summary：注入 callLLM 以攔截 LLM 原始輸出（要看未收斂的 kind）與 call record。
// enrichEntitySummary 自己也掛了 onCallRecord，所以要 chain 回去、不能覆蓋。
async function runEntitySummaryOne(s: SampleArticle): Promise<ArticleRun> {
  const records: LlmCallRecord[] = []
  const raws: unknown[] = []
  const { value: res, warns } = await captureWarnings(() => enrichEntitySummary({ title: s.title, body: s.body }, {
    callLLM: async (p: CallAgentLLMParams) => {
      const raw = await callAgentLLM<unknown>({
        ...p,
        onCallRecord: (r) => {
          records.push(r)
          p.onCallRecord?.(r)
        },
      })
      raws.push(raw)
      return raw
    },
  }))
  const rawKinds = raws.flatMap((r) => {
    const ents = (r as { entities?: unknown })?.entities
    return Array.isArray(ents) ? ents.map(e => String((e as { kind?: unknown }).kind)) : []
  })
  const last = records.at(-1)
  return {
    articleId: s.id,
    title: s.title,
    failed: res.failed,
    contentSummary: res.data?.contentSummary ?? '',
    entities: res.data?.entities ?? [],
    rawKinds,
    topicTags: res.data?.topicTags ?? [],
    attempts: Math.max(records.length, 1),
    zodFailures: warns.filter(w => w.includes('schema validation failed')).length,
    llmErrors: warns.filter(w => w.includes('llm call failed')).length,
    tokensIn: last?.tokensIn ?? 0,
    tokensOut: last?.tokensOut ?? 0,
    cachedReadTokens: last?.cachedReadTokens ?? 0,
    costUsd: records.reduce((a, r) => a + r.costUsd, 0),
    latencyMs: last?.latencyMs ?? 0,
  }
}

// news-tagger：callNewsTagger 沒有 onCallRecord 出口、故在此複製它那幾行（prompt / schema /
// userContent 組法與 normalizeTaggerResponse 都直接 import production，只有 batch 迴圈是本地的）。
const TAGGER_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
        required: ['id', 'tags'],
      },
    },
  },
  required: ['results'],
}
const TAGGER_BATCH = 15

function emptyArticle(s: SampleArticle, tags: string[] | undefined): ArticleRun {
  return {
    articleId: s.id,
    title: s.title,
    // LLM 沒回這個 id ＝ 該則整個沒 tag（prod 會寫成空陣列）
    failed: tags === undefined,
    contentSummary: '',
    entities: [],
    rawKinds: [],
    topicTags: tags ?? [],
    attempts: 1,
    zodFailures: 0,
    llmErrors: 0,
    tokensIn: 0,
    tokensOut: 0,
    cachedReadTokens: 0,
    costUsd: 0,
    latencyMs: 0,
  }
}

async function runNewsTagger(i: TargetRunInput): Promise<TargetRunOutput> {
  const calls: CallRow[] = []
  const tagsById = new Map<number, string[]>()
  for (let n = 0; n < i.samples.length; n += TAGGER_BATCH) {
    const batch = i.samples.slice(n, n + TAGGER_BATCH)
    const raw = await callAgentLLM<unknown>({
      agentName: 'news-tagger',
      systemPrompt: NEWS_TAGGER_SYSTEM_PROMPT,
      userContent: batch.map(b => `[id=${b.id}] ${clampString(b.title, 120)} — ${clampString(b.body, 150)}`).join('\n'),
      responseSchema: TAGGER_SCHEMA,
      onCallRecord: r => calls.push({
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        cachedReadTokens: r.cachedReadTokens ?? 0,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
        attempts: r.attempts,
      }),
    })
    for (const t of normalizeTaggerResponse(raw, batch.map(b => b.id)))
      tagsById.set(t.id, t.tags)
  }
  return { articles: i.samples.map(s => emptyArticle(s, tagsById.get(s.id))), calls }
}

async function runEntitySummary(i: TargetRunInput): Promise<TargetRunOutput> {
  let done = 0
  const articles = await pMap(i.samples, i.concurrency, async (s) => {
    const a = await runEntitySummaryOne(s)
    done++
    if (done % 5 === 0 || done === i.samples.length)
      i.log(`  ...${done}/${i.samples.length}`)
    return a
  })
  return { articles }
}

// viewpoints-debate：prose 型 agent。輸入 100% 在 canary fixture 的 brief.json 裡、
// 不需要 Postgres；把產出 splice 回 viewpoints 一欄、其餘欄位 byte-identical，
// 於是兩臂的差異只有這個 agent，可以直接餵 `brief:quality` pairwise。
async function runViewpoints(i: TargetRunInput): Promise<TargetRunOutput> {
  const calls: CallRow[] = []
  const artifacts: string[] = []
  for (const date of i.dates) {
    const brief: MarketBrief = loadBrief(resolve(CANARY_DIR, date, 'brief.json'))
    const { value: viewpoints, warns } = await captureWarnings(() => runViewpointsDebate({
      thesis: brief.dailyThesis ?? '',
      headline: brief.headline,
      summary: brief.summary,
      // fixture 無 market snapshot（非 MarketBrief 欄位、需要 DB）；兩臂同樣傳 null、單變因不受影響
      marketSnapshot: null,
      cascadeChains: brief.cascadeChains ?? [],
      // prod 自 2026-08-14 起會餵 ledger，且它讓 viewpoints 的 input token 幾乎翻倍。
      // 這裡不傳的話，換 model 的 A/B 會在一份比 prod 短一半的素材上比成本與品質。
      // ★ 2026-08-23 複查：07-21～07-26 那五天在 ledger 上線之前、沒有 ledger，這行對它們是
      //   no-op；但後來補的 08-12（36 條）與 08-13（56 條）有，所以七天裡有兩天是 prod 形狀。
      //   換 model 的成本外推要記得其餘五天的 input 偏短。
      ...(brief.claimLedger ? { claimLedger: brief.claimLedger } : {}),
      onCallRecord: r => calls.push({
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        cachedReadTokens: r.cachedReadTokens ?? 0,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
        attempts: r.attempts,
      }),
    }))
    const path = resolve(i.outDir, `${date}-${i.label}.json`)
    mkdirSync(i.outDir, { recursive: true })
    writeFileSync(path, `${JSON.stringify({ ...brief, viewpoints: viewpoints ?? null }, null, 2)}\n`, 'utf8')
    artifacts.push(path)
    i.log(`  ${date} viewpoints=${viewpoints ? 'ok' : 'DEGRADED'} warns=${warns.length} -> ${path}`)
  }
  return { articles: [], calls, artifacts }
}

export const TARGETS: Record<string, ModelAbTarget> = {
  'entity-summary': {
    agentName: 'corpus-entity-summary',
    mode: 'structured',
    divergenceField: 'entities',
    input: 'samples',
    run: runEntitySummary,
    // 每篇文章最壞情況 ENTITY_SUMMARY_CALLS_PER_ARTICLE 次（entity-summary.ts 的外層重試迴圈）。
    estimateCalls: i => i.armCount * i.sampleCount * ENTITY_SUMMARY_CALLS_PER_ARTICLE,
    // runEntitySummary 用 pMap(samples, i.concurrency, ...) 平行跑，尖峰就是呼叫端傳的 --concurrency。
    estimatePeak: i => i.concurrency,
  },
  'news-tagger': {
    agentName: 'news-tagger',
    mode: 'structured',
    divergenceField: 'topicTags',
    input: 'samples',
    run: runNewsTagger,
    // 每批（TAGGER_BATCH 則）一次成功呼叫即結束重試迴圈，不套 ENTITY_SUMMARY 那種重試乘數。
    estimateCalls: i => i.armCount * Math.ceil(i.sampleCount / TAGGER_BATCH),
    // runNewsTagger 序列跑批次（for 迴圈、非 pMap），單一時刻只有一次呼叫在飛。
    estimatePeak: () => 1,
  },
  'viewpoints-debate': {
    agentName: 'viewpoints-debate',
    mode: 'prose',
    divergenceField: 'entities',
    input: 'dates',
    run: runViewpoints,
    // 每個日期一次 runViewpointsDebate，固定 3 通呼叫（support/risk/net-read）。
    estimateCalls: i => i.armCount * i.dateCount * VIEWPOINTS_DEBATE_CALLS_PER_RUN,
    estimatePeak: () => VIEWPOINTS_DEBATE_PEAK,
  },
}

export function readRunFile(dir: string, label: string): RunFile {
  return JSON.parse(readFileSync(resolve(dir, `${label}.json`), 'utf8')) as RunFile
}

export function writeRunFile(dir: string, run: RunFile): string {
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, `${run.label}.json`)
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8')
  return path
}
