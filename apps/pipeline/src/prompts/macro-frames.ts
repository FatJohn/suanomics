// 手寫的總經數據解讀 frame pack。與外部節目蒸餾來的 distilled frame 分開維護、
// provenance 清楚切開。每條 frame 綁定既有 market snapshot 序列（series-config.ts 的 seriesId）、
// 與 analyst prompt 的「市場數據快照主動解讀」咬合。新增 frame 補一筆即可。

export interface MacroFrame {
  /** kebab id、例 'inflation-decomposition' */
  id: string
  /** 中文名、例 '通膨統計分類拆解' */
  name: string
  /** 觸發條件（snapshot / 新聞 cue） */
  whenToApply: string
  /** 強迫的深度問題（≥1） */
  questions: string[]
  /** 綁定的序列 id、必須是 series-config 的 SERIES_SPECS seriesId 子集 */
  snapshotRefs: string[]
}

export const MACRO_FRAMES: MacroFrame[] = [
  {
    id: 'inflation-decomposition',
    name: '通膨統計分類拆解',
    whenToApply: 'snapshot 或新聞出現 CPI、核心 CPI、通膨數據時',
    questions: [
      '這次變動主要來自 headline 還是 core？兩者背離說明什麼（能源/食品短期擾動 vs 黏性通膨）？',
      '是商品（goods）還是服務（services）帶動？服務性通膨黏性高、商品通膨易反覆',
      '驅動是供給面（成本推升、供應鏈）還是需求面（消費、薪資）？兩者政策意涵不同',
      '是否有基期效應（去年同期高/低基期）扭曲年增率的解讀？',
    ],
    // 接上四條 CPI 成分：本 frame 問的正是「商品還是服務帶動」「供給面還是需求面」，
    // 能源/食物（供給面短期擾動）與房租/核心服務（黏性、需求面）就是回答它們的素材。
    snapshotRefs: [
      'us-cpi-yoy',
      'us-core-cpi-yoy',
      'us-cpi-energy-yoy',
      'us-cpi-food-yoy',
      'us-cpi-shelter-yoy',
      'us-cpi-supercore-yoy',
    ],
  },
  {
    id: 'oil-supply-demand',
    name: '油價供需結構',
    whenToApply: '出現 WTI 原油、油價、OPEC、能源價格時',
    questions: [
      '價格變動是供給側（OPEC+ 增減產、庫存、地緣中斷、美國頁岩產量）還是需求側（中國進口、全球景氣、季節性）驅動？',
      '供給驅動的漲價（推升成本/通膨）與需求驅動的漲價（景氣熱訊號）意義相反、分別指向什麼？',
      '是價格水準變化還是預期變化（期貨曲線 contango/backwardation 隱含的訊號）？',
    ],
    snapshotRefs: ['wti-oil'],
  },
  {
    id: 'central-bank-housing-transmission',
    name: '央行房市口風與政策利率傳導',
    whenToApply: '出現 Fed funds、央行談話、利率決議、房市/房貸相關時',
    questions: [
      '央行對房市/房貸/資產價格的措辭偏鷹（抑制）還是偏鴿（容忍）？口風較前次有無轉變？',
      '政策利率 → 房貸利率 → 房市量價 → 財富效應 → 消費/通膨 的傳導鏈、目前走到哪一段、有無阻塞？',
      '利率對利率敏感產業（房市、營建、耐久財）的領先影響為何？',
    ],
    snapshotRefs: ['us-fed-funds', 'us-10y-yield'],
  },
  {
    id: 'yield-curve-shape',
    name: '殖利率曲線形狀',
    whenToApply: '出現美債 10Y/2Y 殖利率、利差、殖利率曲線時',
    questions: [
      '曲線陡化、平坦化還是倒掛？10Y-2Y 利差的方向與絕對水準隱含的景氣/衰退預期？',
      '殖利率變動來自實質利率還是通膨預期？是 term premium 還是政策利率預期？',
      '折現率變化對成長股/高估值資產的評價壓力為何？',
    ],
    snapshotRefs: ['us-10y-yield', 'us-2y-yield', 'us-yield-spread-10y2y'],
  },
  {
    id: 'real-rate-decomposition',
    name: '名目與實質利率分解',
    whenToApply: '出現通膨預期、breakeven、實質利率、TIPS，或央行談論利率的限制性/寬鬆程度時',
    questions: [
      '名目殖利率的變動主要由實質利率（DFII10）還是通膨預期（breakeven / T10YIE）帶動？**三者是否同向已在快照的「跨市場訊號一致性」算好（「美債殖利率拆解」那條），直接引用、不要自己重判方向**；該小節不存在時才自行判讀。要回答的是背離指向什麼——實質利率升偏向成長或政策收緊預期，通膨預期升偏向通膨風險？',
      '10 年期實質利率為正且走高＝貨幣環境對實體經濟具限制性；轉負＝仍偏寬鬆。目前落在哪一端、對高估值與利率敏感資產的折現壓力為何？',
      '通膨預期（10 年 breakeven）是錨定在央行目標（約 2%）附近還是脫錨？落差說明市場對通膨路徑與央行可信度的判斷？',
    ],
    snapshotRefs: ['us-10y-real-rate', 'us-10y-breakeven', 'us-10y-yield'],
  },
  {
    id: 'usd-capital-flows',
    name: '美元強弱與跨境資金流',
    whenToApply: '出現美元指數、美元台幣、外資/三大法人買賣超時',
    questions: [
      '美元走強/走弱對原物料（通常逆向）、新興市場資金（流出/流入）的影響？',
      '美元台幣走勢對台灣出口競爭力與外資進出台股的意涵？**匯率、法人買賣超、外資期貨淨部位是否同向已在快照的「跨市場訊號一致性」算好（「外資動向」那條），直接引用、不要自己重判方向**；該小節不存在時才自行判讀。要回答的是背離的那一項可能的解釋為何？',
      '是美元自身因素（Fed 政策）還是相對因素（他國更弱）驅動？',
    ],
    snapshotRefs: ['usd-index', 'usd-twd', 'taiex-institutional-net'],
  },
  {
    id: 'liquidity-monetary',
    name: '流動性與貨幣環境',
    whenToApply: '出現 M2、貨幣供給、流動性、Fed 資產負債表時',
    questions: [
      'M2 年增率的方向反映貨幣環境寬鬆還是緊縮？與政策利率方向是否一致？',
      '當前行情較像資金驅動（流動性充沛推升估值）還是基本面驅動（獲利成長）？',
      '流動性收縮對高估值/投機性資產的領先風險為何？',
    ],
    snapshotRefs: ['us-m2-yoy', 'us-fed-funds'],
  },
]

// Render MACRO_FRAMES 成 markdown 區塊、append 進 analyst-tier1 system prompt。
// 標頭「## 總經數據解讀框架」是接線 guard 測試的錨點。
export function renderMacroFramesSection(frames: MacroFrame[] = MACRO_FRAMES): string {
  const lines: string[] = []
  lines.push('## 總經數據解讀框架')
  lines.push('')
  lines.push('遇到總經數據（市場數據快照中的序列、或新聞提及）時、用下列框架做深度拆解、而非表面複述。無相關數據序列的主軸不要硬套：')
  for (const f of frames) {
    lines.push('')
    lines.push(`### ${f.name}`)
    lines.push(`- 何時套用：${f.whenToApply}`)
    lines.push(`- 相關數據序列：${f.snapshotRefs.join('、')}`)
    lines.push('- 拆解問題：')
    for (const q of f.questions) {
      lines.push(`  - ${q}`)
    }
  }
  return lines.join('\n')
}
