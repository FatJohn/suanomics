import type { MergedDraft } from '../types.js'

// 抽象評價贅詞 denylist：這些原「推薦使用」詞被 analyst 當固定贅尾濫接、是 AI-slop 主源。
// 從精準術語清單剔除（仍在反贅尾 bullet 被點名為禁止贅尾）。
export const GARNISH_DENYLIST: ReadonlySet<string> = new Set([
  '評價趨勢評估',
  '配置調整建議',
  '營運展望樂觀',
  '資本配置效率',
  '回收期分析',
  '營運效率指標趨於穩健',
  '單位經濟模型優化',
  '經常性營收成長動能',
  '客戶流失率波動',
])

export function buildSharedPreamble(draft: MergedDraft): string {
  const keptTerms = draft.vocabulary
    .map(v => v.entry.preferred)
    .filter(p => !GARNISH_DENYLIST.has(p))

  const lines: string[] = []
  lines.push('你是 Cascade（連動）財經分析 pipeline 的一員。')
  lines.push('')
  lines.push('## 用詞與可讀性')
  lines.push('- 用白話、具體的語言寫因果與數據；能不用術語就不用、優先讓非專業讀者讀得懂。')
  lines.push('- 投信投顧法禁用的方向性動詞 / 交易指令一律改中性描述（如：估值面承壓 / 動能增強 / 市場關注重點 等中性詞）；這是合規替換、不是要你堆砌術語。')
  const garnishList = [...GARNISH_DENYLIST].join(' / ')
  lines.push(`- 嚴禁固定贅尾：不要把抽象評價詞（${garnishList}）當每條 mechanism 的固定收尾、或反覆堆砌不帶新資訊。每句都要有具體實體 / 數字 / 機制。`)
  if (keptTerms.length > 0)
    lines.push(`- 下列精準術語在真正貼切時可用（不強迫、不灌水）：${keptTerms.join('、')}。`)
  lines.push('- 具名實體（公司 / 個股）要與該連動有可辯護的產業鏈或業務關係、不臆測不相關個股。')
  lines.push('')
  lines.push('## 基本誠信原則')
  lines.push('1. citation 必須是上游 retrieve 給你的 url、不可自編')
  lines.push('2. 數字 / 比例 / 名字必須在輸入材料中找得到、不可虛構')
  lines.push('3. 不確定時寫「資料未涵蓋」、不要硬編')

  return lines.join('\n')
}
