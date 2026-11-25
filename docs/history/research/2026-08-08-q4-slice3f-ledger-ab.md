# Q4 Slice 3f — narrative 消費 claim ledger 的 A/B 量測

> 對應 spec：[2026-08-08-q4-slice3-ledger-consumption-design.md](../superpowers/specs/2026-08-08-q4-slice3-ledger-consumption-design.md) §4。
> 實跑：2026-08-08 17:26–18:16（台北）。工具：`pnpm ledger:ab`、`pnpm brief:quality`。

## 一句話

**方向偏向「ledger 讓讀者面的數字更容易連回證據」，但這一輪的證據強度只到「偏向」，
不到「證實」。** 兩個指標同向：

- deterministic traceability：**A1／A2 平均 5/5 天勝**（單側 p ≈ 3.1%）。
  **但改用 A1 單臂比只有 4/5**（07-26 那天 A1 66.7% < B 70.3%）。
- LLM judge 的 grounding 維度：A1 vs B **4 勝 0 敗 1 平**（單側 p ≈ 6.25%）。

**這兩者不是獨立驗證**：judge 比的是 A1 的產物、traceability 的 5/5 靠的是 A1+A2 平均，
而且兩者都由同一件事驅動（模型有沒有照抄 ledger 裡的數字）。把它們相乘當成更強的證據是錯的。

**深度與可讀性沒有量到方向**，而且那兩個維度的個別勝負落在 judge 自己的雜訊範圍內。
spec §8 風險 2（模型為了掛 claimIds 而傷可讀性）**沒有被證實，也沒有被排除**。

`claimIdsStripped`／`claimCitationUrlsDropped` 全程 0（10 次 narrative 產出、34 則新聞）。
**限制**：那兩個計數只記錄**成功那一次 attempt**；本輪 104 次呼叫比最小需求 88 次多約 16 次，
代表發生過 agent 層重試，被丟棄的 attempt 沒有被計入。

## 怎麼跑的

- 樣本：canary fixtures 5 天（2026-07-21～24、07-26）、共 34 則新聞。
- **三臂**：`A1`／`A2` ＝ `NARRATIVE_LEDGER_ENABLED=true`（同設定跑兩次）、`B` ＝ 關閉（當時的 prod 行為）。
  A1 vs A2 是**同臂雜訊底線**——本 repo 有過沒對照組就把雜訊當結論的實例（2026-08-02 model A/B）。
- **變因只有一個**：decomposer／analyst／synthesizer 每天只跑一次，三臂共用同一份 brief 與同一份 ledger；
  `ANALYST_CLAIMS_ENABLED` 三臂全開（否則量到的是「有沒有 claim」而不是「有沒有消費 claim」）。
- 不走 queue（brief job 有 deterministic id ＋當日去重，連跑兩次會拿到同一份東西）。
- 104 次 LLM 呼叫、$2.66、50 分鐘。narrative-writer `gemini-3.1-pro-preview`、analyst-tier1 `gemini-3.5-flash`。

## ① traceability：讀者面數字能不能連回 ledger

分子分母都用 D4 那套（`extractCheckedNumbers` ＋ `closeEnough`）做**數值**比對，
分母排除年份與曆日。涵蓋 `headline`／`summary`／`reasoningChain`／narrative 四處。

| 日期 | A1 | A2 | B | A 均 − B | 同臂雜訊 |
|---|---|---|---|---|---|
| 07-21 | 92.0%（23/25） | 93.1%（27/29） | 59.4%（19/32） | **+33.2pt** | 1.1pt |
| 07-22 | 63.9%（23/36） | 89.3%（25/28） | 51.4%（18/35） | **+25.2pt** | 25.4pt |
| 07-23 | 68.1%（32/47） | 65.9%（29/44） | 58.3%（28/48） | **+8.7pt** | 2.2pt |
| 07-24 | 95.6%（43/45） | 93.0%（40/43） | 78.4%（29/37） | **+15.9pt** | 2.5pt |
| 07-26 | 66.7%（34/51） | 84.4%（38/45） | 70.3%（26/37） | **+5.3pt** | 17.8pt |

**A1／A2 平均 5/5 天勝**。逐日效果中位數 15.9pt、逐日同臂雜訊中位數 2.5pt。

兩個必須一起讀的限制：

- **3.1% 是單側值**（只問「A 是不是每天都贏」）。字面上的「全同向」不指定方向，是它的兩倍 6.2%。
- **改用 A1 單臂比只有 4/5**：07-26 那天 A1 66.7% 輸給 B 70.3%，是 A2 的 84.4% 把平均拉過去的。
  §④ 的 pairwise judge 比的正是 A1，所以那兩張表**不能互相佐證**。
  報告工具現在會自己印出這個分歧（`verdict()` 的最後一行）。

### 這個比例是怎麼算的（會影響怎麼讀它）

比對的池子是**整份 ledger 攤平成一堆數字**，讀者面的任一數字只要對得上池子裡任一個就算命中。
所以：

