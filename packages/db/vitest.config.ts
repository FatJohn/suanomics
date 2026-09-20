import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load apps/server/.env so DB integration tests in packages/db can reach dev Postgres.
// Unit tests (fake-DB, no network) are unaffected.
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

export default defineConfig({})
