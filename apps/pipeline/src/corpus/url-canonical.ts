import { createHash } from 'node:crypto'

const TRACKING_PARAM_PREFIXES = ['utm_']
const TRACKING_PARAMS_EXACT = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid'])

export function canonicalizeUrl(raw: string): string {
  const u = new URL(raw)
  u.hostname = u.hostname.toLowerCase()
  u.hash = ''
  const params = [...u.searchParams.entries()].filter(([k]) => {
    if (TRACKING_PARAMS_EXACT.has(k))
      return false
    return !TRACKING_PARAM_PREFIXES.some(p => k.startsWith(p))
  })
  params.sort(([a], [b]) => a.localeCompare(b))
  const qs = new URLSearchParams(params).toString()
  u.search = qs ? `?${qs}` : ''
  if (u.pathname.length > 1 && u.pathname.endsWith('/'))
    u.pathname = u.pathname.slice(0, -1)
  return `${u.protocol}//${u.host}${u.pathname}${u.search}`
}

export function hashCanonicalUrl(url: string): string {
  return createHash('sha256').update(canonicalizeUrl(url)).digest('hex')
}
