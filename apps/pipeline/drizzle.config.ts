import type { Config } from 'drizzle-kit'
import process from 'node:process'

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
  },
  strict: true,
  verbose: true,
} satisfies Config
