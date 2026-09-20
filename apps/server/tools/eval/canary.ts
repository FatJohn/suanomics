import type { MarketBrief } from '@suanomics/shared'

// content-ablation：回傳移除 dailyThesis 與 viewpoints、其餘完全相同的新 brief。
// 用途：brief:quality 對打 full vs ablated、量這兩個新區塊對 judge 判定的貢獻（canary 種子）。
// 以 rest 解構丟棄兩欄、不 mutate 輸入；其餘欄位淺拷貝即可（下游只讀）。
export function ablateBrief(brief: MarketBrief): MarketBrief {
  const { dailyThesis: _thesis, viewpoints: _viewpoints, ...rest } = brief
  return rest
}
