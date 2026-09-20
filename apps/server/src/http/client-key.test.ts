import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { clientKeyOf } from './client-key.js'

function appExposingClientKey(env: NodeJS.ProcessEnv) {
  const app = new Hono()
  app.get('/', c => c.text(clientKeyOf(c, env)))
  return app
}

describe('clientKeyOf', () => {
  it('uses the rightmost X-Forwarded-For segment when TRUST_PROXY is true', async () => {
    const app = appExposingClientKey({ TRUST_PROXY: 'true' })
    const res = await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' } })
    expect(await res.text()).toBe('3.3.3.3')
  })

  it('trims whitespace around the rightmost segment', async () => {
    const app = appExposingClientKey({ TRUST_PROXY: 'true' })
    const res = await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1,   2.2.2.2   ' } })
    expect(await res.text()).toBe('2.2.2.2')
  })

  it('ignores X-Forwarded-For when TRUST_PROXY is not set (falls back to conninfo)', async () => {
    const app = appExposingClientKey({})
    const res = await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } })
    // app.request() 沒有走真實 socket，getConnInfo 會丟出、接住後退化成 'unknown'
    expect(await res.text()).toBe('unknown')
  })

  it('falls back to conninfo when TRUST_PROXY is true but there is no X-Forwarded-For header', async () => {
    const app = appExposingClientKey({ TRUST_PROXY: 'true' })
    const res = await app.request('/')
    expect(await res.text()).toBe('unknown')
  })

  it('falls back to unknown when there is no real socket (e.g. under test)', async () => {
    const app = appExposingClientKey({})
    const res = await app.request('/')
    expect(await res.text()).toBe('unknown')
  })
})
