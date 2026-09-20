import type { BuildAgentPromptParams } from './decomposer-prompt.js'
import { collectFramesFromDraft } from './collect.js'

export function buildSynthesizerPrompt(p: BuildAgentPromptParams): string {
  const frames = collectFramesFromDraft(p.draft)
  // 路徑 B：curation 閘下架後、redFlags 全量直通；「只進 synthesizer」由「只有此 builder 渲染 redFlags」天然保證。
  const redFlags = p.draft.redFlags.map(r => ({ sourceSlug: r.sourceSlug, rule: r.entry.rule }))

  const lines: string[] = []
  lines.push(p.sharedPreamble)
  lines.push('')
  lines.push('## 你的角色：Synthesizer')
  lines.push('')
  lines.push('你是合規最後一道 gate、也是讀者實際讀到的最終輸出。')
  lines.push('')
  lines.push('收到 5–8 篇 Analyst 各自的 cascadeChain 分析、職責：')
  lines.push('1. 找跨篇共同 cascade')
  lines.push('2. 寫 narrative（連貫敘事、~1500 字）')
  lines.push('3. 列 highlights（3–5 條、每條一句、含 citation）')
  lines.push('4. disclaimer 固定字串')
  lines.push('')
  lines.push('## 合規鐵線（L3、不可違反）')
  lines.push('1. 個股 ticker / 股票名 + 任何方向性語意（屬交易指令類的買賣動作或多空動作）的組合 — 絕對不得出現')
  lines.push('2. 投信投顧法 44 條禁用詞（軟推薦 / 確定性語句 / 直接交易指令）— 絕對不得出現')
  lines.push('3. sector / 產業層級的方向性 OK')
  lines.push('4. 自我違反任何一條 → 重寫整段、不要修補')
  lines.push('5. 後置 L3 gate (packages/shared/compliance.ts) 是 single source of truth、若 gate 命中、整個 brief 會被 retry。請以中性財經分析語言敘述、避免任何具方向性的買賣判斷。')
  lines.push('')
  if (redFlags.length > 0) {
    lines.push('## Red Flags')
    for (const r of redFlags) lines.push(`- [from: ${r.sourceSlug}] ${r.rule}`)
    lines.push('')
  }
  if (frames.length > 0) {
    lines.push('## Synthesizer 框架')
    for (const f of frames) {
      lines.push('')
      lines.push(`### [from: ${f.sourceSlug}] ${f.name}`)
      lines.push(`description: ${f.description}`)
    }
    lines.push('')
  }
  lines.push('## 合規最後檢查（你寫完後、自己再 review 一次）')
  lines.push('- [ ] 沒有個股 + 方向性動詞組合')
  lines.push('- [ ] 沒有 44 條投信投顧禁用詞')
  lines.push('- [ ] sector 層級方向性 OK、個股層級方向性 NOT OK')
  lines.push('- [ ] 每條 highlight 有 citation')
  lines.push('')
  lines.push('輸出 JSON、shape 對齊 MarketBriefSchema（@suanomics/shared）。')
  return lines.join('\n')
}
