# 每日總經報告：Backlog、報告品質與 Agent 切分評估

> 日期：2026-07-19（Asia/Taipei）  
> 評估基準：`main` `69981fb1d98e7fe2c65fe8a1f3473ea87a16e566`  
> 產出類型：研究與執行建議，不含 production code 修改  
> 目標：判斷目前 backlog 是否能提升每日總經報告品質、找出未涵蓋的風險，並提出 agent／資料契約／驗收方式的調整方向。

## 一、結論先講

目前 backlog 的**內容方向是正確的，而且已經跨過「AI 念新聞」的初階階段**。T1 具名數字、T5 數據廣度、T6 單一 thesis、rolling narrative、T10 資訊架構與 viewpoints，確實都對準「財經皓角式報告」最重要的幾個特徵：有主線、有數字、有前後文、有觀點、不是逐則摘要。

但系統的主要瓶頸已經改變：

1. 不再是「少一個生成 agent」，而是**每日產出、資料新鮮度與品質驗收尚未形成閉環**。
2. 不再是「citation 數量不夠」，而是**claim 與 evidence 沒有逐項綁定**，尤其新 viewpoints 完全沒有 evidence reference。
3. 不再是「資料太少」，而是**資料的語意、時點、預期差與市場反應沒有被一致建模**。
4. backlog 名義上是「當前有效佇列」，實際上大部分 T1–T10 已完成，真正待辦散落在 completed task 的 follow-up、長期 roadmap 與 `.claude/memory`，目前不利於下一輪排程。

因此下一階段的主軸應從「繼續加內容功能」切換成：

> **先讓每天準時有報告，再讓每個重要 claim 可追溯，最後才擴充更多資料與呈現。**

如果只選三件事，建議依序做：

1. **Production publication SLO + freshness manifest + 缺報告告警**。
2. **把 `dailyThesis`、evidence refs、viewpoints 納入持久化與品質量尺**。
3. **建立 claim-level pre-publication audit；先做 deterministic checks，再視需要加一個 verifier call**。

## 二、這次實際查了什麼

### Repo 內證據

- 當前佇列與策略：[`docs/backlog.md`](../backlog.md)、[`docs/long-term-roadmap.md`](../long-term-roadmap.md)、[`docs/roadmap.md`](../roadmap.md)。
- Agent 與 runtime：[`agents-and-prompts.md`](../architecture/agents-and-prompts.md)、`brief-worker.ts`、`orchestrator.ts`、各 agent runner／prompt／schema。
- 品質量尺：[`brief-eval.md`](../operations/brief-eval.md)、[`judge-discipline.md`](../operations/judge-discipline.md)、[`quality-trend.md`](../operations/quality-trend.md)。
- 資料與選稿：`packages/db/src/seed.ts`、`news-relevance.ts`、`series-config.ts`、`snapshot.ts`。
- Production 排程：`.github/workflows/daily-brief.yml`。

### Live artifact

- 2026-07-19 查 `/health` 為 `ok`。
- 直接讀取 production `2026-07-16` brief：
  - narrative 3 段、global citations 20 筆、narrative 實際引用 8 個 unique URLs。
  - viewpoints 為 `null`；該份報告早於 PR #141 上線，需等下一次 weekday production run 才能驗新區塊。
  - intro 以「如本日論點所述」開頭，但 `dailyThesis` 本身沒有存在 `MarketBriefSchema`，讀者與 eval 都看不到原始 thesis。
  - narrative 出現「融資餘額仍維持在 `+6,154 億元` 的高水位」。融資餘額是存量，不應在 level 本身帶 `+`；這可回溯到 `snapshot.ts` 以 `unit='億元'` 決定 signed，而不是以 series 語意決定。

### 外部參考：馬克雷達

這次讀取了以下公開頁面（2026-07-19）：

