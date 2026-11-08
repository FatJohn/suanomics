# 程式碼規則

讀者：在本 repo 寫程式碼、測試、prompt 與文件的 AI coding agent 與貢獻者
型別：規則

本頁是本 repo 程式碼規則的唯一來源，`AGENTS.md` 的規則清單從本頁的 `###` 標題產生；改規則只改本頁，再照〈規則清單怎麼維護〉重跑產生指令。已有工具機械擋下的規則不寫在本頁，清單在 `AGENTS.md` 的〈機械守門〉。標了「待 lint 化」的規則有現成的機械檢查可用、還沒接上，接上後從本頁刪除。

## 開發紀律

### 新增或修改 Zod schema、prompt builder、citation 驗證、compliance 禁用語、選稿排序與名額、每日花費閘或任何純函式時，先寫會紅的測試再寫實作（HIGH）

這幾類的錯誤不會在型別或 lint 層出現，只會在每日報告裡變成錯的連動鏈或超支；先寫測試才能確定測試真的抓得到錯。測試要先跑一次看到紅，再寫實作看到綠。

### 改 Astro 頁面與元件、CLI 入口接線、部署或 workflow 設定時可以先做再補測試，但 PR 說明要附手動跑過的指令與輸出（MEDIUM）

這幾類的行為要在真環境才看得出來（瀏覽器、Actions runner、Cloudflare Pages），先寫單元測試的效益低。手動跑過的證據放在 PR 說明，讓 reviewer 能重跑。

### 同一個 commit 不同時含 structural 變更（改名、搬檔、抽函式等不改行為的整理）與 behavioral 變更（改行為）；兩者都要時先 commit structural、跑測試確認沒壞，再 commit behavioral（HIGH）

分開 commit，review 時才能把「沒改行為」的部分快速看過、把注意力留給行為變更；出問題時也能單獨 revert。commit message 的 `[STRUCTURAL]`／`[BEHAVIORAL]` tag 由 commitlint 強制，但 tag 與內容是否相符只能靠人判斷。

### 從 v0（`main`）或其他 repo 搬檔時，第一個 commit 原樣搬並標 `[STRUCTURAL]`，改寫放在之後的 commit（HIGH）

原樣搬的 commit 讓 `git log --follow` 追得回原版，也讓 reviewer 能對照搬來的內容與改寫的差異。決策見 [在同一 repo 以 orphan branch 重寫](../adr/0001-orphan-branch-rewrite.md) 的 Consequences。

### 不用 `--no-verify` 或任何方式跳過 husky 的 pre-commit 與 commit-msg hook；hook 擋下時修正內容再 commit（CRITICAL）

pre-commit 跑 gitleaks 擋金鑰，commit-msg 跑 commitlint；跳過就等於讓金鑰或不合格式的 commit 進 repo。repo 是 public，金鑰進 history 就要整把換掉。

### 不更換 `AGENTS.md`〈Tech Stack〉表裡的選型，也不引入表外的同類替代品；要換先開 issue（HIGH）

每個選型背後有一份決策紀錄，換掉會連帶推翻成本、部署與維護上的取捨。表格與決策紀錄的對應見 `AGENTS.md`。

### 實作碰到設計依據〈不做的事〉列出的項目（線上即時分析、註冊登入、agent 框架、OpenAI 相容端點、向量檢索、換後端語言等）時，停下來開 issue 或問維護者（HIGH）

