import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load apps/server/.env so the real-DB test (audit.db.test.ts) can reach dev Postgres.
// Same source-of-truth as packages/db/vitest.config.ts. Without this the test only passes
// when DATABASE_URL is exported in the shell (as CI does), not after following Quick Start.
const envPath = path.resolve(__dirname, '../../apps/server/.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const eq = trimmed.indexOf('=')
    if (eq < 0)
      continue
    const key = trimmed.slice(0, eq)
    let val = trimmed.slice(eq + 1)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\'')))
      val = val.slice(1, -1)
    if (process.env[key] === undefined)
      process.env[key] = val
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
