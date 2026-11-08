import fs from 'node:fs'
import process from 'node:process'
import { defineConfig } from 'vitest/config'

// 本機的 DATABASE_URL 依 docs/operations/local-dev.md 放在 apps/pipeline/.env；已在環境裡的變數優先。
const pipelineEnv = new URL('../pipeline/.env', import.meta.url)
if (fs.existsSync(pipelineEnv))
  process.loadEnvFile(pipelineEnv)

export default defineConfig({})
