import type { Config } from 'drizzle-kit'
import process from 'node:process'

// 只讀 DATABASE_URL，不設預設值：沒設時 generate 照樣可用（不連線），
// 需要連線的指令會因為缺 dbCredentials 直接報錯，不會默默連到別的資料庫。
const url = process.env.DATABASE_URL

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  ...(url ? { dbCredentials: { url } } : {}),
  strict: true,
  verbose: true,
} satisfies Config
