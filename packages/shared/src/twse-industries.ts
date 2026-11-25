// 證交所上市股票的產業別，取自證交所 ISIN 查詢頁（isin.twse.com.tw C_public.jsp?strMode=2）「股票」區塊的產業別欄，
// 2026-11-25 抓取。證交所調整產業別（例如 2023 年新增綠能環保等四類）時要同步更新。
export const TWSE_LISTED_INDUSTRIES = [
  '水泥工業',
  '食品工業',
  '塑膠工業',
  '紡織纖維',
  '電機機械',
  '電器電纜',
  '化學工業',
  '生技醫療業',
  '玻璃陶瓷',
  '造紙工業',
  '鋼鐵工業',
  '橡膠工業',
  '汽車工業',
  '半導體業',
  '電腦及週邊設備業',
  '光電業',
  '通信網路業',
  '電子零組件業',
  '電子通路業',
  '資訊服務業',
  '其他電子業',
  '建材營造業',
  '航運業',
  '觀光餐旅',
  '金融保險業',
  '貿易百貨業',
  '油電燃氣業',
  '綠能環保',
  '數位雲端',
  '運動休閒',
  '居家生活',
  '其他業',
] as const

export type TwseListedIndustry = typeof TWSE_LISTED_INDUSTRIES[number]

const LISTED = new Set<string>(TWSE_LISTED_INDUSTRIES)

export function isTwseListedIndustry(name: string): name is TwseListedIndustry {
  return LISTED.has(name)
}
