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
  // 帳本寫入可能晚於 closeDb（Promise.all 提早返回時還有呼叫在飛）而重開連線；閒置自動關閉，process 才退得掉。
  _client = postgres(url, { max: 5, idle_timeout: 5 })
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
