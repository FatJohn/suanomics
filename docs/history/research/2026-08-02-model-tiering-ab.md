# Model 分層實測：flash-lite 降級與 3.6-flash 評估

> 2026-08-02。兩個 A/B 實驗的結論與方法論沉澱。相關 PR：#198（flash-lite 降級）。相關 issue：#200。
>
> 當時的一次性 harness 已制度化成 `pnpm model:ab`（每臂預設雙跑、同時報雜訊底線與跨臂差異）；跑法見 [judge-discipline.md](../operations/judge-discipline.md)「換 model 的量測」。可重算的範圍僅限實驗二：`pnpm model:ab entity-summary --analyze` 與 `pnpm model:ab news-tagger --analyze`（吃本機 `.eval-out/model-ab/<agent>/` 的 run 檔、gitignored，換機器要重跑）。實驗一是 prose 型、當時的產物不是本工具的 run 檔格式，指標與 judge 結果都不可直接重算。

## 為什麼做這件事

Google 在 2026 年 8 月前後放出 `gemini-3.6-flash`（$1.50 in / $7.50 out per 1M）與 `gemini-3.5-flash-lite`（$0.30 / $2.50），而本專案當時除了 narrative-writer（`gemini-3.1-pro-preview`）與 podcast-writer（`gemini-3-flash-preview`）之外，所有 agent 都跑最貴的 `gemini-3.5-flash`（$1.50 / $9.00）。

問題是「該怎麼重新分配」。直覺的答案是「把便宜的換上去」，但兩個實驗給出的答案不對稱：**一個換對了，一個換了等於沒換**。差別不在模型好壞，在成本結構。

## 結論摘要

| | 換什麼 | 實測結果 | 決策 |
|---|---|---|---|
| 第一刀 | 高量低複雜度 agent：`gemini-3.5-flash` → `gemini-3.5-flash-lite` | 品質打平（flash 勝 11 / lite 勝 11 / 平手 5），成本省 **72%**，latency 快 3.2 倍 | **GO**，已在 #198 |
| 第二刀 | 主推理層 agent：`gemini-3.5-flash` → `gemini-3.6-flash` | 品質量不出差異，成本實際只省 **3.2%**，年省約 $0.21 | **NO-GO**，收掉 |

> **★ 2026-08-23 更正：本節的成本前提已失效，結論不再成立。**
> 當時 `gemini-3.6-flash` 是 $1.50 / $7.50，與 `gemini-3.5-flash` 的 input 同價，所以算出
> 「只省 3.2%、年省 $0.21」。Google 後來把 3.6 一起放進 introductory 折扣，官方頁
> （2026-08-23 實查）現在是 **$0.75 / $3.75，到 2026-12-31**。也就是說「換了沒有好處」
> 這個判斷是**被價格變動推翻的，不是被新資料推翻的**。
> 本節其餘內容（品質量不出差異、input-bound 的方法論）仍然成立，而且正是 2026-08-23
> 換 3.7 的依據——見 [2026-08-23-gemini-3.7-flash-ab.md](2026-08-23-gemini-3.7-flash-ab.md)。
> `pricing.ts` 的 3.6 單價同日更正，並加了到期 time-bomb 防止同一件事再發生。

## 實驗一：3.6-flash 對 viewpoints-debate（NO-GO）

### 設計

`viewpoints-debate` 的輸入（`dailyThesis`、`headline`、`summary`、`cascadeChains`）100% 存在於 canary fixtures 的 `brief.json`，所以不需要重跑 pipeline、不需要 Postgres。兩臂各跑一次，各自把結果 splice 回 brief 的 `viewpoints` 欄，其餘欄位 byte-identical——零 confound 的單變因實驗。用 `pnpm brief:quality` pairwise judge 對打。

`resolveAgentModel` 每次呼叫都重讀 `process.env.AGENT_MODELS`、無 memoize，所以同一個 process 內就能切臂。

### 結果

4 天 × 3 維 = **12/12 全 tie**。但這個 tie 不是「勢均力敵」——判定 pattern 是每次 orientation-1 選乙、orientation-2 也選乙，swap 後全數抵銷。**judge 完全被位置牽著走，沒有訊號。**

