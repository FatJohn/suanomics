import { clampString, stripControlChars } from './narrative-shared.js'

// Pre-validate normalize: clamp body lengths, filter unknown citation urls,
// inject briefDate / persona / generatedAt if Gemini omits them.
// 原 72 行單函式拆成 section-level helpers（< 50 行紀律）、行為等價。

function normalizeHook(hook: unknown): unknown {
  if (!hook || typeof hook !== 'object')
    return hook
  const h = { ...(hook as Record<string, unknown>) }
  if (typeof h.body === 'string')
    h.body = clampString(stripControlChars(h.body), 400)
  if (typeof h.headline === 'string')
    h.headline = clampString(stripControlChars(h.headline), 80)
  return h
}

function normalizeAct(a: unknown, allowed: ReadonlySet<string>, fallbackUrl: string | undefined): unknown {
  if (!a || typeof a !== 'object')
    return a
  const node = { ...(a as Record<string, unknown>) }
  if (typeof node.body === 'string')
    node.body = clampString(stripControlChars(node.body), 800)
  if (typeof node.actTitle === 'string')
    node.actTitle = clampString(stripControlChars(node.actTitle), 40)
  if (Array.isArray(node.citationUrls)) {
    const filtered = (node.citationUrls as unknown[]).filter(
      u => typeof u === 'string' && allowed.has(u),
    )
    const deduped = Array.from(new Set(filtered)).slice(0, 6)
    node.citationUrls = deduped.length > 0
      ? deduped
      : (fallbackUrl !== undefined ? [fallbackUrl] : [])
  }
  if (Array.isArray(node.relatedNewsIds))
    node.relatedNewsIds = (node.relatedNewsIds as unknown[]).slice(0, 4)
  return node
}

function normalizeTakeaway(takeaway: unknown): unknown {
  if (!takeaway || typeof takeaway !== 'object')
    return takeaway
  const t = { ...(takeaway as Record<string, unknown>) }
  if (typeof t.body === 'string')
    t.body = clampString(stripControlChars(t.body), 400)
  return t
}

function normalizeMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object')
    return { totalChars: 0, persona: 'panpan', generatedAt: new Date().toISOString() }
  const m = { ...(meta as Record<string, unknown>) }
  if (m.persona !== 'panpan')
    m.persona = 'panpan'
  if (typeof m.generatedAt !== 'string')
    m.generatedAt = new Date().toISOString()
  if (typeof m.totalChars !== 'number')
    m.totalChars = 2000
  return m
}

export function preNormalizePodcastRaw(
  raw: unknown,
  allowedUrls: readonly string[],
  briefDate: string,
): unknown {
  if (!raw || typeof raw !== 'object')
    return raw
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  const allowed = new Set(allowedUrls)
  const fallbackUrl = allowedUrls[0]

  if (!out.briefDate)
    out.briefDate = briefDate
  if (out.hook)
    out.hook = normalizeHook(out.hook)
  if (Array.isArray(out.acts))
    out.acts = out.acts.slice(0, 5).map(a => normalizeAct(a, allowed, fallbackUrl))
  if (out.takeaway)
    out.takeaway = normalizeTakeaway(out.takeaway)
  out.meta = normalizeMeta(out.meta)

  return out
}
