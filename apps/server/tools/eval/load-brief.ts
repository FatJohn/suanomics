import type { MarketBrief } from '@suanomics/shared'
import { readFileSync } from 'node:fs'
import { exit } from 'node:process'
import { MarketBriefSchema } from '@suanomics/shared'

// 容忍兩種檔：直接 MarketBrief、或 daily_briefs row 的 { briefJson }。parse 失敗即 exit(1)。
export function loadBrief(path: string): MarketBrief {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  const candidate = (raw && typeof raw === 'object' && 'briefJson' in raw) ? (raw as { briefJson: unknown }).briefJson : raw
  const parsed = MarketBriefSchema.safeParse(candidate)
  if (!parsed.success) {
    console.error(`${path} 不符 MarketBriefSchema：`)
    console.error(parsed.error.message)
    exit(1)
  }
  return parsed.data
}
