import { describe, expect, it } from 'vitest'
import { distillCustomToDigest } from './custom-to-digest.js'

describe('distillCustomToDigest', () => {
  it('is exported (implementation validated E2E)', () => {
    expect(typeof distillCustomToDigest).toBe('function')
  })
})
