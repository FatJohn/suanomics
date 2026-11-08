import { MARKET_SNAPSHOT_SECTION_USER_TEXT } from '../prompts/market-snapshot-section.user-content.js'

/**
 * 讀者面三個 agent（narrative / synthesizer / podcast）共用的快照標題。
 *
 * 只抽字串、不抽整段：三處的組裝順序不同（narrative 是「標題→快照→空行」，另兩個是
 * 「空行→標題→快照」），收成一個 append 函式就得統一空行位置，而那是在改 prompt——
 * 收益只有省下兩份字面字串，不值得為它動已經在跑的 prompt。
 *
 * 與下面 analyst 用的標題**刻意不同**：analyst 的姿態從「僅供宏觀脈絡」升級為
 * 「主動解讀」，兩者是不同的指示，不是漂移。
 */
export const READER_SNAPSHOT_HEADING = MARKET_SNAPSHOT_SECTION_USER_TEXT.readerHeading

// tier1 / tier2 共用的市場數據快照注入段（兩個 tier 行為一致）。
// 姿態從「僅供宏觀脈絡」升級為「主動解讀」、要求 analyst 把快照序列與
// primaryImpact / cascadeChain 對照、引用方向與是否與新聞敘事矛盾。
export function appendMarketSnapshotSection(lines: string[], marketSnapshot: string | null | undefined): void {
  if (!marketSnapshot)
    return
  lines.push('')
  lines.push(MARKET_SNAPSHOT_SECTION_USER_TEXT.analystHeading)
  lines.push(MARKET_SNAPSHOT_SECTION_USER_TEXT.analystRule1)
  lines.push(MARKET_SNAPSHOT_SECTION_USER_TEXT.analystRule2)
  lines.push(MARKET_SNAPSHOT_SECTION_USER_TEXT.analystRule3)
  lines.push(MARKET_SNAPSHOT_SECTION_USER_TEXT.analystRule4)
  lines.push(marketSnapshot)
}
