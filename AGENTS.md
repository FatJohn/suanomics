# AGENTS.md

給在這個 repo 工作的 AI coding agent 的指示。人類貢獻者的完整說明在 [CONTRIBUTING.md](CONTRIBUTING.md)。這份只寫這個 repo 的 gotcha、鎖定的選型與邊界；長內容一律指向 `docs/`（見「要細節時去哪讀」）。

## 專案是什麼

每天台股開盤前，自動產出一份總經報告：昨晚世界上發生了什麼、可能怎麼影響今天的台股。核心輸出是一串連動鏈，每條都長成「哪個產業、透過什麼機制、牽動哪些標的、往哪個方向」，全部附引用來源。完整背景見 [docs/architecture/orientation.md](docs/architecture/orientation.md)。

## 慣例

- 文件與註解：繁體中文（台灣用語）；程式碼 identifier：英文。
- 程式碼裡不要放 emoji。
- 避免過度工程：能用原生 `fetch` 的不要引 axios、能用 JSON 的不要上資料庫。

## 開發紀律

**嚴格 TDD**（這些必定先寫測試）：Zod schemas、LLM prompt builders、citation URL 驗證、業務規則（compliance 攔截、cascade tier routing、選稿排序與 cap、cache key）、任何純函式。

**先做 + 手動驗證**（事後補測試）：Vue 元件、API route handlers（後補 integration test）、部署設定（Dockerfile 與 compose，本機 `docker build` 預跑）。

硬性紀律：

- **structural 與 behavioral 絕對不混 commit**；兩者都要改時先做 structural、跑測試確認沒壞，再做 behavioral。
- commit message 的 subject 或 body 要帶 `[STRUCTURAL]` 或 `[BEHAVIORAL]` tag；husky + commitlint 會擋（規則見 `commitlint.config.js`）：subject 上限 72 字元、type 限 `feat`／`fix`／`refactor`／`chore`／`docs`／`test`／`build`／`ci`。
- 不要用 `--no-verify` 跳過 commit hook；不要 force push 到 main。
- 小而頻繁優於大而罕見。

完整方法論見 [docs/development-conventions.md](docs/development-conventions.md)；commit 範例與 PR 流程見 [CONTRIBUTING.md](CONTRIBUTING.md)「Commit 紀律：Tidy First（Kent Beck）」。

## 指令

```bash
pnpm -r build      # 依 workspace 相依的拓撲序建置。★ fresh clone 先跑這條：@suanomics/shared 等 package 的
                    # exports 指向 dist，沒 build 過就跑 type-check 會報 Cannot find module '@suanomics/shared'
                    # （CI 也是先 build 再 lint／type-check／test）。
pnpm -r test       # CI 跑這個（CI 帶真實 Postgres 18）
# 本機沒有 Postgres 時改跑這條：
pnpm --filter '!@suanomics/db' -r --no-bail test
# ↑ 仍會有幾支直連 Postgres 的測試必紅，清單見 CONTRIBUTING.md「測試」；清單以外的失敗都是真的。
# --no-bail：pnpm -r 預設遇到第一個失敗就停、其餘 workspace 整批不跑，看起來會像「只錯一個」。
pnpm -r type-check # tsc / vue-tsc
pnpm lint          # 用這個，不是 `pnpm -r lint`——後者逐 workspace 跑、不含 root project，
                    # root 的 package.json / 設定檔不會被掃到。CI 的 Lint step 跑的就是 `pnpm lint`。

# 樣本形狀體檢：打真的外部 API、只比形狀不比值，回報哪些 fixture 已經與現實漂移。
# 刻意不在 CI——外部服務不可用造成的紅燈會訓練出忽略紅燈的習慣。動某個外部 client 之前跑一次。
pnpm --filter server run fixtures:check
```

★ **寫真 DB 測試時，清理用的資料前綴要全 repo 唯一。** vitest 預設平行跑檔案，兩支測試若用同一個前綴做 `beforeEach`／`afterEach` 清理，會互刪對方剛 seed 的資料——症狀是「單獨跑全綠、一起跑紅好幾條」。新測試挑前綴前先 `rg` 一次。

## Tech Stack（已鎖定、不要自行更換）

| 層 | 選型 | 備註 |
|----|------|------|
| Frontend framework | Vue 3 + Vite + TypeScript | 不換 React/Next.js |
| UI 元件 | Tailwind CSS + shadcn-vue | |
| State management | Pinia | |
| Frontend routing | Vue Router | |
| Markdown 渲染 | markdown-it | |
| Backend framework | Hono | 輕量、現代 streaming 支援 |
| LLM SDK | `@google/genai`（Gemini、pipeline 預設）+ `@anthropic-ai/sdk`；OpenAI 相容端點走原生 `fetch`、不引 SDK | 每個 agent 打哪個 provider 由 `AGENT_MODELS`／`LLM_PROVIDER`／`AI_PROVIDER` 共同決定，規則見 [agents-and-prompts](docs/architecture/agents-and-prompts.md)「模型解析與 provider gate」 |
| Schema 驗證 | Zod | 前後端共用型別（`@suanomics/shared`）|
| YouTube 字幕 | `youtube-transcript-plus` npm | 免 API key |
| 資料層 | Postgres（drizzle-orm） | `packages/db`；async job 由 `packages/jobs` 的 in-process runner 執行、狀態只在 `background_jobs`；podcast 音檔在 Cloudflare R2（S3 相容）|
| 部署 | 未定 | 參考設定 `docker-compose.deploy.yml`（`Dockerfile.server`／`Dockerfile.web`），單一 server 容器＋web 靜態站＋Postgres 18；必要 env 與「單 instance、stop-then-start」硬要求見 [docs/operations/deploy.md](docs/operations/deploy.md) |
| Package manager | pnpm | 不用 npm / yarn / bun；版本由 root `package.json` 的 `packageManager` 欄位鎖定 |
| Node 版本 | 22 LTS | CI 鎖 22 |

