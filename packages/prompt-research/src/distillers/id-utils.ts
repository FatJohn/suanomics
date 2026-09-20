import { createHash } from 'node:crypto'

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function sha1Short(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 8)
}

export function hashFrameId(name: string, whenToApply: string): string {
  return sha1Short(`${normalize(name)}::${normalize(whenToApply)}`)
}

export function hashVocabId(preferred: string): string {
  return sha1Short(normalize(preferred))
}

export function hashRedFlagId(rule: string): string {
  return sha1Short(normalize(rule))
}