- [首頁](https://radar.markreadfintech.com/)：今日最強訊號、24H 新訊號、72H 持續追蹤、產業雷達、七日回顧。
- [事件檔案範例](https://radar.markreadfintech.com/event/32ec3f15-f47b-46d9-bd99-d0152347e328)：首次偵測、最後活動、原始報導、「馬克翻舊帳」與相似度。
- [主題檔案庫](https://radar.markreadfintech.com/topics)：本週活躍、事件累積量、主題摘要。
- [主題時間軸範例](https://radar.markreadfintech.com/topic/bitcoin)：追蹤起日、最後活動、跨日事件時間軸。

內建並排瀏覽器當下沒有可用分頁，因此外站部分是公開 HTML／索引內容稽核，沒有宣稱完成互動式視覺 QA。

### 關鍵判斷的 repo 證據索引

| 判斷 | 證據 |
|---|---|
| production workflow 仍是一次性 cron | `.github/workflows/daily-brief.yml:6-18` |
| 品質趨勢檔只有表頭 | `docs/operations/quality-trend.md:1-8` |
| SOP 要求品質改動 append trend | `docs/operations/judge-discipline.md:6-10,31-37` |
| `MarketBrief` 未持久化 `dailyThesis` | `packages/shared/src/market-brief.ts:103-122` |
| Viewpoints schema 沒有 evidence refs | `packages/shared/src/market-brief.ts:92-100` |
| Viewpoints 的 LLM 素材不含 citation／quote | `apps/server/src/agents/viewpoints-debate.prompt.ts:32-50` |
| Quality eval input 沒有 thesis／viewpoints | `apps/server/src/eval/quality-input.ts:31-52` |
| `億元` 由 unit 一律加 sign | `apps/server/src/market-data/snapshot.ts:31-68` |
| 真正 flow series 另有明確 id 清單 | `apps/server/src/market-data/snapshot.ts:85-100` |
| Editor output 同時含選稿、thesis 與 storyline state proposals | `apps/server/src/agents/editor-output.ts:3-18` |
| Viewpoints 與 Narrative 在 synth/assemble 後平行產出 | `apps/server/src/agents/orchestrator.ts:239-300` |
| 選稿來源權重只有 0.9–1.1 的溫和差異 | `apps/server/src/brief/news-relevance.ts:116-149` |
| Agent 文件仍記 12 names／9 runtime；code 已有 13 names | `docs/architecture/agents-and-prompts.md:55,272-278`、`apps/server/src/agents/providers/resolve.ts:5-40` |
| live 2026-07-16 brief | `https://macroseer-api.zeabur.app/api/brief/by-date/2026-07-16`（2026-07-19 read-back） |

## 三、用什麼標準判斷「報告品質」

目前 repo 的量尺分成：

- 對照財經皓角：topic coverage、cascade alignment、outlook alignment。
- 內在品質 pairwise：depth、readability、grounding。
- 跨日 pairwise：cross-day、thesis delta、resolve payoff。

這些都有價值，但還少四個 production 必要面向。建議完整品質定義如下：

| 面向 | 問題 | 建議指標 |
|---|---|---|
| Availability | 今天有沒有準時產出？ | 交易日 07:00 前可讀、缺報率、補產時間 |
| Freshness | 用的是哪個時點的資料？ | 每序列 `asOf`、stale ratio、新聞最後抓取時間、來源失敗清單 |
| Selection | 選到真正重要而非只是熱門的題嗎？ | 核心事件覆蓋、重複率、官方源比例、distinct source count |
| Factuality | 數字、日期、事件與因果有根據嗎？ | claim evidence coverage、numeric traceability、unsupported claim count |
| Analysis | 有多步傳導、結構性／暫時性辨析嗎？ | 現有 depth pairwise + claim chain 完整度 |
| Coherence | 全文是否真的服務同一 thesis？ | thesis 可見性、section-to-thesis coverage、summary/narrative 一致性 |
| Calibration | 有沒有條件、反證與不確定性？ | evidence-backed risk points、證偽條件、speculative 標記率 |
| Reader utility | 開盤前能否快速抓重點？ | 30 秒摘要、3 個關鍵數字、今日催化劑、昨日到今日 delta |
| Continuity | 今天相對昨天多知道了什麼？ | 現有 continuity 三維 |
| Compliance | 是否維持中性分析邊界？ | 現有 forbidden gate + false-positive set |

財經皓角應是**重要 benchmark，不應被定義成 ground truth**。目前 `brief-judge` prompt 把節目逐字稿稱為 ground truth 參考視角，容易把「跟節目不同」誤當成「較差」，也會獎勵模仿而不是獨立選題。建議改成：

- 財經皓角：衡量「有沒有漏掉人類總經主持人認為重要的角度」。
- 官方資料與原始新聞：衡量 factuality。
- 自家 canary corpus：衡量版本變更是否回退。
- 真實 production SLO：衡量是不是每天真的可用。

## 四、目前 backlog 確實改善了哪些品質

### 1. 從新聞清單升級成 thesis-driven 報告

T6 的 `dailyThesis` 與 narrative spine 是正確槓桿。2026-07-16 production brief 已能把 AI 硬體、能源通膨與本土信用收縮放在「基本面擴張 vs 資金面收縮」主線下，而不是逐則新聞摘要。

### 2. 具名數字已從缺口變成強項

T1/T3/T5 已讓報告能引用市場 snapshot 與新聞內數字。這對說服力的提升遠高於再換一個更大的模型；而且 UI 關鍵數字不經 LLM，是正確的風險分層。

### 3. Rolling narrative 是有差異化的產品資產

storyline 的 support/challenge/extend 與跨日回收，比單日文章更接近「每天聽同一位分析師」的體驗，也符合長期 roadmap 的護城河 thesis。

### 4. Bounded debate 的產品化方向正確

先用 spike 證實「內化進 narrative 會傷可讀性」，再改成顯性 viewpoints 區塊，是一次好的 verify-first 決策。正反面與主文分離，也比把主文寫成處處自我對沖更易讀。

### 5. IA 已開始服務資訊優先序

T10 把故事置前、數字降為參考 rail、cascade 摺疊，方向合理。這與馬克雷達「首頁先給訊號，再讓讀者進事件／主題檔案」的 progressive disclosure 思路一致。

## 五、目前沒顧慮完整的地方

### P0-1：專案叫「每日報告」，但排程仍是一次性

`.github/workflows/daily-brief.yml` 明確寫目前 cron 只 match 2026-07-20 04:00 的一次性排程，不是每日 cron。這代表所有內容品質工作都建立在「報告可能根本沒有產出」的風險上。

建議不要直接把 cron 改每日就算完成；先定 publication contract：

- 交易日：最晚幾點前必須有報告？建議先定 07:00 Asia/Taipei。
- 週六：明確 skip；週日：週報模式；台美假日如何處理。
- 失敗：幾分鐘後 retry、何時告警、補產後是否標記 late。
- 成功：不只 narrative/podcast 非 null，也要檢查 freshness、viewpoints 狀態與資料源失敗數。

驗收應包含：連續 10 個應產日、成功率與產出時間，而不只是單次 workflow 綠。

### P0-2：品質量尺有工具，卻沒有形成資料

`docs/operations/quality-trend.md` 目前只有表頭。`judge-discipline.md` 說每次品質改動都應 before/after 對打並 append，但 T1/T2/T6 等已完成項目沒有在這個 durable log 留下趨勢列。

另外，新 viewpoints 沒有進 `quality-input.ts` 的 `briefBlock`，因此現有 `brief:quality` 根本看不到這個新區塊；`dailyThesis` 也沒有落進 brief schema，無法直接評 thesis 是否被各段貫穿。

建議：

1. 把 `dailyThesis` 持久化到 `MarketBrief`。
2. `quality-input` 納入 viewpoints 與 thesis。
3. 加一組固定 3–5 日 canary fixtures，讓每次 prompt／model 變更可重跑同樣輸入。
4. LLM pairwise 繼續用於相對品質；另加 deterministic production metrics，避免被「absolute judge depth 飽和」綁住。
5. 所有 quality task 的 DoD 加上「`quality-trend.md` 至少一列」或明確寫出為何不適用。

### P0-3：Citation 是 section-level，不是 claim-level

目前做得好的部分是：narrative `citationUrls` 必須是 global citations 的 subset。但這只能證明「本段有附來源」，不能證明「這一句數字／日期／因果由哪個來源支持」。

新 viewpoints 的缺口更明顯：`ViewpointsSchema` 只有 `supportPoints`、`riskPoints`、`netRead`，沒有 evidence ids；辯論素材也只拿 thesis、synthesizer 摘要、market snapshot 與去掉 citation 的 cascade mechanism。它可能是 grounded 的，但 schema 無法證明。

建議新增最小 evidence contract，而不是先增加 RAG：

```ts
interface EvidenceClaim {
  id: string
  claim: string
  evidenceRefs: string[]
  asOf: string | null
  confidence: 'high' | 'medium' | 'low'
  kind: 'fact' | 'inference' | 'scenario'
}
```

- `evidenceRefs` 指向 source article quote、market series point 或 calendar event。
- Narrative／viewpoints 只引用 claim ids，不直接在最後一層重新發明事實。
- 發佈前 deterministic gate：數字是否在 evidence、日期是否有來源、scenario 是否明示條件語氣。
- 只有 deterministic gate 無法判的因果 claim，才交給一個 fresh verifier LLM。

### P0-4：資料「零幻覺」仍可能語意錯

Production 2026-07-16 報告把融資餘額寫成 `+6,154 億元`。數字可能完全來自 DB，仍然會因 formatter 語意錯而誤導成「正向流量」。

根因是：

- `SIGNED_UNITS` 把整個 `億元` 單位設為 signed。
- 但 `億元` 同時被三大法人買賣超（flow）與融資餘額（level）共用。
- 程式另有 `FLOW_SERIES_IDS`，卻只有 delta 語意用它，current value formatter 沒用。
- 測試只斷言融資 delta 包含 `+25 億元`，沒有斷言 level 本身不得是 `+2,825 億元`。

這類問題應升級成資料模型原則：

- `signed`、`flow/stock`、`asOf`、`frequency`、`revisionPolicy` 都是 series metadata，不可從 unit 推論。
- 每份報告附 data freshness manifest：最新日期、stale、refresh failure、是否延用前值。
- monthly 的固定 45 天 stale threshold 過於粗；CPI 發布延遲已接近 43 天，會只剩很短的「fresh」窗口。應依 series release cadence 或 release calendar 判斷。

### P1-1：總經報告最重要的「預期差」尚未建模

目前 snapshot 主要是 latest vs previous。對開盤前總經報告而言，更有解釋力的通常是：

> actual vs consensus vs prior vs revision，以及公布後哪個資產真的反應。

例如 CPI 3.1% 本身不夠，市場往往更在意：預期 3.2%、前值是否修正、2Y／10Y／美元／科技股在公布後怎麼動。

建議下一批資料投資不要先追更多冷門 series，而是建立 `MacroRelease`：

```ts
interface MacroRelease {
  event: string
  releasedAt: string
  actual: number | null
  consensus: number | null
  prior: number | null
  revisedPrior: number | null
  unit: string
  sourceUrl: string
}
```

再搭配 overnight reaction：美債 2Y/10Y、美元、WTI、黃金、S&P/Nasdaq/SOX 或相應 ETF／官方可得代理。重點不是堆 ticker，而是讓 agent 能回答「數據為何超預期、哪個市場相信它」。

### P1-2：來源有廣度，但權威層級太弱

選稿來源已很廣，但不少是 Google News query 或媒體 proxy。`SOURCE_WEIGHTS` 只有 0.9–1.1 的溫和乘數，且把「直接出版社／官方 feed」一起視為乾淨來源；這能處理噪音，不能處理 authority。

建議把兩個概念拆開：

- `signalQuality`：這個 feed 是否常有可用題目。
- `authorityTier`：這個來源能否直接支持數字／政策／法規事實。

至少分：

1. 官方／監管／交易所／央行。
2. 原始公司公告或法說。
3. 一線媒體。
4. 聚合與二次轉述。
5. KOL／評論，只能提供 frame，不當 authoritative evidence。

選題可以用媒體，claim grounding 優先回源到官方。這比單純新增更多 RSS 更能提升可信度。

### P1-3：Agent 邊界有兩處職責重疊、一處責任過重

#### Editor 過重

Editor 同一次 call 同時做：選稿、主軸、daily thesis、storyline touch/resolve/new。這些判斷彼此有關，但把 production state mutation proposal 與當日編輯規劃綁在一起，會造成：

- Editor fallback 時，同時失去 thesis、storyline、viewpoints。
- 選稿錯誤可能直接污染長期 storyline state。
- 無法分別評「選題差」還是「thesis 差」。

建議保留一個 Editorial Planner call，但拆 output contract：

- `BriefPlan`：selected ids、daily thesis、section angles、watch items。
- `StorylineProposals`：touch/resolve/new，於 brief 成功後另走 deterministic validation 與寫回。

不一定要多一個 LLM；重點是責任與驗收可分離。

#### Synthesizer 與 Narrative Writer 重複生成 prose

Synthesizer 已產 headline、summary、reasoning prose，Narrative Writer 又拿這些與 analyst output 重寫一次長文。多一層摘要容易流失數字與證據，也讓 headline/summary 與 narrative 各自形成一套措辭。

建議：

- Synthesizer 改成**結構化 outline／claim ledger owner**：thesis、section claims、evidence refs、counterpoints、watch items。
- Narrative Writer 成為**唯一 prose owner**：依 outline 寫 headline、summary、intro、sections、outro。
- 若保留現有 headline/summary 先生成，也要加一致性 gate，避免 summary 只講第一段而 narrative 有三條主線。

#### Decomposer／Tier 2 應由 evidence value 決定，不由流程慣性決定

目前 Decomposer 與 Tier 1 都 per-news；Tier 2 再依 next-tier entity fan-out。這個結構本身合理，但應記錄每一層實際帶回多少新 evidence。若 Decomposer hypothesis 沒有命中 corpus、或 Tier 2 沒增加新來源，只是多一輪 LLM abstraction，就應自動 no-op。

建議把 KPI 從「呼叫成功」改成：

- 新增 distinct authoritative sources 數。
- 新增可引用 evidence claim 數。
- 沒有證據的 speculative chain 比率。
- 每增加一個有效 claim 的成本與延遲。

### P1-4：缺少真正的 pre-publication verifier

目前已有 schema、URL allowlist、compliance gate 與 eval judges，但沒有一個 stage 在發佈前回答：

> 「這篇最重要的 10 個 claim，有幾個能被輸入直接支持？哪些只是合理推論？哪些超過證據？」

建議先做 deterministic verifier：

- 數字 exact-match／normalized-match。
- 日期與事件是否存在輸入。
- citation URL subset。
- `fact/inference/scenario` label 是否符合句型。
- thesis、viewpoints 與 sections 是否各有 evidence refs。

再新增一個 `claim-verifier` LLM，只檢 deterministic 無法判的因果 claim。它不改寫文章，只回 findings；高風險 finding 阻擋發佈或降級為「待查證」，避免 verifier 自己成為第二個 writer。

### P2：Backlog 文件已不再是清楚的當前佇列

`docs/backlog.md` 自稱「當前有效工作佇列」，但 T1–T10 幾乎全部完成，completed 歷史與 follow-up 混在同一頁。真正近期順序則出現在 `.claude/memory/project_priority_backlog_2026_07.md`；這不是適合跨 agent／跨工具 review 的 durable source of truth。

同時 `agents-and-prompts.md` 仍寫 12 個 `AgentName`／9 個 runtime agent，實際 code 已加入 `viewpoints-debate`，變成 13 個名字／10 個 runtime agent。這是小型文件漂移，但也反映完成 task 沒有統一收尾更新 current-state docs。

建議 backlog 改成三層：

- `Now`：最多 3–5 個可執行項目，有 owner、前置、DoD。
- `Next`：已核可但未排入，寫 trigger。
- `Later / Bets`：觸發條件制。
- Completed 詳情移到 archive／change note，只在 current backlog 留一行結果與連結。

## 六、建議的 Agent 切分

### 原則

維持 workflow，不導入 agent SDK；這個決策仍合理。調整重點不是「更多自主 agent」，而是讓每一層只擁有一種責任，並以結構化 contract 交接。

| 現有角色 | 建議 | 理由 |
|---|---|---|
| News Categorizer / Tagger | 保留，繼續當 ingestion enrichment | 離線、便宜、失敗可降級，邊界清楚 |
| Editor | 保留單一 call，但拆 `BriefPlan` 與 `StorylineProposals` contract | 選稿與 thesis 可共同最佳化；state proposal 要能獨立驗收 |
| Decomposer | 收斂成 Research Planner；可從 per-news 演進為 per-theme | 避免同一事件多篇新聞各拆一輪；先以實測決定是否改粒度 |
| Tier 1 Analyst | 保留，輸出 `EvidenceClaim[]` 而不只 prose chain | 成為事實與一階推理的主要 owner |
| Tier 2 Analyst | 保留 bounded／evidence-conditioned | 只有取得新 evidence 才產出；否則 no-op |
| Synthesizer | 從 prose writer 改為 outline／claim ledger assembler | 減少多層摘要造成的數字與來源流失 |
| Narrative Writer | 保留，成為唯一完整 prose owner | 統一 headline、summary、narrative 的語氣與主線 |
| Viewpoints Debate | 保留獨立區塊；每點加 `evidenceRefs` | 保住主文可讀性，同時讓正反觀點可查證 |
| Claim Verifier（新增） | 發佈前 read-only audit；deterministic first、LLM second | 補上現有 schema/compliance 無法覆蓋的事實與因果 gate |
| Eval Judges | 保留；修正 benchmark 定位並加入 canary | 避免把皓角當唯一 ground truth 或只靠一次性 A/B |

### 建議的目標資料流

```text
Ingestion / normalize / tag
        ↓
Editorial Planner → BriefPlan + StorylineProposals
        ↓
Research Planner → evidence queries
        ↓
Tier 1 / selective Tier 2 → EvidenceClaim[]
        ↓
Structured Synthesizer → section outline + claim ledger
        ↓                    ↘
Narrative Writer              Viewpoints Debate
        ↓                    ↙
          Claim Verifier
                ↓
        Publish + QualityReport
```

這個調整實際只新增一個 verifier responsibility；其餘主要是改 contract 與責任，不是把 agent 數量翻倍。

## 七、馬克雷達可借鏡什麼

馬克雷達最值得借的不是 Crypto／Fintech／AI 類別，而是它把「新聞」轉成「事件」再轉成「持續追蹤主題」的資訊架構。這與本 repo 已有的 `topicTags`、story dedup、storylines 非常相容。

| Radar 概念 | 本專案採用方式 | 優先序 |
|---|---|---|
| 訊號強度 | 以 distinct sources、官方源權重、24H 速度、跨資產反應、台股 relevance 組成，不直接照抄報導數 | P1 |
| 24H 新訊號 / 72H 持續追蹤 / 7D 回顧 | 對應今日新題、open storylines、週日 recap；可直接用現有 storyline lifecycle | P1 |
| 首次偵測 / 最後活動 | 加進 storyline metadata 與 UI | P1 |
| 「翻舊帳」相似事件 | 將現有 storyline update 與 story dedup 結果產品化；顯示「上次發生什麼、這次差在哪」 | P1 |
| 主題檔案庫 / 時間軸 | 把 open/resolved storylines 做成讀者可進入的 dossier，不另建第二套主題 DB | P2 |
| 原始報導數 / 來源數 | 顯示 evidence diversity 與來源層級；官方源單獨標示 | P1 |
| 產業雷達 | 只做總經／台股主題：利率、通膨、能源、AI capex、台股籌碼、地緣，不擴成個股訊號站 | P2 |
| 週報 archive / 訂閱 | 先把週日 recap 做成可分享 archive；訂閱等真的有穩定讀者再做 | Later |

### 不建議照抄

- **報導篇數不等於總經重要性**：媒體熱度會放大熱門公司與幣價題，官方數據可能只有一個來源卻更重要。
- **不要先做 200+ 主題 taxonomy**：目前 solo PoC，維護成本高；先用 8–12 個 macro domains + dynamic storylines。
- **不要因為 Radar 有完整事件頁就重建一套 event DB**：先讓現有 news tags／storylines 成為 single source。
- **不要加入個股方向、目標價或訊號交易語意**：維持現有市場／產業層級合規邊界。

## 八、建議重排後的 Backlog

### Now：先建立可相信的每日閉環

#### Q0：驗證 2026-07-20 weekday production run

目標：驗 PR #141 viewpoints、PR #142 real-rate、PR #145 workflow 與 07-17 起缺口。

DoD：

- workflow 綠；by-date 可讀。
- narrative／podcast／audio 狀態明確。
- viewpoints 非 null，或有明確 degrade reason。
- real-rate／breakeven 進 snapshot，日期與值可回源。
- 記錄產出完成時間與 refresh failure list。

#### Q1：Publication SLO + freshness manifest + alert

DoD：

- 明確 weekday/weekend/holiday contract。
- 連續 10 個應產日可觀察成功率、完成時間與 late 狀態。
- `/health` 之外有「今日報告存在且資料足夠新」的 read-only signal。
- 缺報或 late 有外部告警。

#### Q2：品質閉環補齊

DoD：

- `dailyThesis` 進 schema／DB／eval input。
- viewpoints 進 quality eval。
- 建立固定 canary fixtures。
- `quality-trend.md` 實際有紀錄，不再只有表頭。
- 財經皓角 prompt 從 ground truth 改為 benchmark wording。

#### Q3：Market data 語意與新鮮度修正

DoD：

- signed/flow/stock 改由 series metadata 決定。
- 融資餘額 level 無前導 `+`，delta 仍保留正負。
- 報告保存 data-as-of 與 source failures。
- stale policy 改成 per-series 或 release-aware。

### Next：讓每個重要結論可查證

#### Q4：EvidenceClaim + pre-publication audit

先做 3 個 claim 類型：named number、dated event、causal inference。不要一開始設計完整知識圖譜。

DoD：

- narrative 與 viewpoints 的重要 claim 有 evidence refs。
- 數字 traceability 100%；缺 evidence 不可作 fact 發佈。
- verifier finding 有 audit artifact。
- verifier 只審查、不改寫。

#### Q5：來源 authority tier + primary-source backfill

先從 Fed/BLS/TWSE/TAIFEX/央行/公司公告等現有主題做小範圍，不追求所有文章回源。

DoD：

- selection 與 grounding 使用不同權重。
- 報告可顯示 primary/secondary source mix。
- 重大數據與政策 claim 優先有官方來源。

#### Q6：Macro surprise + overnight reaction

先選 CPI、非農、Fed 三類事件做 spike；確認免費且合法的 consensus source，再決定是否擴大。若 consensus 資料不可穩定取得，不要假裝有預期差，先只做 actual/prior/revision。

### Later：把資料資產產品化

#### Q7：Storyline dossier／事件時間軸

沿現有 storyline 做 firstSeen、lastActivity、updates、support/challenge/extend 與 related reports；借 Radar 的呈現，不重建資料層。

#### R1：Phase D → B → C

CI gate 已先落地；後續 pre-deploy gate、observability、security/compliance hardening 繼續按 roadmap，但要和 Q0–Q6 的報告品質軌分開追蹤，避免「基建完成」被誤當成「內容品質提升」。

## 九、哪些事情現在先不要做

- 不要換 agent framework 或上 ADK／Agent SDK。
- 不要把整條 pipeline 改成 autonomous research loop。
- 不要再擴大量市場資料 series，除非能回答明確 quality gap。
- 不要先做完整 claim knowledge graph；先做三類 EvidenceClaim。
- 不要把 Radar 的主題庫、訂閱、全部分類一次搬過來。
- 不要再用單次漂亮 sample 取代 production 連續日驗證。

## 十、最終判定

### Backlog 方向是否能改善品質？

**能，而且前一輪方向大致正確。** 具名數字、thesis、連續性、viewpoints 與 IA 都是高槓桿改進，不需要推翻。

### 現在最需要補什麼？

從「功能型 backlog」轉成「品質系統 backlog」：availability、freshness、evidence、measurement 四個面向先補齊。尤其應把「資料來自 DB」與「語意正確」、「段落有 citation」與「claim 被 citation 支持」分開驗收。

### Agent 要不要重新切？

**要調 contract，不要大幅增加 agent。** Editor 拆規劃與狀態 proposal、Synthesizer 改 structured owner、Narrative Writer 成為唯一 prose owner、Viewpoints 加 evidence refs，再新增一個 read-only claim verifier，已足以解目前主要品質風險。

### Radar 最值得採用的概念？

不是首頁長相，而是：**事件聚類、訊號生命週期、首次／最後活動、相似歷史事件、主題時間軸與來源多樣性**。本 repo 已有 news tags、story dedup、storylines，可用低風險方式把這些概念產品化。