要換選型先開 issue 討論，不要自行換。

## Git 與 PR

- Feature branch：`feat/<topic>`、`refactor/<topic>` 等。
- 每個 feature branch 做完開 PR；CI（`.github/workflows/ci.yml`）要全綠。
- 由維護者 review 並以 merge commit 合併（不 squash）；agent 不自行 merge。

## Coding Standards

- TypeScript：`strict: true`、`noUncheckedIndexedAccess: true`（陣列／物件存取強制 undefined 檢查）、無 `any`（必要時 `unknown` + type guard）。
- Vue 3：Composition API（`<script setup>`）、`defineProps`／`defineEmits` 用 TypeScript 泛型。
- 命名：元件檔 `PascalCase.vue`、composables `useXxx.ts`、Zod schema `XxxSchema`、型別 `type Xxx = z.infer<typeof XxxSchema>`。
- **檔案 < 300 行**是 `eslint.config.js` 的 error，超了 lint 直接紅（要拆檔、抽 module，或 inline disable 附理由）。
- **函式以 50 行為目標**，但 eslint 只在超過 80 行時 warn（`eslint .` 沒帶 `--max-warnings 0`，warn 不會讓 lint 失敗）——80/warn 是刻意的決策（容忍 prompt builder 這類長 helper），不要「順手」改回 50/error。
- S.O.L.I.D.、可讀性 > 炫技；註解寫「為什麼」而非「做什麼」；一個檔案一個責任。

## 安全鐵律

1. **絕對不要**從前端直接 call LLM API——API key 會洩漏。所有 LLM 請求走 `apps/server` proxy。
2. `.env` 的值不要 commit。`apps/server/.env.example`、`apps/web/.env.example` 要維持最新。
3. LLM 的 system prompt 要硬式攔截投信投顧法禁用字眼（「建議買 / 賣 / 持有」、「明牌」等），見 `packages/shared/src/compliance.ts` 的 `FORBIDDEN_PHRASES`。
4. **跑真 LLM 之前先估「總呼叫數 × 尖峰並行」**。單一 job 內的四個扇出都有並行上限、也有呼叫數上限（`apps/server/src/agents/fanout-concurrency.ts`，全域有效尖峰由 `effectiveLlmPeak()` 算），但**跨 job 的累積量 repo 內沒有機制會擋**。批次跑（評測、A/B、重跑歷史資料）前先估總呼叫數，**預估超過 500 次呼叫或尖峰並行超過 10，就分批跑**——密集打法可能讓 LLM provider 把請求判為可疑並降級整個 project 的 key。量法：`background_jobs.metadata.llmCalls`；單份 brief 的實測數字與三層節流設計見 [README.md](README.md)「成本」。

## 不做的事

見 [ROADMAP.md](ROADMAP.md)「明確不做」。發現自己開始在做這些項目，立刻停下來開 issue 或問維護者。

## 授權相容

新增 dependency 前確認授權與 Apache-2.0 相容（例：AGPL 不相容）。

## 要細節時去哪讀

| 情境 | 檔案 |
|------|------|
| 專案總覽、Quick Start | [README.md](README.md) |
| 人類貢獻者指南（開發環境、測試、PR 流程） | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 已知限制、想做的方向、明確不做 | [ROADMAP.md](ROADMAP.md) |
| 視覺設計系統（色彩、字體、版面、元件規範） | [DESIGN.md](DESIGN.md) |
| 安全政策、漏洞回報方式 | [SECURITY.md](SECURITY.md) |
| 給第一次接觸這專案的人 | [orientation](docs/architecture/orientation.md) |
| 五分鐘建立 Cascade 的產品與 runtime 心智模型 | [system-overview](docs/architecture/system-overview.md) |
| 各 workspace 的 ownership、public surface、依賴方向 | [module-map](docs/architecture/module-map.md) |
| Cascade 主功能 spec | [features/cascade.md](docs/features/cascade.md) |
| 投信投顧法 compliance 與 citation 規則 | [compliance-and-citations](docs/architecture/compliance-and-citations.md) |
| 各 agent 的 prompt contract、model / provider 決策 | [agents-and-prompts](docs/architecture/agents-and-prompts.md) |
| 品質量測工具（pairwise judge、canary、model A/B、claim 指標）怎麼跑、怎麼讀 | [evaluation](docs/architecture/evaluation.md) |
| 同步讀取、非同步 job、資料落地與降級路徑 | [runtime-flows](docs/architecture/runtime-flows.md) |
| 環境變數背景說明（為什麼長這樣、啟動檢查怎麼分級） | [configuration](docs/architecture/configuration.md) |
| 外部依賴盤點（失敗可不可見） | [external-dependencies](docs/architecture/external-dependencies.md) |
| 兩套語料系統：brief 選題 vs cascade 檢索 | [news-corpus-systems](docs/architecture/news-corpus-systems.md) |
| 財經 knowledge layer 的目標架構草案（尚未實作） | [shared-finance-knowledge](docs/architecture/shared-finance-knowledge.md) |
| Podcast 人設與品牌 | [podcast-persona](docs/features/podcast-persona.md) |
| 本機跑起來 | [local-dev](docs/operations/local-dev.md) |
| 部署（目前沒有 prod） | [deploy](docs/operations/deploy.md) |
| 部署後驗證 | [smoke-test](docs/operations/smoke-test.md) |
| 完整 TDD / Tidy First / commit 紀律全文 | [development-conventions](docs/development-conventions.md) |

## Issue

Issue 走本 repo 的 GitHub Issues。
