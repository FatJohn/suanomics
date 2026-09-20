# 環境設定（apps/server）

[`apps/server/.env.example`](../../apps/server/.env.example) 是複製即用的範例：每個變數只留「要不要填、預設值是什麼」。本頁是它的背景說明——每個變數為什麼長這樣、啟動檢查怎麼分級、有哪些打錯字會被靜默吃掉。改 `.env.example` 或這裡任何一份說明時，先確認另一份有沒有同一句話要一起改。

## 啟動檢查與分級

server 啟動時跑一次 `checkStartupConfig`（[`packages/shared/src/startup-config.ts`](../../packages/shared/src/startup-config.ts)）：主線缺值 → `process.exit(1)`；次要缺值只大聲 log、服務照起。結果另外掛在 `GET /api/ops/config-health`（只回 key 名與影響，不回值）。三種失敗形狀（lazy throw、空字串照打、靜默換 provider）與這道檢查的完整設計理由見 [外部依賴盤點「設定層的失敗在啟動時就叫」](external-dependencies.md)。哪些變數屬於哪一級、部署時的最低限度組合，見 [部署「環境變數」](../operations/deploy.md#環境變數)。

## LLM provider 與 model 路由

`AGENT_MODELS` / `LLM_PROVIDER` / `AI_PROVIDER` 三個變數怎麼組合決定每個 agent 實際打哪個 provider、`provider/model` 的切法規則、Anthropic 靜默 fallback 與 OpenAI 硬錯誤的差異——完整規則與範例見 [Agents 與 Prompts「模型解析與 provider gate」](agents-and-prompts.md#模型解析與-provider-gate) 與 [「接自己的 LLM」](agents-and-prompts.md#接自己的-llm)。

**「缺金鑰」比「開關開了但沒生效」嚴格很多**：`AI_PROVIDER=anthropic` 且有 agent 會解析到 anthropic（`AGENT_MODELS` 指向 `claude*`，或 `LLM_PROVIDER=anthropic` 全域覆蓋）卻沒有 `ANTHROPIC_API_KEY` 時是 FATAL（`checkStartupConfig`，[`packages/shared/src/startup-config.ts`](../../packages/shared/src/startup-config.ts)）——這個組合下 `resolveAgentModel` 會靜默 fallback 回 Gemini，帳單與品質都變了卻沒人知道。反過來，只開 `AI_PROVIDER=anthropic`、沒有任何 agent 指向 `claude*` 也沒有 `LLM_PROVIDER=anthropic` 全域覆蓋時，容忍度高很多：不會擋啟動，只印一次「設定互相矛盾」的提醒——因為這個組合下一個 Claude 呼叫都不會發生，沒有帳單風險。`LLM_PROVIDER` 本身給不合法的值（不是 `gemini`／`anthropic`／`openai`）待遇一樣：忽略該值、印一次警告、不擋啟動（`defaultProviderFromEnv`，`resolve.ts`）。

**加新 model 記得先補價格**：把新 model 加進 `AGENT_MODEL_DEFAULTS` 或用 `AGENT_MODELS` 覆寫時，先在 [`pricing.ts`](../../apps/server/src/agents/providers/pricing.ts) 補上對應價格。沒補的話，Gemini／Anthropic 路徑會落到 `FALLBACK_PRICING`（保守估計價，比記 0 更貼近實際帳單，但仍可能算錯）；OpenAI 相容路徑的未知 model 直接記 $0 並印一次警告（自架／OpenRouter 的實際定價未知，這不是真的免費）。

**Transcript Tool 用另一套 model 變數，刻意不與上面共用**：`TRANSCRIPT_TOOL_MODEL`（未設時各檔內建 `gemini-3-flash-preview`）決定 [`packages/prompt-research`](../../packages/prompt-research) 的字幕／STT 處理用哪個 model；細粒度覆寫 `GEMINI_CONSOLIDATOR_MODEL`（consolidator 段）與 `GEMINI_STT_MODEL`（音訊轉逐字稿段）未設時各自退回 `TRANSCRIPT_TOOL_MODEL`。Cascade 的 15 個 agent 完全不吃這幾個變數——兩條線分開，是為了調其中一邊的 model 時不會暗中換掉另一邊。

**空字串賦值目前是安全的，不是陷阱**：Node 的 `--env-file` 會把 `KEY=`（沒填值）讀成空字串而不是 `undefined`，naive 的 `env.KEY ?? fallback` 接不住空字串。`OPENAI_API_KEY`／`OPENAI_BASE_URL`／`LLM_API_KEY`／`LLM_BASE_URL` 由 `readNonEmptyEnv`（[`apps/server/src/agents/providers/openai.ts`](../../apps/server/src/agents/providers/openai.ts)）統一做「trim 後非空才算有值」；`LLM_PROVIDER` 由 `defaultProviderFromEnv`（[`apps/server/src/agents/providers/resolve.ts`](../../apps/server/src/agents/providers/resolve.ts)）做同樣的 trim 檢查；`ANTHROPIC_API_KEY` 走純 truthiness 判斷，空字串一樣視為未設。四個變數目前留空或抄成 `KEY=` 都不會被誤當成「有值」。

## 證據追溯（Claim Ledger）旗標

`ANALYST_CLAIMS_ENABLED` 與 `NARRATIVE_LEDGER_ENABLED` 這兩個旗標在程式裡預設關閉、且 `checkStartupConfig` 不查它們——漏設不會 FATAL、不會 DEGRADED、不會有任何一行 log，報告照樣每天產得出來，只是敘事裡的數字全部掛不上證據。兩者的前提關係、影響範圍與一次本機量測（開／關兩種狀態下 ledger 條數與 unbound 數字的對照）見 [部署「環境變數」](../operations/deploy.md#環境變數)。相關程式碼：ledger 建構於 [`packages/shared/src/evidence-ledger.ts`](../../packages/shared/src/evidence-ledger.ts)，綁定檢查在 `narrative-claim-binding.ts`（[`apps/server/src/agents/`](../../apps/server/src/agents/narrative-claim-binding.ts)），引用到不存在的 claim id 由 `narrative-writer.normalize.ts` 剝掉。

`ANALYST_CLAIMS_ENABLED` 不只是「多印一個欄位」：analyst tier-1 是敘事裡 `mechanism`／`primaryImpact` 的主要寫手，開關它會改變送進 tier-1 的 prompt 內容，進而改變每日報告的實際文字。canary 回歸測試量不到這種 prompt 改動的影響——`brief-canary.ts`（[`apps/server/tools/cli/brief-canary.ts`](../../apps/server/tools/cli/brief-canary.ts)）對固定 fixture 跑的是 full brief 與「拿掉 `dailyThesis`／`viewpoints`」兩版（`ablateBrief`，[`apps/server/tools/eval/canary.ts`](../../apps/server/tools/eval/canary.ts)）的 pairwise 品質評審，量的是這兩個區塊本身對 judge 判定的貢獻，不是「這次改了 prompt 之後品質有沒有變」——要驗證這個旗標翻動後的影響，得靠開／關兩臂各自跑出 prose 後人工對照，不能只看 canary 還過不過。

## 並行與呼叫量上限

這裡有三層各自獨立的節流，鬆緊程度由外而內遞減；三層都只看單一 job 或單一 process，跨 job 的累積量見本節最後的「跨 job 累積」：

1. **單一 daily-brief job 內的並行尖峰**：`DECOMPOSER_FANOUT_CONCURRENCY`／`RETRIEVE_FANOUT_CONCURRENCY`／`ANALYST_TIER1_FANOUT_CONCURRENCY` 三個環境變數（各預設 3）加上不吃 env 覆寫的 tier-2 fanout（固定 3）。decompose → retrieve → analyst 三個 stage **循序**執行，analyst stage 內部才**巢狀**（每個 tier-1 worker 各自可能同時展開 tier-2 fanout）。因此全域有效尖峰是 `max(decomposer, retrieve, tier1 * tier2)`，**不是四值相加**——調大 tier-1 或 tier-2 的常數會被相乘放大。公式與推導見 `effectiveLlmPeak()`（[`apps/server/src/agents/fanout-concurrency.ts`](../../apps/server/src/agents/fanout-concurrency.ts)），目前預設值算出來是 9。有效尖峰超過安全門檻（10）時會印 `[startup-config]` 等級的警告、不擋啟動——**這個警告不只在 server 啟動時印一次**：`callAgentLLM`（所有經過它的呼叫路徑，含 server pipeline、CLI、批次評測腳本）第一次真正打 provider 之前也會印一次（`warnLlmConcurrencyBudgetOnce`，同一份檔案），所以經過 `callAgentLLM` 的 CLI 單獨跑也看得到這個警告；`packages/prompt-research`、TTS、`model-ab --probe` 與 `GEMINI_ONLY_PATHS`（[`apps/server/tools/ci/gemini-only-paths.ts`](../../apps/server/tools/ci/gemini-only-paths.ts)）列出的路徑不經過 `callAgentLLM`，不會印這個警告。
2. **單一 job 的呼叫數上限**：`MAX_LLM_CALLS_PER_JOB`（預設 150）。單份 daily brief 實測 22–32 次呼叫（量法：`background_jobs.metadata.llmCalls`），150 遠高於實測上界、仍遠低於批次評測的風險門檻，落在「失控迴圈或誤改參數會撞到，正常 pipeline 不會撞到」的量級；超過會讓 `runDailyBrief` 中止並拋出錯誤（`assertLlmCallBudget`，同檔）。
3. **單次批次腳本開跑前的預估**：上面兩層都只看「單一 process 內」，擋不住連續手動跑多次評測腳本的累積量——這正是曾讓共用 API 金鑰被降級的那種形狀（背景與影響見 [README「成本」](../../README.md#成本)）。只有在 [`apps/server/tools/ci/llm-cli-manifest.ts`](../../apps/server/tools/ci/llm-cli-manifest.ts) 裡標成 `gated: true` 的批次腳本，開跑前才會先估算這次總共會打幾次 LLM，超過安全門檻時要求 `--yes` 才執行；估算與擋下的邏輯在 [`apps/server/tools/cli/lib/llm-run-budget.ts`](../../apps/server/tools/cli/lib/llm-run-budget.ts)。**被歸類為 `shape: 'batch'` 但目前仍是 `gated: false` 的腳本還沒有這道閘門**（各自的 `reason` 欄寫了為什麼），跑之前要自己估——這份清單會隨新增批次腳本變動，這裡不重複列舉腳本名、以免過期。**這層本身也只覆蓋會在單一 process 內迴圈重跑的批次腳本**，不是對「連續手動執行多個不同 CLI」的全面跨 job 節流。

### 跨 job 累積：repo 內沒有防線，要到 provider 端設

上面三層全部是 per-job 或 per-process。「很多個各自合規的 job，在幾小時內加起來幾百次請求」這種形狀，repo 裡沒有任何機制會擋——[README「成本」](../../README.md#成本) 舉的例子正是這個形狀。這裡刻意不寫跨 job 的節流程式：配額是 provider 那側按 project 計的，repo 內的計數看不到同一個 project 底下別的程式、別的 key 打了多少。所以這一層請在 provider 端自己設。以下各項的出處都是官方文件（2026-09-18 查閱），介面會變，動手前以官方頁面為準。

**Gemini API（AI Studio 的 key）**

- **額度按 project 計、不是按 key 計**（[Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)："Rate limits are applied per project, not per API key."）。同一個 project 底下多開一把 key 不會多出額度，也隔離不了風險。**跑這個專案請用一個專屬的 project，不要跟別的用途或別人共用**——被限制時受影響的是整個 project。
- **請求數（RPM／RPD）能不能自己調低：AI Studio 這側的文件沒有提供，Cloud console 那側未實測。** Gemini API 的 Rate limits 文件只提供查看現行額度與申請調高。Google Cloud 另有通用的 quota override 機制，可以把配額改成比預設低的值（[View and manage quotas](https://docs.cloud.google.com/docs/quotas/view-manage)："To restrict usage of a particular resource, create a quota override by changing the quota value to a value less than the default quota value."），入口在 Console 的 **IAM & Admin > Quotas & System Limits**；但同頁註明 "Quota overrides are not available to all services."，而 Gemini API 是否支援，本文件**沒有實測過**。如果你的 project 掛在 Cloud Billing 底下，值得進去找一次——它是這幾項裡唯一以「請求數」而不是「金額」為單位的上限。
- **能自己設的上限是金額**：AI Studio 的 [Spend](https://aistudio.google.com/spend) 頁 **Monthly spend cap > Edit spend cap**，按 project 設（[Billing](https://ai.google.dev/gemini-api/docs/billing)）。同頁註明帳務資料最多約延遲 10 分鐘，批次與長時間工作可能超出上限。
- **Cloud Billing 的一般 budget 只告警、不擋量**（[Budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets)："Setting an alerts-only budget doesn't automatically cap ... usage or spending."）。會真的暫停服務的是另一種 [spend cap budget](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)（查閱當時官方標示為 Pre-GA），兩者不要搞混。

**Anthropic（`AI_PROVIDER=anthropic` 時）**

- 為這個專案開一個專屬的 workspace，在 workspace 上設 spend limit 與 rate limit。workspace 的 spend limit 只能設得比組織上限低（[Workspaces](https://support.claude.com/en/articles/9796807-creating-and-managing-workspaces)），組織層的上限永遠同時生效（[Rate limits](https://platform.claude.com/docs/en/api/rate-limits)）。

**★ 這一層的射程**：金額上限以「月」為單位、量的是花費，不是「短時間內的請求數」。它封得住帳單，**不保證**擋得住「請求太密而被 provider 判定為可疑活動」——Gemini 的 [使用政策](https://ai.google.dev/gemini-api/docs/usage-policies) 保留調整 rate limit 與暫停存取的權利，對那種形狀，除了上面那個未實測的 quota override，已知有效的作法至少有兩件：批次工作分批、拉開間隔跑（上面第 3 層的預估是用來幫你做這個判斷的），以及用專屬 project 把影響範圍限制在自己身上。

另有一組跟並行完全不同性質的環境變數：`*_CONCURRENCY`（例：`MARKET_DATA_REFRESH_CONCURRENCY`）控制的是**同一個 job kind 同時能有幾個排隊中的 job 一起跑**，變數名由 kind 推導（`concurrencyEnvFor`，[`apps/server/src/jobs/specs.ts`](../../apps/server/src/jobs/specs.ts)），跟上面三層「單一 job 內部打多少次 LLM」是兩回事，不要混為一談。

## `POST /api/brief/analyze` 限流

這個端點公開、無認證，每個成功請求都會排一個之後會呼叫 LLM 的 job，所以 server 內建兩層 in-memory fixed-window 限流（[`apps/server/src/http/rate-limit.ts`](../../apps/server/src/http/rate-limit.ts)）：**每個客戶端**（`ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN`，預設 5、每分鐘）與**全域**（`ANALYZE_RATE_LIMIT_GLOBAL_PER_HOUR`，預設 60、每小時）。任一層超過都回 `429`，body `{ error: 'rate_limited', detail, retryAfterSec }`（`detail` 是給讀者看的中文訊息，前端會直接顯示），並帶 `Retry-After` header；perClient 沒過不會去消耗 global 的額度。兩個變數的解析都是「非數字或負數 → 用預設值，`0` → 停用該層」（`parseRateLimitEnvInt`，[`rate-limit-config.ts`](../../apps/server/src/http/rate-limit-config.ts)）。

**in-memory 是延續既有取捨，不是新引入的限制**：這個 repo 的部署硬要求本來就是單一 server instance（見 [部署「這個架構要知道的三件事」](../operations/deploy.md#這個架構要知道的三件事)），background job 佇列也只活在 process 記憶體裡；限流跟著用同一份假設，代價是**重啟即歸零**，不需要額外的共享儲存。

**客戶端識別**（`clientKeyOf`，[`client-key.ts`](../../apps/server/src/http/client-key.ts)）預設用實際 TCP 連線來源；`TRUST_PROXY=true` 時改信任 `X-Forwarded-For` 的**最右邊**一段——最左邊那段客戶端自己填得出來，只有緊鄰 server 的那層可信代理附加的最後一段才可信，所以只適用「前面剛好一層可信反向代理」的部署形狀，多層代理鏈路不保證這個假設成立。開錯（沒有可信代理卻打開 `TRUST_PROXY`）會讓 perClient 這層形同虛設——這正是保留 global 層的原因，即使 perClient 的識別完全失效，global 仍是這個端點總請求量的硬上界。

## Podcast 儲存與 TTS：兩個「打錯字會靜默走預設」的變數

`PODCAST_STORAGE_KIND` 與 `PODCAST_TTS_PROVIDER` 都只接受兩個固定值，且都是**嚴格比對**——打錯字（例如 `S3`、`Azure`）不會報錯，而是被對應的 getter 靜默當成預設分支處理：`PODCAST_STORAGE_KIND` 不是 `s3` 就一律走本地磁碟（容器 redeploy 就整批消失），`PODCAST_TTS_PROVIDER` 不是 `azure` 就一律走 Gemini TTS。`checkStartupConfig` 會把這兩種情況標成「設定互相矛盾」印出來提醒，但不擋啟動。**未設的情況不算矛盾**：`PODCAST_STORAGE_KIND` 沒設等同 `local`，不會被報；啟動檢查也刻意不查 `PODCAST_S3_REGION`（storage 層本身預設 `'auto'`，缺了不影響行為，見 `startup-config.ts` 的音檔儲存段註解）。儲存與交付的整體架構（R2 為什麼是 production 選擇、`/audio` 如何 302）見 [模組地圖「Storage 與資料 ownership」](module-map.md#storage-與資料-ownership) 與 [Runtime Flows](runtime-flows.md)。

Azure Speech 的 `zh-TW` 語音裡，`zh-TW-YunJheNeural`（雲哲）是目前唯一的男聲選項，其餘（曉臻、曉雨等）都是女聲；`.env.example` 預設的語速 1.1 是主觀選的較順口速度，兩者都可依喜好換掉。

## Seed 第三方來源開關

`SEED_THIRD_PARTY_SOURCES` 與 `SEED_ALLOW_DOWNGRADE` 只影響 `pnpm --filter @suanomics/db run db:seed` / `seed:external-sources`，不影響 server 啟動；預設只啟用「以公開發佈為目的」的官方來源，商業媒體 feed 預設停用，且兩支 seed 會在偵測到會把既有啟用中的第三方來源悄悄翻成停用時直接中止。完整規則與操作步驟見 [本機開發「本機服務」](../operations/local-dev.md#本機服務)；來源分類邏輯在 [`packages/db/src/source-policy.ts`](../../packages/db/src/source-policy.ts)。兩個變數的判定都是 trim 後不分大小寫比對 `'true'`（`'TRUE'`、`' true '` 前後帶空白都算開）；`source-policy.ts` 的檔頭註解也提醒：開啟商業媒體來源前請自行確認各站的 ToS 與 robots.txt，這是使用者自己要承擔的責任。

## Firecrawl：已移除的變數

應用程式碼不再讀取任何 Firecrawl 相關的環境變數——Cascade 的 gap-search 路徑已移除（它讀錯回應欄位，把沒有內文的 URL 送進 citation），細節見 [Runtime Flows](runtime-flows.md) 的 gap-scrape 說明。Firecrawl 本身仍是有用的人工／agent 工具（找新來源），只是不再是這個專案的服務設定。
