import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface CustomTextConfig { filePath: string }
export interface CustomTextResult { content: string, localPath: string }

export function readCustomText(config: CustomTextConfig): CustomTextResult {
  const abs = resolve(config.filePath)
  const content = readFileSync(abs, 'utf8')
  return { content, localPath: abs }
}
