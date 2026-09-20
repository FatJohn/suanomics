# 品質量測方法論

## 這份文件回答什麼

這個 repo 的每日產出（一份總經分析報告）沒有單元測試能斷言「今天這篇比昨天好」——深度、可讀性、grounding 這些維度沒有標準答案。取而代之的是一組人工跑的量測工具：兩兩比較（pairwise）judge、對固定歷史樣本做回歸偵測（canary）、換 model 前的 A/B、claim ledger 的機械可追溯性檢查。這些工具全部離線、全部不接每日生產鏈——`daily-brief` job 不會呼叫 judge，報告不會因為評分低而被擋下來（見 [README「這個專案有什麼不常見的」](../../README.md)）。

這份文件回答四個問題：這裡有哪些量測工具、各自量什麼；換一個 model 或改一支 prompt 該跑哪一支、要準備什麼、大約花多少 LLM 呼叫；輸出落在哪、怎麼判讀；以及這些工具**不能**證明什麼。方法論的詞彙（judge、pairwise、canary、雜訊底線）另見 [orientation 附錄詞彙表](orientation.md#附錄完整詞彙表)。

跑這裡列的任何工具都會花真實的 LLM 呼叫與費用；本文件本身不執行任何指令，所有數字與行為都以程式碼與其註解為準，逐項標出出處。

報告品質的量測概念上分兩半（[orientation 第 6 節](orientation.md)）：**機械的那半**可以自動判——報告裡每個數字能不能追回它的來源、有沒有出現投信投顧法禁用字眼、版面在各斷點有沒有壞，這些有明確對錯，走的是一般測試與稽核腳本（合規與引用的完整規則見 [Compliance 與 Citations](compliance-and-citations.md)）。**主觀的那半**沒有對錯、只有比較——深度、可讀性、跨日連續性這些維度找不到標準答案，本文件要講的就是量這一半的工具。

## 工具總表

量測程式碼住在 [`apps/server/tools/eval/`](../../apps/server/tools/eval)（judge、pairwise、canary、claim 指標、model-ab 分析原語），CLI 入口住在 [`apps/server/tools/cli/`](../../apps/server/tools/cli)；分工判準見 [module-map「量測程式碼只有一個家」](module-map.md)。是否需要在開跑前確認呼叫量閘門（`gated`），以 [`apps/server/tools/ci/llm-cli-manifest.ts`](../../apps/server/tools/ci/llm-cli-manifest.ts) 的登記為準——那份清單本身有測試機械核對每支腳本是否真的呼叫了 `enforceLlmRunBudget(`。

| `pnpm` 指令 | 回答什麼問題 | 輸入 | 打幾次 LLM（依據） | 輸出落點 | 閘門 |
|---|---|---|---|---|---|
| `brief:quality` | 兩版 brief 誰的深度／可讀性／grounding 更好 | `-a`／`-b` 兩份 brief JSON；grounding 事實底本可選 `--date`（查本機 DB）或 `--sources` 檔案 | 固定 2 次（[`quality-judge.ts:65-66`](../../apps/server/tools/eval/quality-judge.ts)，兩個 orientation 各一次） | `.eval-out/compare-<labelA>-vs-<labelB>.md` | 否（[manifest](../../apps/server/tools/ci/llm-cli-manifest.ts) 標 `single`，固定次數不隨輸入膨脹） |
| `brief:continuity` | 兩份「今日」brief 相對「昨日」誰的跨日連續性更好 | `--prev`（昨日）、`--today-a`、`--today-b` 三份 brief JSON | 固定 2 次（[`continuity-judge.ts:63-64`](../../apps/server/tools/eval/continuity-judge.ts)） | `.eval-out/continuity-<labelA>-vs-<labelB>.md` | 否（固定次數） |
| `brief:canary` | 對固定歷史樣本做 content-ablation：拿掉 `dailyThesis`／`viewpoints` 是變好還變壞 | canary fixtures（見下節）；可選 `--date` 限單日 | canary 日期數 × 2（[`llm-run-estimates.ts` `estimateBriefCanary`](../../apps/server/tools/cli/lib/llm-run-estimates.ts)） | `.eval-out/canary-<date>.md`，可選 `--trend` 附加趨勢日誌一列 | 是 |
| `brief:rerun` | 用「現在的」pipeline 對某天重新產一份 brief，只落檔不寫 DB，供上述工具事後比較 | `--date`、`--out`、可選 `--replicates` | `--replicates` × 單一 job 硬上限 `MAX_LLM_CALLS_PER_JOB=150`（[`fanout-concurrency.ts:109`](../../apps/server/src/agents/fanout-concurrency.ts)）為估算上界；實測每份 22–32 次（[`llm-run-estimates.ts` 註解，2026-09-08](../../apps/server/tools/cli/lib/llm-run-estimates.ts)、[README「成本」](../../README.md)） | `<out>/<date>/<label>-<replicate>/{brief,sources,meta}.json` | 是 |
| `model:ab <agent>` | 換 model（`entity-summary`／`news-tagger`／`viewpoints-debate`）前的迴歸：跨臂差異是否超出模型自身雜訊 | 受測 agent 名、`--model-a`／`--model-b`、`--replicates`（預設 2） | 依受測 agent 各自的 `estimateCalls`（[`model-ab/targets.ts` `TARGETS`](../../apps/server/tools/eval/model-ab/targets.ts)）；`--analyze`／`--probe` 不打真 LLM | stdout 報表；每一跑另落 `.eval-out/model-ab/<agent>/<label>.json` | 是（`--analyze`／`--probe` 除外） |
| `ledger:ab` | narrative 有沒有消費 claim ledger：讀者面數字的可追溯率 A/B | canary fixtures；可選 `--dates`、`--limit` | 新聞則數（三臂共用一次分析）× 4（decomposer 1 ＋ analyst-tier1 幻覺重試上限 3）＋ 日期數 × 9（synthesizer 合規重試上限 3 ＋ narrative-writer 三臂 A1/A2/B 各最多 2 次嘗試）（[`llm-run-estimates.ts` `estimateNarrativeLedgerAb`](../../apps/server/tools/cli/lib/llm-run-estimates.ts)） | `.eval-out/ledger-ab/{<date>-<arm>.json, <date>-sources.json, results-<stamp>.json, report-<stamp>.md}` | 是 |
| `claim:yield` | analyst-tier1 開啟 claim 產出旗標後，六項 grounding／D1–D7 指標長什麼樣 | canary fixtures；可選 `--dates`、`--limit` | 新聞則數 × 1（decomposer，兩臂共用）＋ 新聞則數 × 2 臂 × 3（analyst-tier1 幻覺重試上限，兩臂各跑一次）（[`llm-run-estimates.ts` `estimateClaimYieldSmoke`](../../apps/server/tools/cli/lib/llm-run-estimates.ts)） | `.eval-out/<YYYY-MM-DD>-claim-yield-output.txt`（[`claim-yield-output-path.ts`](../../apps/server/tools/cli/lib/claim-yield-output-path.ts)，撞名不覆蓋、改帶序號） | 是 |
| `storyline:continuity-ab` | 餵 storyline 素材前後，敘事的跨日連續性機制有沒有動起來（手構情境，非端到端真實新聞） | 無（情境與新聞寫死在腳本內） | 固定：兩版（stateless／storyline）各一次 synthesizer（含最多 3 次合規重試）＋各一次 narrative-writer（最多 2 次嘗試）＋固定 2 次 continuity-judge | `.eval-out/storyline-ab/{today-stateless.json, today-storyline.json, continuity-stateless-vs-storyline.md}` | 否（`single`，固定次數） |
| `prod:ledger-metrics --briefs <dir>` | 用**真實 prod brief**（非 canary）量 traceability 與 unsupported fact claim 的分佈，給前面幾個工具的閾值定基準 | 目錄下的 brief JSON（撈取方式由部署者自備，repo 不附撈取腳本，見 [`prod-ledger-metrics.ts` 檔頭](../../apps/server/tools/cli/prod-ledger-metrics.ts)） | 0（純讀檔，[manifest](../../apps/server/tools/ci/llm-cli-manifest.ts) 標 `no-llm`） | stdout markdown 表 | 不適用 |
| `pnpm exec tsx tools/cli/viewpoints-smoke.ts <brief.json> [runs]`（無專屬 `pnpm` script，見[`viewpoints-smoke.ts` 檔頭用法](../../apps/server/tools/cli/viewpoints-smoke.ts)） | 餵 claim ledger 給 viewpoints-debate 前後，反向論點覆蓋率有沒有變 | 一份含 `claimLedger` 的 brief JSON、`runs`（預設 2） | `runs × 2` 臂 × 3 通（support/risk/net-read）（[`llm-run-estimates.ts` `estimateViewpointsSmoke`](../../apps/server/tools/cli/lib/llm-run-estimates.ts)） | stdout（未落檔） | 是 |

`fixtures:check-canary`（[`canary-ticker-check.ts`](../../apps/server/tools/cli/canary-ticker-check.ts)）不在上表：它不是品質量測，是 canary-example fixture 的資料衛生檢查（查 TWSE `codeQuery` 端點，擋掉虛構 ticker 撞到真實證券），見下方「canary」一節。

另外幾支沒列進上表的 CLI（[manifest](../../apps/server/tools/ci/llm-cli-manifest.ts) 裡 `shape: 'single'` 的兩支與 `shape: 'no-llm'` 的一支）同樣算廣義的量測工具，但沒有量化的判定邏輯、只印產出供人工讀，所以不列進上表：`narrative-smoke.ts`（單一輸入跑一次 `narrative-writer`，供人工檢視 prompt 改動後的實際文字產出）、`cross-signal-smoke.ts`（見下節「這套量測不能證明什麼」）、`nasdaq-overlay-smoke.ts`（純市場資料疊圖檢查，不打 LLM）。

### 執行前提

上表大多數工具都要打真實 LLM，需要 `GEMINI_API_KEY`——`brief:rerun`、`ledger:ab`、`claim:yield`、`model:ab`（非 `--analyze`／`--probe`）、`storyline:continuity-ab` 開跑前都會呼叫 [`smoke-args.ts` `requireGeminiKeyOrExit`](../../apps/server/tools/cli/lib/smoke-args.ts) 明確擋下缺 key 的情況；`brief:quality`／`brief:continuity` 沒有這道前置檢查，`viewpoints-smoke.ts` 也沒有，缺 key 時會在真的呼叫 `callAgentLLM` 時才失敗。

Postgres 只有兩種情況會用到：`brief:quality` 給了 `--date` 時（撈本機 DB 的 `news_items`／`external_articles`／`daily_briefs` 組事實底本，見下節）；`brief:rerun` 本身呼叫 `generateDailyBrief` 需要完整資料層（新聞、市場數據）。其餘吃 canary fixtures 的工具（`brief:canary`／`claim:yield`／`ledger:ab`／`model:ab`）刻意解耦 DB，只讀 [`fixtures/canary/`](../../apps/server/tools/eval/fixtures) 或 `canary-example/` 底下的 JSON——這是 canary 這條線的設計前提，不是巧合（見 [`canary-fixtures.ts`](../../apps/server/tools/eval/canary-fixtures.ts)）。`storyline:continuity-ab` 也不碰 DB，但用的是另一組手構情境與 [`fixtures/continuity/prev.json`](../../apps/server/tools/eval/fixtures/continuity/prev.json) 基準線，不經過 `canary-fixtures.ts`，見下方該節說明。

### 測試涵蓋到哪裡

`eval/` 底下的純函式（`pairwise.ts`／`quality-judge.ts`／`canary-fixtures.ts`／`ledger-traceability.ts`／`model-ab/*` 等）都有對應的 `*.test.ts`，隨 `pnpm -r test` 一起跑；這正是 [module-map](module-map.md) 那條「拿掉 CLI 之後這段還有沒有意義」判準的直接後果——有意義才進 `eval/`、才可能被單元測試住。CLI 主檔本身（會真的呼叫 agent／LLM 的那段）不在 `pnpm -r test` 的覆蓋範圍內，而是靠 `pnpm type-check`（`tsc --noEmit -p apps/server/tsconfig.tools.json`，該設定檔的 `include` 明確涵蓋 `tools/**/*`）做型別層面的把關。呼叫量估算的係數（`llm-run-estimates.ts` 裡那些 `CALLS_PER_*` 常數）則是用真的 production 函式加 mock `callAgentLLM` 鎖住的：改任何一個 agent 的 retry／attempt 上限而沒同步改這裡，對應測試會紅，係數不會悄悄與實際行為脫鉤。

### 趨勢日誌

`brief:quality`／`brief:continuity`／`brief:canary` 都有 `--trend <path>` 選項，會把本次三維勝負摘要 append 一列到指定的日誌檔（[`trend-log.ts` `appendTrendRow`](../../apps/server/tools/eval/trend-log.ts)）；檔案不存在時自動補表頭。這是純追加的落檔動作，不做任何判讀——orientation 的說法是「量測工具跑完會自己 append 一列，人再回頭補上判讀。工具建了但沒人記錄，等於沒有」（[orientation 第 6 節](orientation.md)）。這份日誌不隨公開 repo 附帶內容，路徑與是否要記錄由使用者自行決定。

## pairwise judge 怎麼運作

`brief:quality` 與 `brief:continuity` 共用同一套核心（[`pairwise.ts`](../../apps/server/tools/eval/pairwise.ts)），只是輸入內容不同（[`quality-judge.ts`](../../apps/server/tools/eval/quality-judge.ts) vs [`continuity-judge.ts`](../../apps/server/tools/eval/continuity-judge.ts)）。用兩兩比較而不是絕對評分，是因為深度、可讀性這類維度的絕對評分容易飽和——兩版都給 4 分時得不到訊號（[orientation 第 6 節](orientation.md)）；pairwise 只問「這兩份裡哪一份更好」。

**位置偏誤控制**：每次比較都跑兩個 orientation——orientation 1 把 A 放在「甲」、orientation 2 把 B 放在「甲」（[`quality-judge.ts` `runQualityCompare`](../../apps/server/tools/eval/quality-judge.ts)、[`continuity-judge.ts` `runContinuityCompare`](../../apps/server/tools/eval/continuity-judge.ts)）。兩次判定經 [`pairwise.ts` `mapWinner`](../../apps/server/tools/eval/pairwise.ts) 映回 A/B 座標系後，用 [`aggregateDim`](../../apps/server/tools/eval/pairwise.ts) 聚合：兩次同向判 A 贏才算 A 贏，矛盾或任一次判「相當」一律記為 tie。這代表每次比較固定要花 2 次 judge 呼叫，不是 1 次。

**judge 用哪個 model、為什麼不隨主 pipeline換**：三個 judge（`brief-judge`／`brief-quality-judge`／`brief-continuity-judge`）在 [`resolve.ts` 的 `AGENT_MODEL_DEFAULTS`](../../apps/server/src/agents/providers/resolve.ts) 裡刻意都固定在 `gemini-3.5-flash`，主 pipeline 六個 agent 換過幾次 model 都沒動它們：「它們是量尺本身。換掉量尺會讓品質趨勢日誌的歷史列不可比，而且改 judge model 有它自己的程序」（見同檔第 59–60 行的註解）。

**`brief:quality` 的 grounding 事實底本怎麼組**：`buildSourceBase`（[`brief-quality.ts`](../../apps/server/tools/cli/brief-quality.ts)）依給的旗標分四種行為——`--sources <path>` 給了就直接用檔案內容（不查 DB）；只給 `--date` 則撈本機 DB：兩臂各自引用過的新聞（citation URL／`newsTitlesById`）∪ 當日 `daily_briefs.selectedNewsIds` 選稿，citation URL 若不在 `news_items`（Cascade 檢索的來源）則改查 `external_articles`，市場快照另外附加成一則「新聞」（[`quality-source-base.ts` `snapshotSourceArticle`](../../apps/server/tools/eval/quality-source-base.ts)）；`--date` 與 `--sources` 都給則新聞底本用檔案、快照仍附加；兩者都沒給則底本為空、grounding 維度沒有東西可比對，函式會印警告明講這個維度的判定不可信。

## 同臂雜訊底線

`model:ab` 的核心規則寫在 [`model-ab/arms.ts`](../../apps/server/tools/eval/model-ab/arms.ts) 檔頭：**每臂預設跑兩次**（`DEFAULT_REPLICATES = 2`），標籤是 `A1`／`A2`／`B1`／`B2`（[`model-ab/types.ts`](../../apps/server/tools/eval/model-ab/types.ts) 的 `RunFile.label`）。理由是同一個 model 自己跑兩次也會有差異（同臂雜訊）；跨臂（A vs B）的差異必須超過同臂雜訊，才有資格說「這是 model 差異，不是模型自身抖動」。`model-ab/arms.ts` 註解記載過一次反例：只跑單跑資料時判出某個方向的結論，補上同臂雙跑對照組後改用「兩跑都一致的分歧」重判，結論方向完全相反——這正是 `planArms` 把雙跑當預設、而不是選用旗標的原因。

`armsWithoutBaseline`／`assessSignal`（同檔）把這條規則變成機械判定：任一臂只跑一次就回 `no-baseline`，報表不准印可下結論的判定；同臂一致率低於 `UNSTABLE_BASELINE_MAX = 0.5` 回 `unstable-baseline`（這條路徑量不出 model 差異）；否則比較跨臂平均一致率與同臂雜訊底線（兩臂較低的那個，取保守值），跨臂低於底線才是 `exceeds-noise`——但這不等於哪一臂比較好，重疊率只量一致性、不判對錯，要回去讀原文質性抽查（[`model-ab/report.ts` `verdictRows`](../../apps/server/tools/eval/model-ab/report.ts)）。

`viewpoints-debate` 這類 `prose` 模式的 agent 沒有結構化輸出可算機械指標，`renderProseReport`（[`model-ab/report.ts`](../../apps/server/tools/eval/model-ab/report.ts)）走同一道 `armsWithoutBaseline` 閘門：缺同臂對照組時，連跨臂那條 `brief:quality` 指令都不印，逼使用者先看 judge 自己的雜訊（同臂雙跑對打）再看跨臂訊號。`ledger:ab` 的三臂設計（`A1`／`A2` 旗標開、`B` 旗標關）也是同一套邏輯的應用，見 [`narrative-ledger-ab.ts` 檔頭](../../apps/server/tools/cli/narrative-ledger-ab.ts) 與 [`ledger-ab-report.ts` `pairedDaily`](../../apps/server/tools/eval/ledger-ab-report.ts)：判定用「逐日配對」而非彙總比例，因為彙總會被分母大的那一天主導、把逐日一致的效果稀釋掉；`verdict` 函式用單側符號檢定（`0.5^n`）估計「A 是不是每天都贏」純屬巧合的機率，且明講字面上不指定方向的「全同向」機率是這個值的兩倍。

### `model:ab` 目前登記的三個受測 agent

`model:ab` 不是萬用工具，只認 [`model-ab/targets.ts` `TARGETS`](../../apps/server/tools/eval/model-ab/targets.ts) 裡登記過的 agent；新增一個受測 agent，`estimateCalls`／`estimatePeak` 是型別強制要補的欄位，不會被漏掉。

| agent 別名 | 受測對象 | 模式 | 分歧量尺 | 輸入 |
|---|---|---|---|---|
| `entity-summary` | `corpus-entity-summary` | `structured` | entity Jaccard（寬鬆別名比對） | canary 新聞去重後取樣（`--samples`） |
| `news-tagger` | `news-tagger` | `structured` | tag Jaccard | 同上，每 15 則一批呼叫 |
| `viewpoints-debate` | `viewpoints-debate` | `prose` | 無機械指標，只能交 `brief:quality` pairwise | canary 各日期的 `brief.json`（`--dates`） |

`structured` 模式（`entity-summary`／`news-tagger`）的輸出是抽取式的結構化資料，兩兩比對能算出 Jaccard 相似度當機械分歧量尺；`prose` 模式（`viewpoints-debate`）的輸出是自由文字，量不到機械指標，只能把兩份產物再餵進 `brief:quality` 讓 judge 比。

## canary

canary 是「固定幾天的真實歷史輸入，當作改動前後的標準題目」（[orientation 詞彙表](orientation.md#附錄完整詞彙表)）。`resolveCanaryDir`（[`canary-fixtures.ts`](../../apps/server/tools/eval/canary-fixtures.ts)）決定四支消費腳本（`brief:canary`／`claim:yield`／`ledger:ab`／`model:ab`）要讀哪一組：真實 fixtures（七天主流財經媒體新聞全文，受版權限制不隨公開 repo 發佈）優先，不存在就退版到合成的 [`fixtures/canary-example/`](../../apps/server/tools/eval/fixtures/canary-example)。

這個退版是**靜默的**：拿合成新聞跑 pairwise 或 claim 產出率，程式不會報錯、數字照印，格式與真樣本跑出來的報告一模一樣。為了不讓外部使用者在毫無警訊下把虛構新聞當量測基準，`CANARY_KIND` 會被 `canaryExampleNotice()`（印在 stderr）與 `canaryExampleBanner()`（落進報告檔本身開頭）兩處攔截，見 [`canary-fixtures.ts`](../../apps/server/tools/eval/canary-fixtures.ts)。

`canary-example/` 的兩天資料（`2026-03-02`、`2026-03-03`）是完全虛構的合成資料——公司名、財報數字、法說會內容全部編造，任何雷同純屬巧合（[`fixtures/canary-example/README.md`](../../apps/server/tools/eval/fixtures/canary-example/README.md)）。它存在的目的只有三個：看得懂 fixture 的資料形狀（`sources.json`／`brief.json` 的欄位）、能實際跑一次四支腳本觀察 pipeline 流程與輸出格式、理解 `MarketBriefSchema` 各欄位如何互相引用。**它不能拿來當量測基準**——深度／可讀性／grounding 的判定對這個專案本身沒有任何參考價值，只證明腳本能跑完、輸出格式正確。真正有意義的量測結果一律以真實 canary fixtures 跑出來的數字為準；那組真實資料只存在於維護者自己的環境，不隨這個公開 repo 發佈。

增補 fixture 時的 ticker 安全性靠 `fixtures:check-canary`（[`canary-ticker-check.ts`](../../apps/server/tools/cli/canary-ticker-check.ts)）機械查核，README 明白說明**沒有安全區段**可以憑經驗判斷、必須實查：這支會遞迴掃整個 `canary-example/` 目錄底下 JSON 的 ticker 欄位，逐一查 TWSE `codeQuery` 端點，撞到真實證券就 `exit(1)`。它刻意不進 CI（依賴外部服務可用性）。公司名與媒體名沒有自動檢查——散文內容（`contentText`／`narrative`／`summary`）不在這支的掃描範圍內，純靠人眼把關（同一份 README）。

### `storyline:continuity-ab`：不靠 canary 的另一種早期訊號 harness

這支不讀 canary fixtures，也不靠真實多日新聞：它在同一份手構的「今日」情境上，用真的 `narrative-writer` 與 `synthesizer` 各生一版 brief——stateless（不餵 storyline 素材）vs storyline（餵 enriched block ＋ hint）——再用 `brief:continuity` 那把尺對照，以 [`fixtures/continuity/prev.json`](../../apps/server/tools/eval/fixtures/continuity/prev.json) 當昨日基準線（[`storyline-continuity-ab.ts` 檔頭](../../apps/server/tools/cli/storyline-continuity-ab.ts)）。情境是手構的**成熟弧**（腳本內寫死兩條主線：能源與油價、半導體出口管制，各自在「今日」給一則延續訊號），用意是驗「機制」——narrative-writer 拿到修好的弧，會不會真的寫出論點演進與伏筆兌現——不是驗「真實多日新聞會不會自然長出這種弧」；後者要等 storyline 素材在 prod 累積出真實的多日弧之後，才能用同一把尺跑。

## claim ledger 指標

claim ledger 是「一份報告裡所有 claim 的集合，供追溯與稽核」（[orientation 詞彙表](orientation.md#附錄完整詞彙表)）。每條 claim 在發佈前會跑過七道機械檢查 D1–D7（[`packages/shared/src/evidence-checks.ts` `runDeterministicChecks`](../../packages/shared/src/evidence-checks.ts)）：

| Check | 量什麼 |
|---|---|
| D2 | citation 類型的 evidenceRef，其 url 是否真的在 `brief.citations` 裡；沒過就把該 ref 移除 |
| D3 | series 類型的 evidenceRef，`(seriesId, asOf)` 是否真的在當日快照裡逐字相等（不做鄰近日回退）；沒過同樣移除 |
| D1 | `kind: 'fact'` 的 claim，經 D2／D3 過濾後是否仍有 ≥1 個 evidenceRef |
| D4 | `claimType: 'named-number'` 的 claim，其具名數字是否在 evidence 中找得到對應值 |
| D5 | `claimType: 'dated-event'` 的 claim，其日期是否在 evidence 中找得到 |
| D6 | 句型（是否帶臆測詞／條件詞）與自報的 `kind` 是否一致；不一致時**改判 kind**而非刪句 |
| D7 | 是否命中投信投顧法禁用字眼；命中交既有 compliance 處置 |

D4／D5 失敗的處置是「不得以 fact 發佈」：`kind` 會被強制降為 `inference`（`demote` 函式，同檔）。這七項全是**機械檢查**——比對數字、日期、url、句型關鍵詞——不判斷因果或語意是否正確；`claim-yield-smoke.ts` 的報告檔頭明講「不能證明 claim 的語意正確：D1–D7 全是機械檢查，因果對不對要另外驗證」（[`claim-yield-smoke.ts`](../../apps/server/tools/cli/claim-yield-smoke.ts)）。

D2／D3 的統計刻意分「適用（applicable）」與「通過（passed）」兩態，不是單純的通過／不通過（[`ledger-traceability.ts` `measureRefChecks`](../../apps/server/tools/eval/ledger-traceability.ts)）：一條 claim 沒有 series 類型的 evidenceRef，D3 對它就是「不適用」而非「通過」——把不適用算成通過，一個完全沒有 ref 的 claim 會拿到一份看起來很乾淨的成績單。`ledger:ab` 的報告會同時印 D2／D3 的適用數、通過數與被濾掉的 ref 數，因為這兩項淘汰數目前多半是 0，一旦哪天出現非零的淘汰數，代表模型開始產生幻覺 url 或不存在的序列 id，數字本身就是要盯的訊號。

**追溯率（①）不是結案指標，binding 才是**：`prod:ledger-metrics` 同時報兩個看起來相似但語意不同的數字。① 問的是「這個數字在整個 ledger 池裡找不找得到」；`checkNarrativeClaimBinding`（[`narrative-claim-binding.ts`](../../apps/server/src/agents/narrative-claim-binding.ts)）問的是「這個數字是不是該段自己 `claimIds` 掛的那幾條 claim 給的」——同檔註解記載一個真實 prod 案例：narrative 把單日值 `-429` 寫成「全週累積」、與五日加總正負號相反，但那三條相關 claim 從未被任何段落引用過，① 依然判 97.6% matched（能對回池子，不代表用對了）。所以 `prod:ledger-metrics` 把①標成「參考值、不是 gate」，binding unbound 比例才是它的結案指標；binding 只涵蓋 `narrative.sections`（`heading`／`body`／`takeaway`），`headline`／`summary`／`reasoningChain` 沒有 `claimIds` 掛載點，同類錯誤若發生在那些欄位，這個數字看不見（見 [`prod-ledger-metrics.ts`](../../apps/server/tools/cli/prod-ledger-metrics.ts) 檔尾「限制」段落）。binding 也擋不住語意改寫：claim 若真的有掛進本段，narrative 仍可能改寫它的時間口徑而數字照樣對得回去。

**traceability**（追溯率）另外量的是讀者看到的成品面（`headline`／`summary`／`reasoningChain`／`narrative`／`viewpoints`）裡的具名數字，有多少能數值比對回一條 ledger claim（[`ledger-traceability.ts` `measureTraceability`](../../apps/server/tools/eval/ledger-traceability.ts)）。比對刻意用數值級的 `closeEnough`、不用字串包含——`includes('23150')` 會誤中 `'231500'`，而讀者面與 claim 兩邊的千分位、全形寫法本來就不保證一致。`unsupportedFactClaims`（`kind: 'fact'` 但 `evidenceRefs` 為空）是這條 ledger 裡「完全沒有依據的事實陳述」的計數，`prod:ledger-metrics` 拿它與 traceability 一起，對真實 prod brief（不是 canary）算分佈，作為前面幾個工具判斷閾值的參考基準。

## 常用旗標與防呆設計

- **`model:ab --analyze`**：不打 API，只重讀已存的 run 檔（[`model-ab.ts` `collectRuns`](../../apps/server/tools/cli/model-ab.ts)）重算指標——改了報表算法但不想重跑真 LLM 時用。
- **`model:ab --probe`**：不算 A/B，只直接打 API 問兩個 model 名稱各自的 `modelVersion`，確認它們是不同的真實 backend、不是同一個 alias（[`model-ab/targets.ts` `probeModelVersions`](../../apps/server/tools/eval/model-ab/targets.ts)）；這支只認 Gemini，讀的是 Gemini 回應裡的 `modelVersion` 欄位，換 provider 換不掉。
- **`model:ab --concurrency`**：只對 `entity-summary`（`pMap` 平行跑）有意義，其餘 target 忽略它；各臂之間仍是序列跑，因為共用同一把 Gemini key，兩臂平行會撞 RPM 限制。
- **`ledger:ab --render <results-*.json>`**：不打 LLM，只用既有 `results-<stamp>.json` 重畫報告——報告的判讀邏輯之後可能會改，原始資料留著就不必為了換算法重跑一次要花錢的 LLM。輸出檔名由輸入檔名機械推導（`results-X.json` → `report-X.md`），檔名不符 `results-*.json` 格式就拒絕執行，避免把報告誤寫回原始資料檔（[`narrative-ledger-ab.ts` `renderOnly`](../../apps/server/tools/cli/narrative-ledger-ab.ts)）。
- **`brief:rerun` 的覆寫防呆**：`generateReplicateToFiles` 在呼叫 `generateDailyBrief` 之前就先檢查輸出目錄是否已存在，存在就丟 `RerunDirExistsError`、`exit(1)`（fail-fast，不浪費一次 LLM 呼叫）；非應產日（週六／假日）呼叫端會收到 `RerunSkippedError`、`exit(2)`（[`brief-rerun.ts`](../../apps/server/tools/cli/brief-rerun.ts)）。這支腳本刻意只落檔、絕不寫 DB——正式路徑的 `saveDailyBrief` 是對 `brief_date` 做 upsert，走它重跑會直接覆蓋當天原本的 brief，讓「重跑」與「保留原版供比較」互斥。
- **`claim:yield` 的輸出防呆**：輸出檔名帶執行當天的台北日期（`<YYYY-MM-DD>-claim-yield-output.txt`），撞名時 `freeOutPath` 改用帶序號的檔名、絕不覆蓋（[`claim-yield-output-path.ts`](../../apps/server/tools/cli/lib/claim-yield-output-path.ts)）——這支一次要跑約 45 分鐘、花約 $2.7，寫檔失敗比覆蓋更糟。
- **`viewpoints-smoke.ts` 的亂碼偵測**：用 CJK 擴充 A 區（Unicode `U+3400` 至 `U+4DBF`）字元出現與否當 proxy，抓一種「通過 schema 與 compliance gate、但夾雜壞字」的輸出異常（[`viewpoints-smoke.ts` `mojibakeLines`](../../apps/server/tools/cli/viewpoints-smoke.ts)）；這只是下界，落在常用中日文字區的壞字它抓不到。它同時分開報「挑戰側覆蓋率」與「全文覆蓋率」——後者會把支持側也算進去，而支持側本來就容易撿到與論點同方向的數字，稀釋掉「反向事實有沒有真的被撿起」這個真正要問的問題。

## 成本與安全

單份 daily brief 實測 22–32 次 LLM 呼叫，有效全域並行尖峰 9（`effectiveLlmPeak()`），單一 job 的呼叫數硬上限 `MAX_LLM_CALLS_PER_JOB=150`（[`fanout-concurrency.ts`](../../apps/server/src/agents/fanout-concurrency.ts)），完整說明見 [README「成本」](../../README.md#成本) 與 [configuration「並行與呼叫量上限」](configuration.md#並行與呼叫量上限)。這幾層防線只擋單一 job 或單一 process 內失控，**擋不住跨 job 累積**——repo 內沒有機制會擋連續手動跑多次評測腳本的總量，那要到 provider 端自己設（[configuration「跨 job 累積」](configuration.md#跨-job-累積repo-內沒有防線要到-provider-端設)）。

本文列出的批次腳本裡，凡是 [`llm-cli-manifest.ts`](../../apps/server/tools/ci/llm-cli-manifest.ts) 標 `gated: true` 的，開跑前都會呼叫 `enforceLlmRunBudget`（[`llm-run-budget.ts`](../../apps/server/tools/cli/lib/llm-run-budget.ts)）先估算這次會打幾次 LLM：預估總呼叫數超過 `MAX_SAFE_LLM_CALLS_PER_RUN=500` 或尖峰並行超過 `MAX_SAFE_LLM_PEAK=10`（兩者都定義在 [`fanout-concurrency.ts`](../../apps/server/src/agents/fanout-concurrency.ts)）就要求加 `--yes` 才會執行，否則 `exit(3)`。這個估算只看單次執行，不跨次累計。`shape: 'single'`（如 `brief:quality`、`brief:continuity`、`storyline:continuity-ab`）不受這道閘門管，因為呼叫數固定、不隨輸入量線性膨脹；目前 manifest 裡 `shape: 'batch'` 的腳本全部是 `gated: true`；manifest 的守門測試會機械核對這一欄，日後新增批次腳本時以 manifest 為準，不要以本文為準。

## 量測工具本身踩過的失敗模式

量測工具最危險的失敗模式不是「跑不動」——跑不動會被發現。真正危險的是**跑完了、數字看起來合理，但量到的是錯的東西**。orientation 記錄了幾個實際發生過的案例（[orientation 第 6 節](orientation.md)），這裡摘要成寫量測程式碼時該留意的具體形狀：

- **方向算反**：把支持某個結論的證據算成反向的證據——分子分母都對，方向錯了。
- **單位盲**：裸比數值會把「產能提升 30%」與「逾 30 萬顆」判成同一個 `30`。[`viewpoints-coverage.ts` `extractScaledNumbers`](../../apps/server/tools/eval/viewpoints-coverage.ts) 就是為了堵這個洞而寫的——它拿既有數字抽取器的輸出當白名單，再自己補上「萬／億／兆」倍率與 `%` 單位比對；檔頭註解記載這個洞第一次咬人時，把 no-ledger 臂誤判成命中了一則與該臂文字內容完全無關的具名產能數字。
- **把能推翻自己結論的素材丟掉**：只印挑戰方的覆蓋率、不印支持方與淨讀，會讓「ledger 是否把報告推得更靠向論點本身」這個與量測動機相反的可能性被結構性地看不見（`viewpoints-smoke.ts` 因此把 support／risk／netRead 逐行落檔，見上節）。
- **量測期間程式被改動**：量測還在跑，同時有人改到被量測的那段程式，量到的就不是任何一個穩定版本的行為。
- **用錯量尺**：`brief:canary` 是拿既有報告做 content-ablation、不重跑 pipeline，所以改 prompt 它完全量不到——跑起來一片綠，但什麼都沒驗到（見下節第一條）。

這些案例幾乎都是由一個沒有前情脈絡的複查者抓出來的，寫的人自己看不到，因為他知道答案——這是這個專案「驗收不由製作者自己做」這條紀律的直接來源。

## 這套量測不能證明什麼

- **不能證明語意正確**。claim ledger 的 D1–D7 全是機械檢查（比對數字、日期、url、句型關鍵詞），因果推論對不對要另外驗證（[`claim-yield-smoke.ts` 檔頭](../../apps/server/tools/cli/claim-yield-smoke.ts)）。
- **序列與官方公告都是固定 fixture，不是情境當天的真實資料**。`claim-metrics.ts` 的 `LATEST` 序列快照與 `official-fixture.ts` 的官方公告都取材自特定歷史日期，套用到 canary 或情境日時只是「偏移錨定」，不是「該日真正發生的事」——所以「模型會不會引用、引用時有沒有扭曲」量得到，「該日真正的行情或公告」量不到；序列引用率與 D4 通過率都是**下限**（見 [`claim-metrics.ts`](../../apps/server/tools/eval/claim-metrics.ts)、[`official-fixture.ts`](../../apps/server/tools/eval/official-fixture.ts) 的檔頭註解）。
- **`brief:canary` 量不到 prompt 改動**。它比對的是拿掉 `dailyThesis`／`viewpoints` 前後同一份既有 brief，不重跑 pipeline；改了 tier1 或 tier2 的 prompt 之後這支會照樣一片綠，因為它從未重新生成過內容（[configuration「證據追溯」一節](configuration.md#證據追溯claim-ledger旗標)）。要驗 prompt 改動的影響，得走 `brief:rerun` 或 `model:ab` 這類真的重新生成的工具。
- **`cross-signal-smoke.ts`（跨市場訊號 smoke，非本文主表所列，屬人工判讀工具而非 gate）的教訓具代表性**：它只印產出、不做斷言，檔頭明講「產出裡方向講對」不是證據——市場快照的原始表格本身就帶方向，模型不需要真的消費新注入的訊號小節也能講對方向；要能證明的是產出裡出現「只有注入的事實才有的資訊」（極性映射、組名這類指紋），而非表面方向對錯（[`cross-signal-smoke.ts`](../../apps/server/tools/cli/cross-signal-smoke.ts)）。
- **canary-example 的合成資料不能當量測基準**，任何用它跑出來的深度／可讀性／grounding 判定只證明腳本能跑完、格式正確（[`fixtures/canary-example/README.md`](../../apps/server/tools/eval/fixtures/canary-example/README.md)）。
- **重疊率不判對錯**。`model:ab` 的跨臂一致率只量兩個 model 的輸出有多相似，兩臂都抽錯同一個實體時重疊率照樣 100%（[`model-ab/report.ts`](../../apps/server/tools/eval/model-ab/report.ts)）。
- **canary 只涵蓋 tier1，不含 tier2、editor 的 `dailyThesis` 與 `viewpoints`**，`ledger:ab`／`claim:yield` 量出來的比例分母因此比 prod 窄（[`ledger-ab-report.ts` `renderArmReport`](../../apps/server/tools/eval/ledger-ab-report.ts) 的「這份量測不能證明什麼」段落）。

## 相關文件

| 想知道 | 去讀 |
|---|---|
| 這些詞（judge／pairwise／canary／雜訊底線／claim／ledger／追溯率）的完整詞彙表 | [orientation 附錄](orientation.md#附錄完整詞彙表) |
| 每個 agent 的 prompt 契約、model／provider 怎麼解析 | [Agents 與 Prompts](agents-and-prompts.md) |
| 投信投顧法禁用字眼與 citation 白名單規則 | [Compliance 與 Citations](compliance-and-citations.md) |
| 三層呼叫量節流的完整設計、環境變數細節 | [configuration](configuration.md) |
| `eval/` 與 `tools/cli/` 的分工判準、workspace 邊界 | [module-map](module-map.md) |
