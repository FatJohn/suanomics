import { describe, expect, it } from 'vitest'
import { SITE_NAME } from './index.js'

describe('shared', () => {
  it('exports the site name', () => {
    expect(SITE_NAME).toBe('掐指連總經')
  })
})
