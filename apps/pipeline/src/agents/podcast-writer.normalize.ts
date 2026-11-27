import { truncateAtSentence } from './_truncate.js'
import { clampString, rewriteText, stripControlChars } from './narrative-shared.js'

// parse 前的整理：改寫禁用語、截斷過長內文、濾掉不在 brief 引用裡的網址，
// 補 briefDate，meta（字數、persona、generatedAt）一律由程式填。
// 改寫要在截斷之前：改寫後的詞可能比原詞長，先截再改會超過 schema 上限（#132）。
// 原 72 行單函式拆成 section-level helpers（< 50 行紀律）、行為等價。

interface Counter { count: number }

function clean(s: string, counter: Counter): string {
  return rewriteText(stripControlChars(s), counter)
}

function normalizeHook(hook: unknown, counter: Counter): unknown {
  if (!hook || typeof hook !== 'object')
    return hook
  const h = { ...(hook as Record<string, unknown>) }
  if (typeof h.body === 'string')
    h.body = truncateAtSentence(clean(h.body, counter), 400, 150)
  if (typeof h.headline === 'string')
    h.headline = clampString(clean(h.headline, counter), 80)
  return h
}

function normalizeAct(a: unknown, allowed: ReadonlySet<string>, counter: Counter): unknown {
  if (!a || typeof a !== 'object')
    return a
  const node = { ...(a as Record<string, unknown>) }
  if (typeof node.body === 'string')
    node.body = truncateAtSentence(clean(node.body, counter), 800, 300)
  if (typeof node.actTitle === 'string')
    node.actTitle = clampString(clean(node.actTitle, counter), 40)
  if (Array.isArray(node.citationUrls)) {
    const filtered = (node.citationUrls as unknown[]).filter(
      u => typeof u === 'string' && allowed.has(u),
    )
    node.citationUrls = Array.from(new Set(filtered)).slice(0, 6)
  }
  if (Array.isArray(node.relatedNewsIds))
    node.relatedNewsIds = (node.relatedNewsIds as unknown[]).slice(0, 4)
  return node
}

// 引用全被濾掉的段落沒有出處，整段丟掉；剩不到 3 段由 schema 擋下重試。
function hasCitation(a: unknown): boolean {
  const urls = (a as { citationUrls?: unknown } | null)?.citationUrls
  return !Array.isArray(urls) || urls.length > 0
}

function normalizeTakeaway(takeaway: unknown, counter: Counter): unknown {
  if (!takeaway || typeof takeaway !== 'object')
    return takeaway
  const t = { ...(takeaway as Record<string, unknown>) }
  if (typeof t.body === 'string')
    t.body = truncateAtSentence(clean(t.body, counter), 400, 150)
  return t
}

function bodyLength(node: unknown): number {
  const body = (node as { body?: unknown } | null)?.body
  return typeof body === 'string' ? body.length : 0
}

// totalChars 與 generatedAt 一律由程式填：模型自報的字數不可信，schema 的 1800–2800 要檢查實際值。
function buildMeta(out: Record<string, unknown>): Record<string, unknown> {
  const acts = Array.isArray(out.acts) ? out.acts : []
  const totalChars = bodyLength(out.hook) + acts.reduce((sum: number, a) => sum + bodyLength(a), 0) + bodyLength(out.takeaway)
  return { totalChars, persona: 'panpan', generatedAt: new Date().toISOString() }
}

export function preNormalizePodcastRaw(
  raw: unknown,
  allowedUrls: readonly string[],
  briefDate: string,
  counter: Counter = { count: 0 },
): unknown {
  if (!raw || typeof raw !== 'object')
    return raw
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  const allowed = new Set(allowedUrls)

  if (!out.briefDate)
    out.briefDate = briefDate
  if (out.hook)
    out.hook = normalizeHook(out.hook, counter)
  if (Array.isArray(out.acts))
    out.acts = out.acts.slice(0, 5).map(a => normalizeAct(a, allowed, counter)).filter(hasCitation)
  if (out.takeaway)
    out.takeaway = normalizeTakeaway(out.takeaway, counter)
  out.meta = buildMeta(out)

  return out
}
