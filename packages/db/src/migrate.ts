import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url)
    throw new Error('DATABASE_URL not set')
  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))
  const client = postgres(url, { max: 1 })
  const db = drizzle(client)
  await migrate(db, { migrationsFolder })
  await client.end()
  console.warn('[db:migrate] done')
}

main().catch((err) => {
  console.error('[db:migrate] failed:', err)
  process.exit(1)
})