真正推翻提案的是成本結構：

| | 3.5-flash | 3.6-flash | Δ |
|---|---|---|---|
| input tokens | 43,694 | 43,755 | +0.1% |
| output tokens | 2,660 | 2,799 | **+5.2%** |
| output-only 成本 | $0.02394 | $0.02099 | −12.3% |
| **總成本** | **$0.08948** | **$0.08662** | **−3.2%** |

17% 的帳面折扣被吃掉兩層：

1. 3.6 比較囉嗦，多寫 5.2%，把 −16.7% 磨成 −12.3%
2. **更致命的是 `viewpoints-debate` 是 input-bound**——input 佔 94% 的 token，而兩個 model 的 input 同價，output 只佔總成本的 27%

換算到 prod（一天跑一次）＝**每年省 $0.21**。

### 為什麼這個結論會複製到其他 agent

`analyst-tier1`、`analyst-tier2`、`synthesizer`、`editor`、`decomposer` 全都是同一種形狀：**長 prompt、短 JSON 輸出**。只要成本重心在 input，換一個「output 比較便宜」的 model 就不會有意義的節省。這是結構性的，不需要逐個實測。

質性上讀了兩天全文，3.6 反而略優（會標明每點在打哪個子論點，而非千篇一律「削弱該論點」），零 degrade、零 schema 失敗、零合規問題。**所以 NO-GO 的理由不是 3.6 比較差，是換了沒有好處。**

官方給 3.6 的定位是 "balances speed with intelligence"，賣點可能在延遲。本專案的 brief pipeline 是每天跑一次的批次工作，快 30 秒沒有價值——這是「用不上它的長處」，不是「它不行」。若未來出現低延遲場景（例如使用者面前的即時互動），要重新評估。

### 成本

$0.457（debate 兩臂 $0.176 + judge $0.280 + probe $0.001）。

## 實驗二：flash-lite 對 entity-summary / news-tagger（GO）

### 設計

與實驗一刻意不同：**這兩個 agent 的輸出是結構化的**（`entities`、`topicTags`），可以直接算機械指標，不需要 LLM judge。實驗一的教訓正是 judge 在小差異上量不出訊號。

素材是 canary fixtures 五天合併去重後的 26 篇真實新聞。**每臂各跑兩次**，用來量同一個 model 自身的抖動（見下方「對照組」一節，這是整個實驗最關鍵的設計）。

### 結果

| 指標 | flash（跑 1 / 跑 2） | flash-lite（跑 1 / 跑 2） |
|---|---|---|
| entities/篇 | 4.81 / 4.77 | 4.58 / 4.77 |
| `kind` 落 `other` | 32.8% / 25.0% | 19.3% / 21.8% |
| schema 未定義的 kind | 0 | 0 |
| zod 失敗 / retry | 0 / 0 | **0 / 0** |
| entity Jaccard **同臂**（雜訊底線） | 63.4% | **69.6%** |
| entity Jaccard **跨臂** | 48.3–51.5% | |
| 成本（26 篇） | $0.1140 | $0.0316 |
| latency mean | 5.5s | **1.7s** |

跨臂差異（48–51%）確實大於同臂雜訊（63–70%），所以兩個 model 不是同一回事。但方向不是單向退化：

- **flash 的優勢集中在專有名詞召回**（lite 兩跑都漏）：`Helios`、`KOSPI`、`1930年關稅法`、`DeepSeek`、`Kimi K3`、`費城半導體指數`、`聯準會`、`美元指數`
- **lite 的優勢**（flash 兩跑都漏）：`Alphabet`、`晶片股`、`算力`、`SK海力士`；英文新聞會照 prompt 要求給英文 entity；而且 flash 會把 RSS 出版商 `WSJ` 當成 company 抽出來，lite 不會

逐案讀原文判定的結果：**flash 勝 11 案、lite 勝 11 案、平手 5 案**。

`news-tagger` 更極端：flash 自己跑兩次的 tag Jaccard 只有 **26.7%**，跨臂 17–26%，lite 自己是 46.4%。**模型自身的不穩定度完全淹沒兩臂差距**，這條路徑根本量不出 model 差異。以手標的 4 組同故事群檢驗下游分群力，兩臂也無差別。

