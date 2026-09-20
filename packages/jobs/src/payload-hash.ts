import { createHash } from 'node:crypto'

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object')
    return value
  if (Array.isArray(value))
    return value.map(canonicalize)
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, canonicalize(v)] as const)
  return Object.fromEntries(entries)
}

export function hashJobPayload(payload: unknown): string {
  const canonical = JSON.stringify(canonicalize(payload))
  return createHash('sha256').update(canonical).digest('hex')
}
