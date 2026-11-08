# AGENTS.md

讀者：在本 repo 工作的 AI coding agent（Claude Code 經 `CLAUDE.md` 匯入本檔）
型別：規則

本檔每個 session 全文載入，只放判斷規則適用性所需的一行標題、鎖定的選型與指令；規則的理由與機械化方式在 [程式碼規則](docs/rules/coding.md)。人類貢獻者的流程在 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 專案是什麼

每個台股交易日開盤前自動產出一份總經報告：前一晚世界上發生了什麼、透過什麼機制牽動哪些台股標的、方向為何，每條連動鏈附引用來源。系統是一條排程批次 pipeline 加一個 Astro 靜態網站，沒有常駐 server。架構與邊界見 [設計依據](docs/architecture/design-basis.md)，每個取捨的完整理由見 [決策紀錄](docs/adr/)。

`rewrite` branch 是從空樹重寫的版本，PR 一律開進 `rewrite`。v0 在 `main`，只用 `git show main:<path>` 讀，不 checkout、不修改。

## 指令

```bash
pnpm install --frozen-lockfile
pnpm -r build        # fresh clone 先跑：@suanomics/shared 的 exports 指向 dist，沒 build 過 type-check 會找不到模組
pnpm lint            # 用這條：ESLint 只在 root 跑，workspace 沒有 lint script
pnpm -r type-check   # tsc；apps/web 是 astro check
pnpm -r test         # vitest
pnpm knip            # 未使用的檔案、export 與依賴

# 需要 DATABASE_URL 指向本機 Postgres container，不用 Neon production
pnpm --filter @suanomics/pipeline run db:migrate
```

CI（`.github/workflows/ci.yml`）跑上面除了 `pnpm knip` 以外的指令，資料庫是 Postgres 18 service container；knip 沒有 CI 把關，開 PR 前自己跑。本機起 Postgres 的步驟見 [本機開發](docs/operations/local-dev.md)。

## Tech Stack（已鎖定，要換先開 issue）

