import { z } from 'zod'

// Editor 一次回兩組彼此獨立的資訊、故拆成兩個 contract：
// 選稿層決定「今天報什麼」、storyline 層決定「長期敘事線怎麼更新」。
// 綁在一起時任一欄位不合就整包 throw、選稿與 storyline 寫回會一起消失。
export const EditorSelectionSchema = z.object({
  mainThemes: z.array(z.string().min(1)).min(1).max(2),
  dailyThesis: z.string().min(10).max(150),
  selectedNewsIds: z.array(z.number().int()).min(1).max(8),
})
export type EditorSelection = z.infer<typeof EditorSelectionSchema>

const StorylineTouchSchema = z.object({
  storylineId: z.number().int(),
  valence: z.enum(['support', 'challenge', 'extend']),
  note: z.string().min(1).max(200),
})
const ResolveStorylineSchema = z.object({
  storylineId: z.number().int(),
  disposition: z.enum(['confirmed', 'refuted']),
  note: z.string().min(1).max(200),
})
const NewStorylineSchema = z.object({
  title: z.string().min(1).max(60),
  thesis: z.string().min(1).max(200),
  entities: z.array(z.string()).max(8).default([]),
})

export const EditorStorylineSchema = z.object({
  storylineTouches: z.array(StorylineTouchSchema).default([]),
  resolveStorylines: z.array(ResolveStorylineSchema).max(2).default([]),
  newStorylines: z.array(NewStorylineSchema).default([]),
})
export type EditorStorylineState = z.infer<typeof EditorStorylineSchema>

// 兩層合起來的形狀，供 editor.prompt.ts 以名字指涉（prompt 文字寫「shape 對齊 EditorOutputSchema」）。
// **不是執行期契約**：執行期走 parseEditorOutput，兩者容忍度刻意不同——例如 3 條 resolveStorylines
// 會被本 schema reject，parseEditorOutput 則截斷後接受。要知道實際行為請看 parseEditorOutput。
export const EditorOutputSchema = EditorSelectionSchema.extend(EditorStorylineSchema.shape)

export interface SanitizedSelection extends EditorSelection { ok: boolean }

export interface EditorParseResult {
  // null＝選稿層不可用、呼叫端要回退到自己的選稿；storyline 層永遠有值（最壞是三個空陣列）。
  selection: EditorSelection | null
  storyline: EditorStorylineState
  // **只**計逐筆 schema 檢查不合而丟掉的筆數。原本整包 throw 至少會留下 log、
  // 逐筆丟棄若不回報就變成靜默降級、LLM 開始系統性吐壞資料時看不出來。呼叫端負責 log。
  // 刻意不含超量截斷（設計內的正常行為）與 sanitize 的幻覺 id 過濾（在另一層、另有語意）——
  // 名字帶 schema 就是為了讓「schemaDropped=0」不被讀成「什麼都沒丟」。
  schemaDroppedEntries: number
}

// 契約上限統一在 parse 層施加：sanitize 只負責防幻覺與去重，不再是第二個截斷點。
const MAX_RESOLVE = 2
const MAX_NEW_STORYLINES = 2

// 陣列逐筆 parse：一筆不合只丟那一筆。
// 整層 z.array(...).parse() 會讓「61 字的新線標題」連帶丟掉同一層其他完全合法的項目。
function parseEachTolerant<T>(schema: z.ZodType<T>, value: unknown): { kept: T[], dropped: number } {
  if (!Array.isArray(value))
    return { kept: [], dropped: 0 }
  const kept: T[] = []
  let dropped = 0
  for (const item of value) {
    const r = schema.safeParse(item)
    if (r.success)
      kept.push(r.data)
    else
      dropped++
  }
  return { kept, dropped }
}

export function parseEditorOutput(raw: unknown): EditorParseResult {
  const selection = EditorSelectionSchema.safeParse(raw)
  const obj = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const touches = parseEachTolerant(StorylineTouchSchema, obj.storylineTouches)
  const resolves = parseEachTolerant(ResolveStorylineSchema, obj.resolveStorylines)
  const newLines = parseEachTolerant(NewStorylineSchema, obj.newStorylines)
  return {
    selection: selection.success ? selection.data : null,
    storyline: {
      storylineTouches: touches.kept,
      // 超量截斷而非整層拒收：LLM 多吐一條不該賠掉整層 storyline 狀態
      resolveStorylines: resolves.kept.slice(0, MAX_RESOLVE),
      newStorylines: newLines.kept.slice(0, MAX_NEW_STORYLINES),
    },
    schemaDroppedEntries: touches.dropped + resolves.dropped + newLines.dropped,
  }
}

// 防呆是程式責任、不信任 LLM 輸出的 id：
// LLM 可能幻覺出不存在的 news id、schema 只能驗型別管不了「這個 id 是否真的在候選集裡」、
// 故由本純函式對照 candidateIds 過濾掉幻覺項、並回報是否還剩足量選稿（ok）。
export function sanitizeSelection(sel: EditorSelection, candidateIds: number[]): SanitizedSelection {
  const cand = new Set(candidateIds)
  // 去重：LLM 可能重複吐同一個 news id（[1,1,2]）、若不去重會讓 ok 把同一篇算兩次、誤判選稿足量
  const selectedNewsIds = [...new Set(sel.selectedNewsIds.filter(id => cand.has(id)))]
  return { ...sel, selectedNewsIds, ok: selectedNewsIds.length >= 2 }
}

// 同樣防幻覺 storyline id。無 ok 概念：過濾後剩什麼就寫回什麼、
// 一條都不剩也只是當天沒有敘事線更新、不影響選稿。
export function sanitizeStoryline(st: EditorStorylineState, openStorylineIds: number[]): EditorStorylineState {
  const open = new Set(openStorylineIds)
  // 去重：LLM 對同一 storyline 可能吐兩筆 touch（如 extend 後又 support）、若不去重、
  // 下游 applyEditorResult 會疊兩筆 update、終態不確定。採 last-wins、touch 不再有終態、last-wins 只為每線一筆
  const seen = new Map<number, EditorStorylineState['storylineTouches'][number]>()
  for (const t of st.storylineTouches) {
    if (open.has(t.storylineId))
      seen.set(t.storylineId, t)
  }
  const seenResolve = new Map<number, EditorStorylineState['resolveStorylines'][number]>()
  for (const r of st.resolveStorylines) {
    if (open.has(r.storylineId))
      seenResolve.set(r.storylineId, r)
  }
  return {
    storylineTouches: [...seen.values()],
    resolveStorylines: [...seenResolve.values()],
    // 不再在此截斷：上限由 parseEditorOutput 施加，兩處各截一半會讓「上限在哪裡」無處可查。
    newStorylines: st.newStorylines,
  }
}
