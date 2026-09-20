// Tolerate common Gemini JSON drift: fenced output, prose before/after JSON,
// and concatenated content. Parse only the first balanced JSON object/array.
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()

  const startIdx = firstOpenIdx(fenced)
  if (startIdx === -1)
    return JSON.parse(fenced)

  const endIdx = findBalancedClose(fenced, startIdx)
  if (endIdx === -1)
    return JSON.parse(fenced.slice(startIdx))

  return JSON.parse(fenced.slice(startIdx, endIdx + 1))
}

function firstOpenIdx(text: string): number {
  const objectIdx = text.indexOf('{')
  const arrayIdx = text.indexOf('[')
  if (objectIdx === -1)
    return arrayIdx
  if (arrayIdx === -1)
    return objectIdx
  return Math.min(objectIdx, arrayIdx)
}

function findBalancedClose(text: string, start: number): number {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (char === '\\') {
      escape = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString)
      continue
    if (char === open) {
      depth++
    }
    else if (char === close) {
      depth--
      if (depth === 0)
        return i
    }
  }

  return -1
}
