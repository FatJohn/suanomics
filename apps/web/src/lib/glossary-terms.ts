import type { GlossaryEntry } from './glossary'

// 維護者手寫的術語詞庫（#94）：不經 LLM，讀者看到的解釋全文就是這裡的字。
// 收錄依據是 7 份真實 brief 的詞頻（統計方法與結果見 #94 的 PR），排序依出現天數。
// 解釋寫給不看盤的讀者：說明是什麼、怎麼讀，不寫方向判斷或操作建議；改字後跑 glossary-terms.test.ts 的 compliance 檢查。
// 別名只收 brief 裡實際出現的寫法；「融資」單獨出現常指「融資成本」，所以只收「融資餘額」。
// 中文比對沒有詞邊界，含有術語但意思不同的寫法列在 excludes（「海外資金」不是外資）。
export const GLOSSARY: readonly GlossaryEntry[] = [
  { id: 'real-rate', term: '實質利率', aliases: [], definition: '名目利率扣掉預期通膨後的利率，代表借錢的真實成本。實質利率上升時，遙遠未來的獲利換算成今天的價值會變少。' },
  { id: 'yield', term: '殖利率', aliases: [], definition: '持有債券到期每年可得的報酬率。債券價格跌、殖利率就升，兩者反向；美債殖利率常被當成全球資金成本的參考。' },
  { id: 'inflation-expectation', term: '通膨預期', aliases: [], definition: '市場預估未來一段期間的平均通膨率，常用名目公債殖利率減去同天期抗通膨公債殖利率推算。' },
  { id: 'cpi', term: 'CPI', aliases: ['消費者物價指數'], definition: '消費者物價指數，追蹤一籃子日常商品與服務的價格。CPI 年增率就是一般說的通膨率。' },
  { id: 'core-cpi', term: '核心 CPI', aliases: ['核心CPI'], definition: 'CPI 扣掉價格波動大的食物與能源後的數字，較能看出通膨的長期趨勢。' },
  { id: 'valuation', term: '估值', aliases: [], definition: '市場替公司或資產訂的價格高低，常用本益比衡量：股價相對每股獲利的倍數愈高，估值愈高。' },
  { id: 'sox', term: '費半', aliases: ['費城半導體指數'], definition: '費城半導體指數，由在美國掛牌的主要半導體公司組成，常被拿來對照台股電子股的走勢。' },
  { id: 'nasdaq', term: '納斯達克', aliases: ['納指', '那斯達克'], definition: '美國那斯達克交易所上市股票組成的綜合指數，科技公司比重高。' },
  { id: 'taiex', term: '加權指數', aliases: [], definition: '臺灣證券交易所以上市股票市值加權編製的指數，就是新聞說的「台股大盤」。' },
  { id: 'tx', term: '台指期', aliases: ['台股期貨'], definition: '以加權指數為標的的期貨契約，在台灣期貨交易所交易。每月第三個星期三是當月契約的最後結算日。' },
  { id: 'three-institutions', term: '三大法人', aliases: [], definition: '外資、投信、自營商三類機構投資人的合稱。證交所每天公布他們的買賣超金額，常被當成資金動向的參考。' },
  { id: 'foreign-investors', term: '外資', aliases: [], excludes: ['海外資'], definition: '外國機構投資人，例如海外基金、銀行與券商。外資持有台股的比重高，資金進出常牽動大盤與新台幣匯率。' },
  { id: 'net-position', term: '淨部位', aliases: ['淨空'], definition: '期貨多單口數減去空單口數。數字為負叫淨空，代表空單較多，可能是預期下跌，也可能是替手上的股票避險。' },
  { id: 'yoy', term: '年增率', aliases: [], definition: '和去年同一期間相比的變化幅度。和去年同期比可以排除季節因素，例如春節月份的消費高峰。' },
  { id: 'fed-funds', term: 'Fed funds 利率', aliases: ['Fed funds利率', 'Fed funds', '聯邦基金利率'], definition: '美國聯準會（Fed）設定的政策利率目標，是銀行間隔夜借錢的利率。升息、降息就是調整這個利率。' },
  { id: 'investor-conference', term: '法說會', aliases: [], definition: '法人說明會，上市櫃公司向投資機構說明營運成果與展望的會議，多在財報公布前後舉行。' },
  { id: 'treasury', term: '美債', aliases: [], definition: '美國財政部發行的公債，被視為全球最安全的資產之一。美債殖利率是各國利率與資金成本的參考。' },
  { id: 'percentage-point', term: '百分點', aliases: ['個百分點'], definition: '兩個百分比之間的差。利率從 2% 升到 2.5%，是上升 0.5 個百分點，不是上升 0.5%。' },
  { id: 'wti', term: 'WTI', aliases: [], definition: '西德州中級原油，美國原油價格的主要基準；另一個常見基準是北海布蘭特原油。' },
  { id: 'prior-value', term: '前值', aliases: [], excludes: ['目前值'], definition: '同一項數據上一次公布的數值，用來和最新數值比較。' },
  { id: 'position', term: '部位', aliases: [], definition: '投資人或機構手上持有某類資產的數量或金額，例如「AI 部位」是持有的 AI 相關資產。' },
  { id: 'margin-balance', term: '融資餘額', aliases: [], definition: '投資人向券商借錢買股票、還沒還清的總金額，常被當成散戶使用槓桿程度的參考。' },
  { id: 'short-balance', term: '融券餘額', aliases: [], definition: '投資人向券商借股票先賣出、還沒買回歸還的總張數。融券賣出的人通常預期股價下跌。' },
  { id: 'sbl-short', term: '借券賣出', aliases: [], definition: '向持股者借股票來賣出，之後再買回歸還。和融券類似，但主要由法人使用，規模通常比融券大。' },
  { id: 'net-buy-sell', term: '買賣超', aliases: ['買超', '賣超'], definition: '同一天買進金額減去賣出金額。買進較多叫買超，賣出較多叫賣超。' },
  { id: 'rate-step', term: '1 碼', aliases: ['1碼', '2 碼', '2碼'], definition: '利率調整的單位，一碼是 0.25 個百分點；升息 1 碼就是把利率調高 0.25 個百分點。' },
  { id: 'rate-hike', term: '升息', aliases: ['降息'], definition: '中央銀行調高政策利率，讓借錢變貴，用來壓抑通膨；反過來調低叫降息。新聞多半指美國聯準會。' },
  { id: 'discount-rate', term: '折現率', aliases: [], definition: '把未來的錢換算成今天價值時用的利率。折現率愈高，愈晚才實現的獲利在今天值得愈少。' },
  { id: 'spread', term: '利差', aliases: [], excludes: ['信用利差', '存放利差', '獲利差'], definition: '兩種利率的差距，常指 10 年期減 2 年期美債殖利率。正常時長天期較高、利差為正；轉負叫殖利率曲線倒掛。' },
  { id: 'foundry', term: '晶圓代工', aliases: [], definition: '替晶片設計公司代為生產晶片、不賣自有品牌晶片的製造模式，台灣是全球最主要的晶圓代工產地。' },
  { id: 'settlement-day', term: '最後結算日', aliases: ['結算日'], definition: '期貨契約到期、依標的價格結算損益的日子。台指期是每月第三個星期三，前後幾天交易量常會放大。' },
  { id: 'risk-premium', term: '風險溢價', aliases: [], definition: '為了承擔額外風險而多要求的報酬或價格。例如航道受威脅時，油價裡多出來、反映供應中斷可能的那一塊。' },
  { id: 'capex', term: '資本支出', aliases: [], definition: '企業花在廠房、設備、伺服器等長期資產的錢。大型科技公司的資本支出，常被用來推估 AI 晶片的需求。' },
  { id: 'nonfarm', term: '非農', aliases: ['非農就業', '非農業就業'], definition: '美國非農業部門就業人數的月增加數，通常每月第一個星期五公布，是判斷美國景氣的重要數據。' },
  { id: 'export-control', term: '出口管制', aliases: [], definition: '政府限制特定商品或技術賣到特定國家或企業，例如美國限制先進 AI 晶片出口到中國。' },
]
