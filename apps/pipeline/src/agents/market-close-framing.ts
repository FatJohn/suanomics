import { MARKET_CLOSE_FRAMING_USER_TEXT } from '../prompts/market-close-framing.user-content.js'
import { relativeDayLabel } from './relative-time.js'

// 台股最近收盤錨：用 taiex-close 真實資料日對比報告日 D 算今/昨、餵 agent。
// 美股等境外市場不放此表（其新聞於盤後當下發布、publishedAt 已可靠）、
// 由 prompt 規則指向各新聞的「發布時間」標籤。
// 無法算台股錨（無資料 / 日期晚於 D）→ 回 ''、agent 退回 publishedAt 現狀、不破。
export function buildMarketCloseFraming(
  taiexCloseDate: string | null,
  briefDate: string,
): string {
  if (!taiexCloseDate)
    return ''
  const label = relativeDayLabel(taiexCloseDate, briefDate)
  if (!label)
    return ''
  // taiex-close 日期為 TWSE 交易日（date-only）、直接取月/日顯示。
  const [, mm, dd] = taiexCloseDate.split('-')
  const md = mm && dd ? `${Number(mm)}/${Number(dd)}` : taiexCloseDate
  return [
    MARKET_CLOSE_FRAMING_USER_TEXT.heading,
    MARKET_CLOSE_FRAMING_USER_TEXT.taiexCloseLine(label, md),
    MARKET_CLOSE_FRAMING_USER_TEXT.otherMarketsNote,
  ].join('\n')
}
