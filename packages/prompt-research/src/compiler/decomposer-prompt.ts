import type { MergedDraft } from '../types.js'

import { collectFramesFromDraft } from './collect.js'

export interface BuildAgentPromptParams {
  draft: MergedDraft
  sharedPreamble: string
}

export function buildDecomposerPrompt(p: BuildAgentPromptParams): string {
  const frames = collectFramesFromDraft(p.draft)
  const lines: string[] = []
  lines.push(p.sharedPreamble)
  lines.push('')
  lines.push('## 你的角色：Decomposer')
  lines.push('')
  lines.push('收到單則財經新聞、職責：')
  lines.push('1. 識別 primaryEntity（公司 / 中央銀行 / 國家）')
  lines.push('2. 列 topicTags（最多 5）')
  lines.push('3. 提出 0–6 條 cascadeHypotheses (industry / mechanism / retrieveQuery)')
  lines.push('   - industry 寫 sector 層級、不寫公司名 / ticker')
  lines.push('')
  lines.push('## 跨域 hypothesis 規則（強制）')
  lines.push('')
  lines.push('**對任何產業 / 公司新聞、cascadeHypotheses 中至少列 1 條跨域連動**（geopolitical / policy / regulatory）、即使該新聞表面看起來純產業。常見跨域維度：')
  lines.push('- 兩岸 / 台海 / 供應鏈韌性')
  lines.push('- CHIPS Act / 友岸外包（friend-shoring）/ 對中出口管制')
  lines.push('- 川普關稅 / 美中貿易戰 / 美中科技戰')
  lines.push('- 紅海航運 / 烏俄戰爭 / 以哈衝突 / 中東')
  lines.push('- OPEC / 油價 / 能源轉型')
  lines.push('- 央行政策（Fed / ECB / 台灣央行）')
  lines.push('- 監管框架對標（SEC / FSA / MAS / 香港證監會 / EU MiCA / 全球資產治理趨勢）')
  lines.push('')
  lines.push('hypothesis 上限維持 6、若包含跨域 + 產業內傳導、自我排序「最相關前 6」。retrieveQuery.entities 內優先使用上述 alias group 主 form（例：寫 `CHIPS Act` 不是 `美國晶片法案`、寫 `兩岸` 不是 `台海關係`）以利 retriever GIN 字面比對命中。')
  lines.push('')
  lines.push('**範例**：當新聞屬「政策 / 監管 / 法規」性質（例：央行升降息、監理新法、產業政策）、cascadeHypotheses 中**至少**列 1 條「同類議題的海外或跨國對比」hypothesis（例：台灣虛擬資產法 → 對應 SEC / EU MiCA / 香港 SFC、retrieveQuery.entities 含 `SEC` / `MAS` / `MiCA` 等海外監管 entity）、好讓 retriever 拉到智庫 / 海外政策分析做跨域對照。')
  lines.push('')

  if (frames.length > 0) {
    lines.push('## 分析框架')
    for (const f of frames) {
      lines.push('')
      lines.push(`### [from: ${f.sourceSlug}] ${f.name}`)
      lines.push(`**whenToApply**: ${f.whenToApply}`)
      lines.push(`description: ${f.description}`)
      if (f.questions.length > 0) {
        lines.push(`questions:`)
        for (const q of f.questions) lines.push(`  - ${q}`)
      }
    }
    lines.push('')
  }

  lines.push('輸出 JSON、shape 對齊 DecomposerOutputSchema。')
  return lines.join('\n')
}
