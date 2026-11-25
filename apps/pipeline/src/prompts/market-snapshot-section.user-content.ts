// market-snapshot-section.ts 的 user content 文字：市場數據快照段落的標題與規則句，
// 讀者面 agent（narrative／synthesizer／podcast）與 analyst tier1／tier2 共用同一支
// runner、但姿態不同，故分成 reader／analyst 兩組，放在同一個常數裡。
export const MARKET_SNAPSHOT_SECTION_USER_TEXT = {
  readerHeading: '# 市場數據參考（僅供宏觀脈絡；引用數字時照抄、不得推算未提供的數字）',
  analystHeading: '# 市場數據快照（主動解讀、不只當背景）',
  analystRule1: '- 對 primaryImpact 與每條 cascadeChain、檢查快照中是否有相關序列；有則引用並解讀：方向（加速 / 放緩 / 轉向）、以及與新聞敘事一致或矛盾',
  analystRule2: '- 數字與變化幅度照抄快照提供的值、不得自行推算未提供的數字',
  analystRule3: '- 數據與新聞論點矛盾時、明確點出（例：新聞稱需求強勁、但相關序列連三月放緩）',
  analystRule4: '- 無相關序列的主軸不要硬引用、不要為引用而引用',
}
