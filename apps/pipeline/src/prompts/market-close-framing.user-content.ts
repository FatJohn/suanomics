// market-close-framing.ts 的 user content 文字：台股最近收盤時間框架 block，
// 附進 analyst-tier1 的 user content、讓模型判斷「今日／昨日」該對應哪個收盤。
export const MARKET_CLOSE_FRAMING_USER_TEXT = {
  heading: '# 市場收盤時間框架（描述行情漲跌/收盤的今日或昨日、以此為準）',
  taiexCloseLine: (label: string, dataDateMd: string) => `- 台股（加權指數）最近收盤：${label}（資料日 ${dataDateMd}）`,
  // #113 G1：資料日早於前一交易日時加註，讓模型不把較早的行情寫成最新行情。
  previousCloseMissingLine: (previousTradingDayMd: string, dataDateMd: string) =>
    `- 注意：前一交易日（${previousTradingDayMd}）的台股收盤缺資料。${dataDateMd} 的加權指數不是最新行情：引用時寫明資料日 ${dataDateMd}，不得寫成前一交易日或最新收盤、不得放進標題或摘要開頭；也不要自行補寫 ${previousTradingDayMd} 的漲跌。`,
  otherMarketsNote: '- 其他市場（美股、原物料等）：依各則新聞標注的「發布時間」判斷；境外市場新聞多於盤後當下發布、標籤可靠。',
}