- **命中的多半是小數字**：A1 的 155 個命中裡有 109 個（70.3%）絕對值小於 100（百分比、億元、
  倍數這類），B 臂 87/120（72.5%）也一樣。小數字天生容易在池子裡找到同值的另一條 claim，
  這個比例因此偏高。
- 池子裡也包含 `inference`／`scenario` 與沒有 `evidenceRef` 的 claim。**只收有 ref 的 claim** 時：
  A1 76.0% → 73.5%、B 63.5% → 62.4%——絕對值略降、**方向不變**。

### 這裡有一個量測方法本身的教訓

第一版報告的判準是**彙總層**比較（把 5 天的分子分母加總）：那樣算出來是
「同臂雜訊 8.1pt vs 效果 12.5pt」，判定「沒有大過雜訊底線的兩倍，不足以宣稱」。

**那個判定是錯的**，錯在把配對結構丟掉了：彙總讓分母大的那一天（07-26 的 51 個數字）
主導，而同臂雜訊的彙總值被兩個離群日（25.4pt、17.8pt）撐高。逐日配對後，
5 天全部同向、典型雜訊只有 2.5pt。

判準已改成逐日配對 ＋ 符號檢定（`pairedDaily`／`verdict`，有測試守門），
彙總數字仍然印出來但明確標示「不是判準」。

## ② citationUrls 由 claim 反推

A 臂 **15/15 段**（分母＝5 天 × 3 段 × A1 臂）的 `citationUrls` 由所用 claim 的 citation ref 決定；
`claimCitationUrlsDropped` 全程 0（沒有 claim 帶著 brief.citations 以外的 url）。

**這一欄不能拿來做 A/B 比較**：B 臂沒吃 ledger、`claimIds` 必為空、反推率恆為 0，
那是定義使然不是發現。

`claimIdsStripped` 全程 0——模型沒有掛過一個 ledger 裡不存在的 id（34 則、5 天、10 次 narrative 產出）。

## ③ 母 spec §6.2 要的分佈：unsupported fact claim

147 條 fact claim 裡有 **5 條沒有任何 `evidenceRef`（3.4%）**，逐日分佈 0／3／0／1／1。
ledger 三臂共用，所以這個數字與臂別無關——它量的是 analyst 那一層。

母 spec §6.2 那一題（`fact` claim 缺 evidence 時怎麼處置）的三個選項在 3.4% 這個量級下
差別不大：一天平均 1 條。**但這是 canary、tier1-only、序列是固定 fixture 的下限值**，
定閾值前建議用 prod 真實資料再量一次。

## ③-2 D2／D3（母 spec §6.2 的可推翻條件）

母 spec §6.2 記了一個可推翻條件：**若這一刀之後 D2／D3 開始出現非 0 的淘汰數，(c) 的論證要重來**。
所以這兩個數字必須明確回報：

| 檢查 | 適用的 claim | 通過 | 被濾掉的 ref |
|---|---|---|---|
| **D2**（citation ref 的 url 真的在 `brief.citations` 裡） | 120 | **120（100%）** | **0** |
| **D3**（series ref 的 `(seriesId, asOf)` 真的在當日快照裡） | 52 | **52（100%）** | **0** |

**→ 淘汰數為 0，(c) 的論證不需要重來。**

100% 太乾淨，所以做了反向檢驗確認量測有鑑別力：把 ctx 的 `citations` 換成空陣列 → D2 變 0/28
（28 個 ref 全被濾掉）；把 `seriesPoints` 換成空 → D3 變 0/12。量測抓得到失敗，只是這批資料真的沒有。

為什麼會全過：claim 的 citation ref 取自 analyst 自己的 citations，而 `brief.citations` 也是從
同一批 analyst output 組出來的，兩者天然一致；series ref 則是 Slice 2.5 的 auto-attach 只掛
已驗證存在的錨點。**這也表示 D2／D3 在目前的管線裡幾乎不可能失敗**——它們能抓的是
「模型自己編了一個 url／序列」，而現行的產生路徑不給模型這個機會。

## ④ 可讀性與深度（pairwise judge）

`pnpm brief:quality` 逐日比 A1 vs B，三個維度各判勝負。該工具本身已有 position-bias
control（同一對正反各判一次、兩次同向才算勝，含 tie 或矛盾一律 tie），所以下表的勝負
不是位置造成的。

| 日期 | 深度 | 可讀 | grounding |
|---|---|---|---|
| 07-21 | tie | B | **A** |
| 07-22 | B | tie | tie |
| 07-23 | B | tie | **A** |
| 07-24 | **A** | **A** | **A** |
| 07-26 | **A** | **A** | **A** |
| 合計 | A2 / B2 / tie1 | A2 / B1 / tie2 | **A4 / B0 / tie1** |

judge model：`gemini-3.5-flash`（`brief-quality-judge` 的預設）。

