// 實體名稱正規化：重疊率可不可信全看這裡。
//
// 放寬一點、兩臂看起來就更像；收緊一點、就會憑空長出分歧。
// 所以規則有兩層、且第二層必須是**明列**的：
//   strict  只做「同一個字串的不同寫法」收斂，不做語意判斷
//   lenient strict 之後再套一張明列的中英 / 俗名對照表（ALIAS_GROUPS）
// 兩層都要報，讀的人才知道「差異是真的不同實體、還是只是寫法」。
// 改動這裡一定會動到所有既有比對結果，請連同 normalize.test.ts 一起改。

// 成對括號（半形 / 全形 / 方括號 / 黑括號）。未成對時不匹配，免得把後半截名字吞掉。
const BRACKETED = /[（(【[][^）)】\]]*[）)】\]]/g
// 空白與常見中英標點：中英文分詞差異不該算成分歧。
const NOISE = /[\s·・、,，.。:：;；!！?？\-–—_/／\\&'"“”‘’「」『』]/g

export function normStrict(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().replace(BRACKETED, '').replace(NOISE, '').trim()
}

/**
 * canonical → 別名。只收「同一個指涉物的不同語言或俗名」，
 * **不收上下位詞**（晶片 vs 半導體不折、否則會把真正的抽取差異洗掉）。
 * 別名在載入時先過 normStrict，所以這裡照人類寫法列即可。
 */
export const ALIAS_GROUPS: Record<string, string[]> = {
  tsmc: ['台積電', '台灣積體電路', 'taiwansemiconductor', 'taiwansemiconductormanufacturing', 'tsmc'],
  nvidia: ['輝達', '英偉達', 'nvidia'],
  amd: ['超微', '超微半導體', 'amd', 'advancedmicrodevices'],
  broadcom: ['博通', 'broadcom'],
  samsung: ['三星', 'samsung', '三星電子'],
  huawei: ['華為', 'huawei'],
  wistron: ['緯創', 'wistron'],
  fed: ['聯準會', '美國聯準會', '美聯儲', 'fed', 'federalreserve', 'thefed'],
  trump: ['川普', '特朗普', 'trump', 'donaldtrump', '川普政府'],
  us: ['美國', 'us', 'usa', 'unitedstates', 'america'],
  china: ['中國', 'china', '中國大陸'],
  taiwan: ['台灣', 'taiwan'],
  korea: ['韓國', 'southkorea', 'korea'],
  japan: ['日本', 'japan'],
  hormuz: ['荷莫茲海峽', '荷姆茲海峽', '霍爾木茲海峽', 'straitofhormuz', 'hormuz', 'strait0fhormuz'],
  houthi: ['胡塞', '胡塞武裝', 'houthi', 'houthis'],
  oilprice: ['油價', '原油價格', 'oilprice', 'crudeoilprice'],
  crudeoil: ['原油', 'crudeoil', 'crude', 'oil', '石油'],
  semiconductor: ['半導體', 'semiconductor', 'semiconductors'],
  taiex: ['台股', '加權指數', '台灣加權指數', 'taiex', '台股加權指數'],
  twd: ['新台幣', '台幣', 'twd', 'ntd'],
  inflation: ['通膨', '通貨膨脹', 'inflation'],
  interestrate: ['利率', 'interestrate', 'interestrates'],
  exchangerate: ['匯率', 'exchangerate', 'fx'],
  rareearth: ['稀土', 'rareearth', 'rareearths'],
  tariff: ['關稅', 'tariff', 'tariffs'],
  jensenhuang: ['黃仁勳', 'jensenhuang'],
  lisasu: ['蘇姿丰', 'lisasu'],
  anthropic: ['anthropic'],
  deepseek: ['deepseek'],
  sox: ['費半', '費城半導體指數', 'sox', 'philadelphiasemiconductorindex'],
}

const ALIAS = new Map<string, string>()
for (const [canonical, names] of Object.entries(ALIAS_GROUPS)) {
  for (const n of names)
    ALIAS.set(normStrict(n), canonical)
}

export function normLenient(raw: string): string {
  const s = normStrict(raw)
  return ALIAS.get(s) ?? s
}

/**
 * topicTags 只做 kebab-case 統一、不套 entity 的別名表。
 *
 * 原註解寫「topicTags 是封閉詞彙」，2026-08-21 實測量到的事實推翻了它：
 * 近 30 日 external_articles.topic_tags 有 4,291 個 distinct tag。詞彙是開放的，
 * 這裡只做形式正規化，語意對照在 agents/topic-aliases.ts。
 */
export function normTag(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().trim().replace(/[\s_]+/g, '-')
}