| 層 | 選型 | 決策紀錄 |
|---|---|---|
| 語言 | TypeScript（後端與網站都是），`strict` | [0006](docs/adr/0006-typescript-only-backend.md) |
| Node | 26（`.nvmrc`、`engines`） | — |
| Package manager | pnpm，版本由根目錄 `package.json` 的 `packageManager` 鎖定；不用 npm、yarn、bun | — |
| Monorepo | pnpm workspace：`packages/shared`、`apps/pipeline`、`apps/web` | [設計依據的〈Workspace 與依賴方向〉](docs/architecture/design-basis.md#workspace-與依賴方向) |
| 執行環境 | GitHub Actions 排程批次 pipeline，沒有常駐 server | [0002](docs/adr/0002-batch-pipeline-and-static-site.md) |
| 觸發器 | Cloudflare Worker Cron Trigger 為主，Actions `schedule` 為備援 | [0009](docs/adr/0009-cron-trigger-via-cloudflare-worker.md) |
| 資料庫 | Neon Postgres，drizzle-orm 與 drizzle-kit migration | [0003](docs/adr/0003-neon-postgres.md) |
| LLM 呼叫層 | Vercel AI SDK（`ai`、`@ai-sdk/anthropic`），不用 agent 框架 | [0004](docs/adr/0004-ai-sdk-no-agent-framework.md) |
| LLM provider | 只用 Anthropic | [0004](docs/adr/0004-ai-sdk-no-agent-framework.md) |
| Schema 驗證 | Zod，契約放 `packages/shared` | [設計依據的〈Workspace 與依賴方向〉](docs/architecture/design-basis.md#workspace-與依賴方向) |
| 網站 | Astro 靜態產生、Tailwind，部署到 Cloudflare Pages | [0005](docs/adr/0005-astro-static-site.md) |
| 新聞來源 | 官方機構與發行商自己的 feed，正文在 pipeline 內抽取；不買新聞 API | [0007](docs/adr/0007-news-sources.md) |
| Podcast 語音 | Azure Speech | [0010](docs/adr/0010-azure-tts-only.md) |
| 測試 | vitest | — |
| Lint | ESLint（`@antfu/eslint-config`）、commitlint、knip | — |

## 機械守門

下列規則由工具擋下，違反時跑對應指令就會看到錯誤，不另寫成規則：

| 守什麼 | 工具 |
|---|---|
| commit message：Conventional Commits、type 限 `feat`／`fix`／`refactor`／`chore`／`docs`／`test`／`build`／`ci`、標題上限 72 字元、必須含 `[STRUCTURAL]` 或 `[BEHAVIORAL]` | husky commit-msg 跑 commitlint（`commitlint.config.js`） |
| 金鑰不進 repo | husky pre-commit 與 CI 各跑 gitleaks；GitHub push protection |
| 單檔 300 行（不含空行與註解，測試檔除外） | ESLint `max-lines` error |
| `apps/web` 不 import `apps/pipeline`；`packages/*` 不 import `apps/*` | ESLint `import-x/no-restricted-paths` |
| `.ts` 與 `.astro` 不用 `any`；`.ts` 不用非空斷言 `!`，型別 import 用 `import type` | ESLint `ts/no-explicit-any`、`ts/no-non-null-assertion`、`ts/consistent-type-imports` |
| 不 import `@anthropic-ai/sdk`、`@google/genai`、`openai`，也不 import `ai` 的 `generateObject`；`apps/web` 另不 import `ai`、`@ai-sdk/*`（只涵蓋靜態 import） | ESLint `no-restricted-imports` |
| `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` | `tsconfig.base.json`（shared、pipeline）與 `apps/web/tsconfig.json`，`pnpm -r type-check` |
| `rewrite` 要走 PR、`gitleaks` 與 `ci` 兩個 check 通過、commit 要簽章、禁 force push 與刪除 | GitHub ruleset |

## 規則

每行是一條規則的完整判斷依據，理由與機械化方式在 [程式碼規則](docs/rules/coding.md) 的同名標題下。標「待 lint 化」的規則有現成檢查可接、還沒接上。

<!-- BEGIN GENERATED RULES -->

### 程式碼規則（[完整說明與範例](docs/rules/coding.md)）

**開發紀律**
- 新增或修改 Zod schema、prompt builder、citation 驗證、compliance 禁用語、選稿排序與名額、每日花費閘或任何純函式時，先寫會紅的測試再寫實作（HIGH）
- 改 Astro 頁面與元件、CLI 入口接線、部署或 workflow 設定時可以先做再補測試，但 PR 說明要附手動跑過的指令與輸出（MEDIUM）
- 同一個 commit 不同時含 structural 變更（改名、搬檔、抽函式等不改行為的整理）與 behavioral 變更（改行為）；兩者都要時先 commit structural、跑測試確認沒壞，再 commit behavioral（HIGH）
- 從 v0（`main`）或其他 repo 搬檔時，第一個 commit 原樣搬並標 `[STRUCTURAL]`，改寫放在之後的 commit（HIGH）
- 不用 `--no-verify` 或任何方式跳過 husky 的 pre-commit 與 commit-msg hook；hook 擋下時修正內容再 commit（CRITICAL）
- 不更換 `AGENTS.md`〈Tech Stack〉表裡的選型，也不引入表外的同類替代品；要換先開 issue（HIGH）
- 實作碰到設計依據〈不做的事〉列出的項目（線上即時分析、註冊登入、agent 框架、OpenAI 相容端點、向量檢索、換後端語言等）時，停下來開 issue 或問維護者（HIGH）
- agent 不 merge PR，也不 push 到 `rewrite` 或 `main`；PR 開進 `rewrite`，由維護者以 merge commit 合併（HIGH）
**LLM 與報告內容**
- 呼叫 LLM 只用 `ai` 套件的 `generateText` 加 `Output.object({ schema })`（HIGH）
- `apps/web` 不 import 任何 LLM SDK，網站只讀 pipeline 寫進 Postgres 的結果（HIGH）
- 每個 agent 用哪家哪個 model 只寫在 `apps/pipeline` 的 model 對照表，agent 程式碼裡不寫死 model ID（MEDIUM）
- 新增或修改 agent 的 system prompt 時，帶入 `packages/shared` 的 compliance 禁用語清單（「建議買／賣／持有」「明牌」等投信投顧法禁用語），不在 prompt 內另寫一份（CRITICAL）
- 連動鏈的每個數字、事件與因果都要帶可追溯的來源 URL，找不到來源的條目不寫進 brief（CRITICAL）
- 批次跑真 LLM（評測、A/B、重跑歷史資料）前先估總呼叫數、尖峰並行與費用；超過 500 次呼叫或尖峰並行超過 10 就分批跑（HIGH）
- 新增新聞或資料來源前，先在 `docs/sources.md` 記下 feed URL、條款連結與允許用法；條款禁止 AI 用途的來源不接（HIGH）
**資料庫與測試**
- 測試、本機開發與 CI 只連本機或 CI 的 Postgres container，不使用 Neon production 的連線字串（CRITICAL）
- 寫真資料庫測試時，清理用的資料前綴要全 repo 唯一，挑前綴前先用 `rg` 搜一次（MEDIUM）
**依賴與設定**
- 新增 dependency 前確認授權與 Apache-2.0 相容（例如 AGPL 不相容）（MEDIUM）
- 能用 Node 原生 API（`fetch`、`node:*` 模組）解決的，不引入第三方套件（LOW）
- `packages/shared` 的 runtime 依賴只有 `zod`；要加其他依賴先開 issue〔待 lint 化〕（MEDIUM）
- 新增或改名環境變數時，同步更新根目錄 `.env.example`，只寫 key 名不寫值（MEDIUM）
- 修改 `.github/workflows/**` 時，第三方 action 釘 commit SHA、`permissions` 只給需要的最小權限、不使用 `pull_request_target`〔待 lint 化〕（HIGH）
- eslint 的函式行數上限 80 行 warn 是刻意設定，不要改成 50 行或 error；寫函式時仍以 50 行為目標（LOW）
**程式碼與文件風格**
- 文件與註解用繁體中文（台灣用語），程式碼 identifier 用英文（LOW）
- 程式碼與註解不放 emoji〔待 lint 化〕（LOW）
- 註解寫為什麼這樣做，不重述程式在做什麼（LOW）
- 新寫或改寫長存文件（README、`AGENTS.md`、`CONTRIBUTING.md`、`docs/**`）後，跑 writing-principles 的 `check_docs.py` 到 RESULT PASS〔待 lint 化〕（MEDIUM）

<!-- END GENERATED RULES -->

## 要細節時去哪讀

| 情境 | 檔案 |
|---|---|
| 系統長什麼樣、為什麼這樣設計、不做什麼 | [設計依據](docs/architecture/design-basis.md) |
| 每個重大取捨的完整理由 | [決策紀錄](docs/adr/) |
| 規則的理由、待 lint 化的檢查 | [程式碼規則](docs/rules/coding.md) |
| 分支、commit、PR 流程與文件檢查 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 本機環境與資料庫 | [本機開發](docs/operations/local-dev.md) |
| v0 的變更紀錄、實驗與產品假設（歷史，不描述現況） | [v0 歷史文件](docs/history/README.md) |
| 進度與待辦 | GitHub Issues 的 milestone |
