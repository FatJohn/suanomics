import { describe, expect, it } from 'vitest'
import { hashJobPayload } from './payload-hash.js'

describe('hashJobPayload', () => {
  it('returns SHA256 hex', () => {
    expect(hashJobPayload({ foo: 'bar' })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('same content different key order → same hash', () => {
    expect(hashJobPayload({ a: 1, b: 2 })).toBe(hashJobPayload({ b: 2, a: 1 }))
  })

  it('nested objects hashed deterministically', () => {
    expect(hashJobPayload({ a: { b: 1, c: 2 } })).toBe(hashJobPayload({ a: { c: 2, b: 1 } }))
  })

  it('arrays preserve order (semantic difference)', () => {
    expect(hashJobPayload({ a: [1, 2] })).not.toBe(hashJobPayload({ a: [2, 1] }))
  })

  it('undefined values excluded; null preserved', () => {
    expect(hashJobPayload({ a: 1, b: undefined })).toBe(hashJobPayload({ a: 1 }))
    expect(hashJobPayload({ a: 1, b: null })).not.toBe(hashJobPayload({ a: 1 }))
  })

  it('handles empty object', () => {
    expect(hashJobPayload({})).toMatch(/^[0-9a-f]{64}$/)
  })
})
