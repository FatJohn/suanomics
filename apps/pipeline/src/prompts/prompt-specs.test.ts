import type { AgentName } from '../agents/models.js'
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORBIDDEN_PHRASES } from '@suanomics/shared'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ContinuityJudgeResponse } from '../../tools/eval/continuity-judge.js'
import { CONTINUITY_JUDGE_SYSTEM_PROMPT } from '../../tools/eval/continuity-judge.prompt.js'
import { QualityJudgeResponse } from '../../tools/eval/quality-judge.js'
import { QUALITY_JUDGE_SYSTEM_PROMPT } from '../../tools/eval/quality-judge.prompt.js'
import { CLAIMS_PROMPT_SECTION } from '../agents/analyst-claims.js'
import { AGENT_NAMES } from '../agents/models.js'
import * as schemas from '../agents/response-schemas.js'
import { buildEntitySummaryPrompt } from '../corpus/entity-summary-prompt.js'
import { ANALYST_TIER1_SYSTEM_PROMPT } from './analyst-tier1.prompt.js'
import { ANALYST_TIER2_SYSTEM_PROMPT } from './analyst-tier2.prompt.js'
import { CHAIN_GROUPER_SYSTEM_PROMPT } from './chain-grouper.prompt.js'
import { DECOMPOSER_SYSTEM_PROMPT } from './decomposer.prompt.js'
import { EDITOR_SYSTEM_PROMPT } from './editor.prompt.js'
import { NARRATIVE_CLAIM_LEDGER_INSTRUCTION, NARRATIVE_WRITER_SYSTEM_PROMPT, NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT } from './narrative-writer.prompt.js'
import { NEWS_CATEGORIZER_SYSTEM_PROMPT } from './news-categorizer.prompt.js'
import { NEWS_TAGGER_SYSTEM_PROMPT } from './news-tagger.prompt.js'
import { SYNTHESIZER_SYSTEM_PROMPT } from './synthesizer.prompt.js'
import { NET_READ_PROMPT, RISK_PROMPT, SUPPORT_PROMPT } from './viewpoints-debate.prompt.js'

// 產生 docs/prompt-specs/agents/<agent>.md：baguanomics 讀的「目標 prompt 規格」（ADR 0008）。
// prompt 全文、schema 與禁用語都直接取自程式常數，file snapshot 不符時 CI 的 pnpm -r test 會紅，
// 規格檔因此不會與程式漂移。改了 prompt 就加 -u 重產，規格檔 diff 與 prompt 改動放同一個 PR。
// 格式要與 baguanomics 的 src/spec/parse-spec.ts 一致：meta 兩行、現行 prompt 用五個以上反引號的 text fence。

type FrameStyle = 'decomposer' | 'analyst' | 'synthesizer' | 'none'

interface AgentSpec {
  frameStyle: FrameStyle
  prompts: Record<string, string>
  /** 只在特定條件接在 system prompt 後面的段落；不是獨立 prompt，baguanomics 不對它產候選。 */
  appendices?: Record<string, string>
  schemas: Record<string, z.ZodType>
  garnishTerms?: readonly string[]
  note?: string
}

// v0 packages/prompt-research 的 GARNISH_DENYLIST 原樣：不得當固定收尾的抽象評價詞。v0 對被編譯的
// decomposer／analyst／synthesizer 與 podcast-writer 都套用；baguanomics 據此不把它們列成推薦術語。
const GARNISH_TERMS = [
  '評價趨勢評估',
  '配置調整建議',
  '營運展望樂觀',
  '資本配置效率',
  '回收期分析',
  '營運效率指標趨於穩健',
  '單位經濟模型優化',
  '經常性營收成長動能',
  '客戶流失率波動',
] as const