### 成本實測

entity-summary 每篇 $0.00438 → $0.00122，**省 72.2%**。預估是 76%，差的 4pp 來自 lite 輸出 token 多 38%（7,384 vs 5,382）。news-tagger 省 70%。

以 entity-summary 一天約 432 calls 計：flash 的年成本約 $691、lite 約 $191，**年省約 $500**——是實驗一那條路（$0.21）的約 **2,400 倍**。

### 成本

約 $0.35。（`.eval-out` 產物內記錄的呼叫加總為 $0.335，差額是 probe 與前置試跑。）

## 方法論沉澱（這部分比上面的結論長效）

### 1. 換 model 前先看成本結構，不要看價目表的百分比

「output 便宜 17%」對 output-bound 的工作是 17%，對 input-bound 的工作可能是 3%。判斷方法很便宜：從 `llm_calls` 撈該 agent 的 `tokensIn` / `tokensOut`，算 output 佔總成本的比例。**本專案的 agent 幾乎全是長 prompt、短輸出**，所以真正的槓桿在 input 側——換 input 更便宜的 tier（flash-lite 就是 input 砍到 1/5）、prompt caching、素材裁切。

### 2. 沒有同臂雙跑對照組，比較結論不可信

實驗二的第一輪用單跑資料判 12 個分歧案例，得到「flash 勝 10」，看起來 flash-lite 明顯較差。**加上對照組後發現：同一個 model 跑第二次，犯了跟 lite 一模一樣的「錯」**——同樣寫 `台積電ADR`、同樣漏 `Alphabet`、同樣用「模型蒸餾」取代 `Kimi K3`。那不是 model 差異，是同一個模型自己的抖動。

改用「兩跑都一致的分歧」重判，結論從「flash 勝 10」變成「11:11 打平」——**方向完全相反**。

所以：任何 model 比較都必須先量出同臂雜訊底線，再看跨臂差異有沒有超出它。這條在實驗一同樣成立（那裡的雜訊表現為 judge 的位置偏誤）。

### 3. 結構化輸出優先用機械指標，別拿 LLM judge 量

`brief:quality` 這類 pairwise judge 適合判「哪篇報告寫得比較好」這種主觀題，但它在小差異上會被位置偏誤主導（實驗一：12/12 tie 全來自 swap 抵銷）。`entities`、`topicTags` 這類結構化輸出可以直接算重疊率、召回、schema 違規率——客觀、便宜、沒有位置偏誤。

判準：**輸出有結構就用機械指標，只有主觀品質才動用 judge。**

### 4. 重疊率只能量一致性，不能判對錯

兩臂都抽錯同一個實體，重疊率一樣是 100%。所以機械指標之後**必須回去讀原文做質性抽查**——實驗二的 11:11 是這樣判出來的，光看 48–51% 的 Jaccard 什麼也說不了。

## 順帶發現與後續

- **`contentSummary` 的 80–120 字規格沒有任何地方把關**（prompt 寫了、schema 與 zod 都沒約束）。出界率兩跑各為 flash 23% / 15%（合計 19.2%）、lite 46% / 27%（合計 36.5%），觀察到的最長是 218 字，且英文新聞會整段吐英文。這與 model 選型無關，已開 issue #200。
- **`news-tagger` 自身極不穩定**（同 model 兩跑 tag Jaccard 僅 26.7%）。它的 tags 用於 story-level 去重與選稿多樣性，這個穩定度值不值得擔心，是獨立的題目。
- **flash-lite 降級在 prod 仍無觀測手段**。本次實測涵蓋 26 篇，但線上是每天 432 篇。失敗形式是「文章照存、但 entities/tags 品質下降」，沒有告警。回退很便宜（`AGENT_MODELS` env 覆寫、不必重新部署），前提是先知道它退化了。
- **podcast-writer 換 3.6-flash 是漲價**（現行 `gemini-3-flash-preview` 是 $0.50 / $3.00），方向與省錢相反。它的 pin 是 2026-06-13 為繞過 `citationUrls` zod fail 的預防性措施，解除 pin 是獨立題目。
