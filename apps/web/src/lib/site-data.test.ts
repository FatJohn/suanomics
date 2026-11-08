import { describe, expect, it } from 'vitest'
import { resolveDatabaseUrl } from './site-data'

describe('resolveDatabaseUrl', () => {
  it('有設定就回傳', () => {
    expect(resolveDatabaseUrl({ WEB_DATABASE_URL: 'postgres://x', WEB_REQUIRE_DATABASE: '1' })).toBe('postgres://x')
  })

  it('一般 build 沒設定時回 null，讓 fresh clone 與 CI 能 build', () => {
    expect(resolveDatabaseUrl({})).toBeNull()
  })

  it('部署用的 build 沒設定（或 secret 為空字串）時丟錯，不產出空站蓋掉線上', () => {
    expect(() => resolveDatabaseUrl({ WEB_REQUIRE_DATABASE: '1' })).toThrow('WEB_DATABASE_URL')
    expect(() => resolveDatabaseUrl({ WEB_REQUIRE_DATABASE: '1', WEB_DATABASE_URL: '' })).toThrow('WEB_DATABASE_URL')
  })
})
