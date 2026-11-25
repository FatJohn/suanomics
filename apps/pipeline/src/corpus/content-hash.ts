import { createHash } from 'node:crypto'

export function hashArticleContent(text: string | null | undefined): string | null {
  if (!text)
    return null
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized)
    return null
  return createHash('sha256').update(normalized).digest('hex')
}
