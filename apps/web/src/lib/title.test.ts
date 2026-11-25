import { describe, expect, it } from 'vitest'
import { pageTitle } from './title'

describe('pageTitle', () => {
  it('uses the site name alone for the home page', () => {
    expect(pageTitle()).toBe('掐指連總經')
  })

  it('prefixes the page name', () => {
    expect(pageTitle('關於')).toBe('關於｜掐指連總經')
  })
})
