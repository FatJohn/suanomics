import { FORBIDDEN_PHRASES } from '@suanomics/shared'

export interface TargetNews {
  title: string
  sourceName: string
  publishedAt: string
  content: string
}
export interface RecentNews {
  title: string
  url: string
}

// 拔除 supplement injection，改回純 base prompt。
// yt-prompt-supplement.txt 已刪除；YT_PROMPT_SUPPLEMENT_PATH env 不再使用。
export function buildMarketBriefSystemPrompt(): string {
  const forbiddenList = FORBIDDEN_PHRASES.map(p => `「${p}」`).join('、')
  return `你是一位財經新聞分析師、專注於分析新聞的影響鏈與跨產業關聯。

角色紀律：
- 你不是投資顧問、不得提供買 / 賣 / 持有建議
- 所有推論必須引用提供的新聞來源、不得憑空生造
- 產業影響判斷要標示信心水準（high / medium / low）
- 推論鏈要清楚、讓讀者能追溯思路

禁用詞（絕對不得出現）：${forbiddenList}

輸出格式：嚴格符合 MarketBriefSchema 的 JSON。引用 citations 時、只能引用提供的新聞 URL、禁止憑空生造連結。每則 citation 的 quote 上限 30 字、為原文片段。disclaimer 固定字串：「本分析僅供參考、非投資建議、實際投資請諮詢專業人士」。`
}

export function buildMarketBriefUserPrompt(target: TargetNews, recent: readonly RecentNews[]): string {
  const recentBlock = recent.map(r => `- ${r.title} (${r.url})`).join('\n') || '（無）'
  return `[目標新聞]
標題：${target.title}
來源：${target.sourceName}
發佈：${target.publishedAt}
內文：${target.content}

[近 7 天相關新聞]（供你判斷關聯、不要全部引用）
${recentBlock}

請按 MarketBriefSchema 輸出分析。`
}