const SPECS: Record<AgentName, AgentSpec> = {
  'news-categorizer': { frameStyle: 'none', prompts: { NEWS_CATEGORIZER_SYSTEM_PROMPT }, schemas: { NewsCategorizerResponse: schemas.NewsCategorizerResponse } },
  'news-tagger': { frameStyle: 'none', prompts: { NEWS_TAGGER_SYSTEM_PROMPT }, schemas: { NewsTaggerResponse: schemas.NewsTaggerResponse } },
  'chain-grouper': { frameStyle: 'none', prompts: { CHAIN_GROUPER_SYSTEM_PROMPT }, schemas: { ChainGrouperResponse: schemas.ChainGrouperResponse } },
  'corpus-entity-summary': { frameStyle: 'none', prompts: { 'buildEntitySummaryPrompt()': buildEntitySummaryPrompt() }, schemas: { CorpusEntitySummaryResponse: schemas.CorpusEntitySummaryResponse } },
  'decomposer': { frameStyle: 'decomposer', prompts: { DECOMPOSER_SYSTEM_PROMPT }, schemas: { DecomposerResponse: schemas.DecomposerResponse }, garnishTerms: GARNISH_TERMS },
  'analyst-tier1': {
    frameStyle: 'analyst',
    prompts: { ANALYST_TIER1_SYSTEM_PROMPT },
    appendices: { CLAIMS_PROMPT_SECTION },
    schemas: { AnalystTier1Response: schemas.AnalystTier1Response, AnalystTier1WithClaimsResponse: schemas.AnalystTier1WithClaimsResponse },
    garnishTerms: GARNISH_TERMS,
  },
  'analyst-tier2': { frameStyle: 'analyst', prompts: { ANALYST_TIER2_SYSTEM_PROMPT }, schemas: { AnalystTier2Response: schemas.AnalystTier2Response }, garnishTerms: GARNISH_TERMS },
  'synthesizer': { frameStyle: 'synthesizer', prompts: { SYNTHESIZER_SYSTEM_PROMPT }, schemas: { SynthesizerResponse: schemas.SynthesizerResponse }, garnishTerms: GARNISH_TERMS },
  'editor': { frameStyle: 'none', prompts: { EDITOR_SYSTEM_PROMPT }, schemas: { EditorResponse: schemas.EditorResponse } },
  'viewpoints-debate': {
    frameStyle: 'none',
    prompts: { SUPPORT_PROMPT, RISK_PROMPT, NET_READ_PROMPT },
    schemas: { ViewpointsPointsResponse: schemas.ViewpointsPointsResponse, ViewpointsNetReadResponse: schemas.ViewpointsNetReadResponse },
  },
  'narrative-writer': {
    frameStyle: 'none',
    prompts: { NARRATIVE_WRITER_SYSTEM_PROMPT, NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT },
    appendices: { NARRATIVE_CLAIM_LEDGER_INSTRUCTION },
    schemas: { NarrativeWriterResponse: schemas.NarrativeWriterResponse },
  },
  'podcast-writer': {
    frameStyle: 'none',
    prompts: {},
    schemas: { PodcastWriterResponse: schemas.PodcastWriterResponse },
    garnishTerms: GARNISH_TERMS,
    note: 'podcast-writer 的 system prompt 尚未移植進 apps/pipeline，本段沒有 prompt。',
  },
  'brief-quality-judge': { frameStyle: 'none', prompts: { QUALITY_JUDGE_SYSTEM_PROMPT }, schemas: { QualityJudgeResponse } },
  'brief-continuity-judge': { frameStyle: 'none', prompts: { CONTINUITY_JUDGE_SYSTEM_PROMPT }, schemas: { ContinuityJudgeResponse } },
}

// fence 要比內容裡最長的連續反引號多一個，且至少五個（baguanomics 只認五個以上）。
function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length))
  return '`'.repeat(Math.max(5, longest + 1))
}

function textBlocks(entries: Record<string, string>): string[] {
  return Object.entries(entries).flatMap(([name, text]) => {
    const fence = fenceFor(text)
    return ['', `### \`${name}\``, '', `${fence}text`, text, fence]
  })
}

function bulletSection(heading: string, items: readonly string[]): string[] {
  return ['', heading, '', ...items.map(i => `- ${i}`)]
}

function renderSpec(agent: AgentName, spec: AgentSpec): string {
  const lines = [
    `# ${agent} 目標 prompt 規格`,
    '',
    '讀者：baguanomics 與調整 prompt 的開發者',
    '型別：參考',
    '',
    '本檔由 `apps/pipeline/src/prompts/prompt-specs.test.ts` 從程式常數產生，不要手改；格式與用途見 [目標 prompt 規格](../README.md)。',
    '',
    `- agent: \`${agent}\``,
    `- frame-style: \`${spec.frameStyle}\``,
    '',
    '## 現行 prompt',
    ...(spec.note ? ['', spec.note] : []),
    ...textBlocks(spec.prompts),
  ]
  if (spec.appendices) {
    lines.push('', '## 條件附加段', '', '下列段落只在特定條件接在上面的 prompt 之後。', ...textBlocks(spec.appendices))
  }
  lines.push('', '## 輸出 schema')
  for (const [name, schema] of Object.entries(spec.schemas)) {
    const json = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }), null, 2)
    lines.push('', `### \`${name}\``, '', '```json', json, '```')
  }
  lines.push('', '## 合規', ...bulletSection('### 禁用語', FORBIDDEN_PHRASES))
  if (spec.garnishTerms)
    lines.push(...bulletSection('### 抽象評價贅詞', spec.garnishTerms))
  return `${lines.join('\n')}\n`
}

const SPECS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/prompt-specs/agents')

describe('docs/prompt-specs 與程式常數一致', () => {
  it('每個 AGENT_NAMES 都有規格', () => {
    expect(Object.keys(SPECS).sort()).toEqual([...AGENT_NAMES].sort())
  })

  // baguanomics 會讀目錄裡全部 *.md；agent 改名後留下的舊檔要擋下。
  it('規格目錄沒有 AGENT_NAMES 以外的檔案', () => {
    expect(readdirSync(SPECS_DIR).sort()).toEqual(AGENT_NAMES.map(a => `${a}.md`).sort())
  })

  it.each(AGENT_NAMES)('%s', async (agent) => {
    await expect(renderSpec(agent, SPECS[agent])).toMatchFileSnapshot(resolve(SPECS_DIR, `${agent}.md`))
  })
})