grounding 的方向與 ① 一致，**但兩者不是獨立佐證**：judge 讀的就是 A1 的產物、
①的 5/5 靠 A1+A2 平均，而且兩者都由「模型有沒有照抄 ledger 的數字」這同一件事驅動。

深度與可讀沒有方向。**spec §8 風險 2（模型為了掛 claimIds 而多塞數字、傷可讀性）
沒有被證實，但也沒有被排除**。

### judge 的雜訊底線（A1 vs A2，同設定的兩份產出）

**這一節是上表能不能讀的前提。** 同樣的工具、同樣的 5 天，比的是兩份**設定完全相同**的產出——
理想上應該全 tie：

| 日期 | 深度 | 可讀 | grounding |
|---|---|---|---|
| 07-21 | A2 | tie | tie |
| 07-22 | A2 | tie | A2 |
| 07-23 | tie | A2 | tie |
| 07-24 | A1 | tie | A2 |
| 07-26 | tie | A1 | A1 |
| 合計 | 3/5 判出勝負（1:2） | 2/5（1:1） | 3/5（1:2） |

**judge 對同設定的兩份產出，三個維度各有 2–3 天判得出勝負**，而且方向是雙向的。
這是通過 position-bias control 之後仍存在的雜訊。

把兩張表放在一起，才讀得出哪些是訊號：

| 維度 | A/B（A1 vs B） | A/A（A1 vs A2） | 判讀 |
|---|---|---|---|
| grounding | **4:0**，全部同向 | 1:2，雙向 | 偏向 A：單側 p ≈ 6.25%（雙側 12.5%）。**達不到一般意義的顯著**，只能說方向偏 A |
| 深度 | 2:2，雙向 | 1:2，雙向 | 雜訊：兩張表的形態一樣，區分不出來 |
| 可讀 | 2:1，雙向 | 1:1，雙向 | 雜訊：同上 |

所以 §④ 那張表裡唯一有方向的是 grounding 那一欄。深度與可讀的個別勝負
（例如 07-22、07-23 的「深度 B 勝」）落在 judge 自己的雜訊範圍內，**不得單獨引用**。

**A/A 那張表本身也只有一次實現**：grounding 只判出 3 天，在這個底線下「判出 d 天且恰好全同向」
的隨機機率是 2^(1−d)＝25%（d=3）、12.5%（d=4）——也就是說 A/A 自己跑成 3:0 並不罕見。
拿它當雜訊底線可以，但不要把「A/B 4:0 vs A/A 1:2」讀成一個嚴謹的對照檢定。

## 這份量測不能證明什麼

- **不是 prod 的分佈**。canary 只跑 tier1、沒有 editor 的 dailyThesis 與 viewpoints，
  序列是固定 fixture 而不是那幾天的真實行情——模型引用序列的動機低於真實 pipeline，
  所以 ① 與 unsupported 比例都是下限／上限而非實際值。
- **①量的是「機器能不能把數字連回證據」，不是「作者有沒有依據」**。讀者面寫「約 2.3 萬點」
  而 ledger 寫「23150」這種同義不同寫法算不對到。
- 5 天、34 則。符號檢定的 5/5 給的是方向，不是幅度；逐日幅度從 5.3pt 到 33.2pt。
- 沒有量成本以外的 prod 影響（延遲、失敗率）。10 次 narrative 產出全部成功、無 degrade。
- **① 是 pooled 比對**（整份 ledger 攤平、任一命中即算），而命中的 70% 是絕對值小於 100 的
  小數字——比例因此偏高。見 §① 的「這個比例是怎麼算的」。
- **audit 計數只涵蓋成功的那次 attempt**。104 次呼叫比最小需求 88 次多約 16 次，代表有重試；
  被丟棄的 attempt 若掛過幻覺 claimId，這裡看不到。
- D2／D3 的 100% 有結構性原因（見 §③-2），不代表「模型不會編造來源」這件事被驗證過。

## 原始資料

`apps/server/.eval-out/ledger-ab/`（gitignore）：15 份 brief JSON、5 份 sources、
`results-2026-08-08.json`、`report-2026-08-08.md`。pairwise 產物在 `apps/server/.eval-out/compare-*.md`。

**`results-2026-08-08.json` 是事後補建的**（results 落檔是那一輪跑完之後才加進 runner 的）：
`trace`／`sections`／`chars`／`audit.failed` 由 15 份 brief JSON 重算、可完全重現；
`claimIdsStripped`／`claimCitationSections`／`claimCitationUrlsDropped`／`newsCount` 取自當輪報告的
逐日表；`fabricationStripped` 與 `retryReason` 當輪沒記錄，填 0/null、**不得用於任何結論**。
檔案裡的 `_provenance` 欄位寫著同一段說明。

`report-2026-08-08.md` 已用改過的判準（逐日配對）重畫過一次；先前那份用彙總判準、寫著
「不足以宣稱」的版本已被覆蓋——那個結論是錯的，見 §① 的「量測方法本身的教訓」。
