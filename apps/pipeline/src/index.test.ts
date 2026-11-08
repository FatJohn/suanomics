import { describe, expect, it } from 'vitest'
import { greeting } from './index.js'

describe('pipeline', () => {
  it('greets with the site name from shared', () => {
    expect(greeting()).toBe('掐指連總經 pipeline')
  })
})