這些項目是刻意排除的範圍，不是漏做。清單見 [設計依據的〈不做的事〉](../architecture/design-basis.md#不做的事)。

### agent 不 merge PR，也不 push 到 `rewrite` 或 `main`；PR 開進 `rewrite`，由維護者以 merge commit 合併（HIGH）

合併時機與方式由維護者決定；`rewrite` 與 `main` 的 ruleset 要求走 PR，直接 push 會被擋，但 merge 按鈕擋不住有權限的 agent。

## LLM 與報告內容

### 呼叫 LLM 只用 `ai` 套件的 `generateText` 加 `Output.object({ schema })`（HIGH）

provider 由 `@ai-sdk/anthropic` 提供，換 model 只改參數；直接綁某家 SDK 會繞過這層。`generateObject` 在 AI SDK v7 標為 deprecated。決策見 [LLM 呼叫層用 Vercel AI SDK、不用 agent 框架](../adr/0004-ai-sdk-no-agent-framework.md)。各家 SDK 與 `generateObject` 的 import 由 ESLint 擋下（見 `AGENTS.md`〈機械守門〉）；`ai` 套件的其他函式要靠本條。

### 每個 agent 用哪家哪個 model 只寫在 `apps/pipeline` 的 model 對照表，agent 程式碼裡不寫死 model ID（MEDIUM）

對照表是「哪個 agent 用哪個 model」的唯一位置，環境變數可逐 agent 覆寫；寫死在 agent 裡，覆寫就失效。分層與預設 model 見 [設計依據的〈LLM 呼叫層〉](../architecture/design-basis.md#llm-呼叫層)。

### 新增或修改 agent 的 system prompt 時，帶入 `packages/shared` 的 compliance 禁用語清單（「建議買／賣／持有」「明牌」等投信投顧法禁用語），不在 prompt 內另寫一份（CRITICAL）

報告公開給任何人讀，出現投顧式建議就有法規風險；禁用語只有一份清單，prompt 與攔截才不會漂移。

### 連動鏈的每個數字、事件與因果都要帶可追溯的來源 URL，找不到來源的條目不寫進 brief（CRITICAL）

「有憑有據」是三個設計約束之一，見 [設計依據的〈目標與讀者〉](../architecture/design-basis.md#目標與讀者)。citation 的驗證規則放在 `packages/shared`。

### 批次跑真 LLM（評測、A/B、重跑歷史資料）前先估總呼叫數、尖峰並行與費用；超過 500 次呼叫或尖峰並行超過 10 就分批跑（HIGH）

含 LLM 在內每月預算上限 NT$1,000；密集打法也可能讓 provider 把請求判為可疑、降級整個 key。每日 pipeline 有花費閘，但跨次執行的累積量沒有機制會擋。

### 新增新聞或資料來源前，先在 `docs/sources.md` 記下 feed URL、條款連結與允許用法；條款禁止 AI 用途的來源不接（HIGH）

pipeline 會把標題與正文送進 LLM，條款不允許就不能用。決策與已排除的來源見 [新聞來源只用 feed 與自抽正文、不買新聞 API](../adr/0007-news-sources.md)。

## 資料庫與測試

### 測試、本機開發與 CI 只連本機或 CI 的 Postgres container，不使用 Neon production 的連線字串（CRITICAL）

Neon 只有 production 一個專案，測試的清理動作會直接刪掉正式資料。本機起 container 的步驟見 [本機開發](../operations/local-dev.md)。

### 寫真資料庫測試時，清理用的資料前綴要全 repo 唯一，挑前綴前先用 `rg` 搜一次（MEDIUM）

vitest 預設平行跑測試檔，兩支測試共用前綴做 `beforeEach`／`afterEach` 清理時會互刪對方剛 seed 的資料，症狀是「單獨跑全綠、一起跑紅好幾條」。

## 依賴與設定

### 新增 dependency 前確認授權與 Apache-2.0 相容（例如 AGPL 不相容）（MEDIUM）

本 repo 以 Apache-2.0 授權公開，不相容的依賴會讓整個專案無法照現行授權散布。

### 能用 Node 原生 API（`fetch`、`node:*` 模組）解決的，不引入第三方套件（LOW）

每多一個依賴就多一份授權、更新與供應鏈風險要顧，一人維護的專案負擔不起。

### `packages/shared` 的 runtime 依賴只有 `zod`；要加其他依賴先開 issue〔待 lint 化〕（MEDIUM）

`shared` 同時被 pipeline 與網站引用，多一個依賴兩邊都要背。依賴方向見 [設計依據的〈Workspace 與依賴方向〉](../architecture/design-basis.md#workspace-與依賴方向)。

待 lint 化：CI 加一步檢查 `packages/shared/package.json` 的 `dependencies` 鍵集合等於 `["zod"]`（或為空）。

### 新增或改名環境變數時，同步更新根目錄 `.env.example`，只寫 key 名不寫值（MEDIUM）

`.env.example` 是本機與 CI 需要哪些變數的唯一清單；值放 GitHub Environment `production` 或本機的 `.env`。

### 修改 `.github/workflows/**` 時，第三方 action 釘 commit SHA、`permissions` 只給需要的最小權限、不使用 `pull_request_target`〔待 lint 化〕（HIGH）

repo 是 public，workflow 是 secrets 最容易外流的路徑。這三條是設計依據〈安全〉的第二層防線。

待 lint 化：CI 加 `zizmor` 或 `actionlint` 掃 `.github/workflows/`。

### eslint 的函式行數上限 80 行 warn 是刻意設定，不要改成 50 行或 error；寫函式時仍以 50 行為目標（LOW）

prompt builder 這類長 helper 合理地超過 50 行，設成 error 只會換來一堆 inline disable。

## 程式碼與文件風格

### 文件與註解用繁體中文（台灣用語），程式碼 identifier 用英文（LOW）

讀者是維護者本人與中文讀者；identifier 用英文與套件 API 一致。

### 程式碼與註解不放 emoji〔待 lint 化〕（LOW）

emoji 在終端機、diff 與 log 的顯示不一致，也無助於說明。

待 lint 化：CI 加 `rg` 掃 `apps/`、`packages/` 的 emoji 碼位區段（例如 `[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]`），命中即失敗。

### 註解寫為什麼這樣做，不重述程式在做什麼（LOW）

程式在做什麼看程式就知道；取捨、外部限制、踩過的坑只能寫在註解裡。

### 新寫或改寫長存文件（README、`AGENTS.md`、`CONTRIBUTING.md`、`docs/**`）後，跑 writing-principles 的 `check_docs.py` 到 RESULT PASS〔待 lint 化〕（MEDIUM）

指令與排除設定見 [CONTRIBUTING 的〈文件〉](../../CONTRIBUTING.md#文件)。`docs/adr/`、`CHANGELOG.md` 與 `docs/history/` 的搬來檔不在掃描範圍。

待 lint 化：把 `check_docs.py` 放進 repo 或以固定版本取得，CI 加一步 `python3 check_docs.py --repo .`。

## 規則清單怎麼維護

改本頁的 `###` 標題後，在 repo 根目錄跑：

```bash
python3 ~/.claude/skills/agent-rules/scripts/rules_index.py --repo . --config docs/rules/agent-rules.conf
```

它把標題清單寫進 `AGENTS.md` 的生成區塊；加 `--check` 只檢查不寫檔，不同步時以 1 結束。標題要讓人只讀這一行就判斷得出適不適用：寫出觸發情境與做法，不寫「依某判準決定」。
