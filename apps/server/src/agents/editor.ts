import type { ItemCategory } from '@suanomics/db/news-categories'
import type { Storyline } from '@suanomics/db/repos/storylines-repo'
import type { EditorParseResult } from './editor-output.js'
import type { LlmCallRecord } from './llm-wrapper.js'
import { ITEM_CATEGORY_LABEL } from '@suanomics/db/news-categories'
import { EDITOR_SYSTEM_PROMPT } from '../prompts/editor.prompt.js'
import { EDITOR_USER_TEXT } from '../prompts/editor.user-content.js'
import { parseEditorOutput } from './editor-output.js'
import { callAgentLLM } from './llm-wrapper.js'
import { clampString } from './narrative-shared.js'

const RESPONSE_GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    mainThemes: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
    dailyThesis: { type: 'string' },
    selectedNewsIds: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 8 },
    storylineTouches: { type: 'array', items: { type: 'object', properties: { storylineId: { type: 'integer' }, valence: { type: 'string', enum: ['support', 'challenge', 'extend'] }, note: { type: 'string' } }, required: ['storylineId', 'valence', 'note'] } },
    resolveStorylines: { type: 'array', maxItems: 2, items: { type: 'object', properties: { storylineId: { type: 'integer' }, disposition: { type: 'string', enum: ['confirmed', 'refuted'] }, note: { type: 'string' } }, required: ['storylineId', 'disposition', 'note'] } },
    newStorylines: { type: 'array', maxItems: 2, items: { type: 'object', properties: { title: { type: 'string' }, thesis: { type: 'string' }, entities: { type: 'array', items: { type: 'string' } } }, required: ['title', 'thesis', 'entities'] } },
  },
  required: ['mainThemes', 'dailyThesis', 'selectedNewsIds', 'storylineTouches', 'newStorylines'],
}

export interface EditorCandidate { id: number, title: string, excerpt: string, category: ItemCategory }
export interface CallEditorParams {
  candidates: EditorCandidate[]
  storylines: Storyline[]
  recentBriefs: { briefDate: string, headline: string, summary: string }[]
  marketSnapshot?: string | null
  calendarBlock?: string | null
  // 官方公告 block（央行／金管會／證交所的一手公告）。**背景素材、不是候選新聞**——
  // 它們不在 candidates 裡，editor 不能選它們當主題，只能用來判斷今天有沒有政策事件。
  officialBlock?: string | null
  onCallRecord?: (r: LlmCallRecord) => void
}

// 不對 LLM 輸出做全有全無的 parse：選稿層與 storyline 層各自成立、各自降級（見 editor-output.ts）。
export async function callEditor(p: CallEditorParams): Promise<EditorParseResult> {
  const raw = await callAgentLLM<unknown>({
    agentName: 'editor',
    systemPrompt: EDITOR_SYSTEM_PROMPT,
    userContent: formatUserContent(p),
    responseSchema: RESPONSE_GEMINI_SCHEMA,
    ...(p.onCallRecord !== undefined ? { onCallRecord: p.onCallRecord } : {}),
  })
  return parseEditorOutput(raw)
}

export function formatUserContent(p: CallEditorParams): string {
  const lines: string[] = []
  lines.push(EDITOR_USER_TEXT.candidatesHeading(p.candidates.length))
  for (const c of p.candidates) lines.push(`[${c.id}][${ITEM_CATEGORY_LABEL[c.category]}] ${clampString(c.title, 120)} — ${clampString(c.excerpt, 150)}`)
  lines.push('')
  lines.push(EDITOR_USER_TEXT.storylinesHeading(p.storylines.length))
  if (p.storylines.length === 0)
    lines.push(EDITOR_USER_TEXT.noStorylines)
  for (const s of p.storylines) {
    // ★ 不信任 updates 的寫入序（同 `storyline-block.ts:34`、`storylines-repo.ts` 的
    //   `getOpenStorylines`）：`upsertSameDay` 的排序只是紀律、不是保證（jsonb 沒有 DB 約束、
    //   直寫 updates 的程式都能重建亂序），亂序時直接 `slice(-3)` 會把舊進展當成「近期」
    //   印給 editor。ISO date 字典序＝時間序。
    const recent = [...s.updates].sort((a, b) => a.briefDate.localeCompare(b.briefDate)).slice(-3)
    const arc = recent.length > 0
      ? recent.map(u => `（${u.briefDate}/${u.valence}）${u.note}`).join('；')
      : EDITOR_USER_TEXT.noStorylineArc
    lines.push(EDITOR_USER_TEXT.storylineLine(s.id, s.title, s.thesis, arc))
  }
  lines.push('')
  lines.push(EDITOR_USER_TEXT.recentBriefsHeading)
  if (p.recentBriefs.length === 0)
    lines.push(EDITOR_USER_TEXT.noRecentBriefs)
  for (const b of p.recentBriefs) lines.push(`${b.briefDate}：${b.headline} — ${b.summary.slice(0, 150)}`)
  if (p.calendarBlock) {
    lines.push('')
    lines.push(EDITOR_USER_TEXT.calendarHeading)
    lines.push(p.calendarBlock)
  }
  if (p.marketSnapshot) {
    lines.push('')
    lines.push(EDITOR_USER_TEXT.marketSnapshotHeading)
    lines.push(p.marketSnapshot)
  }
  if (p.officialBlock) {
    lines.push('')
    lines.push(EDITOR_USER_TEXT.officialHeading)
    lines.push(EDITOR_USER_TEXT.officialNote)
    lines.push(p.officialBlock)
  }
  return lines.join('\n')
}
