import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let _client: ReturnType<typeof postgres> | null = null

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db)
    return _db
  const url = process.env.DATABASE_URL
  if (!url)
    throw new Error('DATABASE_URL not set')
  _client = postgres(url, { max: 5 })
  _db = drizzle(_client, { schema })
  return _db
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end()
    _client = null
    _db = null
  }
}
