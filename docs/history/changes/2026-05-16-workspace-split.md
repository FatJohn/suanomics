# 2026-05-16 Workspace Split (P1 of 4-phase refactor)

## Summary

Split `apps/api` 成 `apps/api`（HTTP 路由 only）+ `apps/worker`（BullMQ consumer + CLI + LLM agents）、抽出 `packages/db`（drizzle schema + repos + storage）與 `packages/jobs`（queue producer + audit + payload-hash）兩個 workspace 包、清掉 resvg/satori/fonts/copy-assets dead code。全程 `[STRUCTURAL]` commit、零行為改。

## Why

Before：`apps/api` 一鍋粥。HTTP routes、BullMQ workers、LLM agent pipeline、CLI scripts、queue infra、DB schema、第三方整合（Firecrawl / Gemini TTS）全混一起。兩條 Dockerfile（`Dockerfile.api`、`Dockerfile.api-worker`）共用 workspace、只差 entrypoint。`apps/api/src/lib/` 底下 100 多個檔混 agents / queue / corpus / podcast-tts / external integrations。

Goals：
1. 讓「api service」與「worker service」反映**程式碼邊界**、不只是部署邊界
2. 把 HTTP 端跟 LLM 執行端解耦
3. 讓 `@lab/db`（schema + repos）成為 routes（讀）與 workers（寫）的單一真相來源
4. 為 P2（CLI 統一走 queue）、P3（prompts 包 + transcript pipeline 整合）鋪路

## What moved where

| Source | Target |
|--------|--------|
| `apps/api/src/db/*` | `packages/db/src/*` |
| `apps/api/drizzle/` | `packages/db/migrations/` |
| `apps/api/src/lib/brief/news-repo.ts` (+test) | `packages/db/src/repos/news-repo.ts` |
| `apps/api/src/lib/brief/analyses-repo.ts` (+test) | `packages/db/src/repos/analyses-repo.ts` |
| `apps/api/src/lib/corpus/articles-repo.ts` (+test) | `packages/db/src/repos/articles-repo.ts` |
| `apps/api/src/lib/podcast-storage.ts` (+test) | `packages/db/src/storage/podcast-storage.ts` |
| `apps/api/src/lib/queue/{producer,types,payload-hash,client,audit}.ts` (+tests) | `packages/jobs/src/` |
| `apps/api/src/worker-entry.ts` | `apps/worker/src/index.ts` |
| `apps/api/src/lib/queue/workers/*` | `apps/worker/src/workers/*` |
| `apps/api/src/lib/brief/agents/**`（13 agents + 8 prompts） | `apps/worker/src/agents/**` |
| `apps/api/src/lib/brief/{analyzer,routing,dedup,cache-key,prompts}.ts` | `apps/worker/src/brief/*` |
| `apps/api/src/lib/brief/{firecrawl-search,scraper,rss-fetcher}.ts` | `apps/worker/src/external/*` |
| `apps/api/src/lib/corpus/*`（除 articles-repo） | `apps/worker/src/corpus/*` |
| `apps/api/src/lib/podcast-tts/*` | `apps/worker/src/podcast-tts/*` |
| `apps/api/src/scripts/*`（5 個 CLI + 12 個 `_` debug） | `apps/worker/src/scripts/*` |
| `apps/api/src/lib/p-map.ts` (+test) | `apps/worker/src/lib/p-map.ts` |
| `apps/api/data/entity-aliases.yml` | `apps/worker/data/entity-aliases.yml` |
| `apps/api/scripts/worker-entrypoint.sh` | `apps/worker/scripts/worker-entrypoint.sh`（內容更新） |

## What stayed

- `apps/api/src/routes/`（HTTP handlers — 不動）
- `apps/api/src/lib/youtube.ts`（被 `routes/transcript.ts` 用、worker 不需要、留 api）
- `apps/api/scripts/entrypoint.sh`（已更新：改 invoke `pnpm --filter @lab/db run db:migrate`）
- `tools/prompt-research/`（P1 不動、P3 再規劃）

## Deviations from plan

1. **audit.ts 不拆**：plan §Task 5 Step 1 設想 `audit.ts` 是 free functions、要拆成 `@lab/db/repos/audit-repo`（低階 CRUD）+ `@lab/jobs/audit`（高階 state transition）。實際 source 是 single factory（FakeDb + 真 DB 兩 branch 在一個 function 內）、強拆需先 refactor、會把 `[STRUCTURAL]` 變 behavioral。決定整檔搬到 `@lab/jobs/audit` 不拆。`background_jobs` 表是 jobs 概念、放在 `@lab/jobs` 是正確邊界。
2. **Tasks 6+7+8+9 合併**：plan §Self-Review 明文允許。獨立做會出現 `../../../../api/src/lib/...` 越界 import 中介狀態。合併成單一「worker-side bulk move」commit（`a91fdc2`）。
3. **Task 9 範圍擴張**：plan 只列 5 個正式 CLI、實際 `apps/api/src/scripts/` 還有 12 個 `_` 開頭 debug + `narrative-smoke.ts` + `_phase8-run-iter1.sh`、全數隨同搬走、不留 broken import 半成品。
4. **ParsedEntry inline**（Task 3）：`news-repo.ts` 原從 `apps/api/src/lib/brief/rss-fetcher.ts` import `ParsedEntry` type。為避免 `@lab/db` 倒抓 `apps/api/`、複製一份 interface 進 news-repo.ts。`rss-fetcher.ts` 自己的 definition 留著（後來 Task 8 把它搬到 `apps/worker/src/external/`、兩處 definition 並存、之後可選擇統一）。
5. **zod 補進 @lab/db deps**（Task 12 後續修）：`articles-repo.ts` + `seed-external-sources.ts` 直接 `import { z } from 'zod'`、但 `packages/db/package.json` 只列 `@lab/shared` 當 zod 來源（hoist 過來）。Docker `--frozen-lockfile` 隔離安裝會看不見 zod、build 掛。補成 direct dep。

## Dead code removed

- `@resvg/resvg-js`、`satori`（deps；0 source 引用）
- `apps/api/fonts/NotoSansTC-Regular.otf`（0 引用、Dockerfile 的 font 檢查也拿掉了）
- `apps/api/scripts/copy-assets.mjs`（拷貝空的 `src/data/` 到 `dist/data/`；2026-05-10 Lv1 移除後 authorities.json 沒了、就完全沒用了）
- `apps/api/src/data/` 空資料夾
- `apps/api/src/lib/.gitkeep`、`apps/api/src/routes/.gitkeep`（scaffold 殘留）

## What did NOT change

- 行為。每個 commit 前後測試全綠（除已知 `apps/worker/src/agents/llm-wrapper.test.ts` timing flake）
- HTTP API surface。同 routes、同 payload
- Queue job kinds、payloads、audit 語義（P2 才動）
- Database schema（migrations 只搬位置、內容 0 改動）
- Vue web app（`apps/web` 完全沒碰）

## Deploy notes

Zeabur 兩個 service（`api`、`api-worker`）用 inline Dockerfile source。本 repo 的 `Dockerfile.api` / `Dockerfile.api-worker` 是 canonical source、部署前**必須**把新版內容貼到 Zeabur Dashboard 的「設定檔編輯器」（per CLAUDE.md、「任意 Git」source 不會自動 scan repo Dockerfile）。

Migration on startup 仍由 `apps/api/scripts/entrypoint.sh` 跑、現在指向 `pnpm --filter @lab/db run db:migrate`。Worker 不跑 migration（避免 race）。

## Final test counts (post-refactor）

| Package | Test Files | Tests |
|---|---:|---:|
| `packages/shared` | 3 | 82 |
| `packages/db` | 5 | 34 |
| `packages/jobs` | 4 | 52 |
| `apps/api` | 6 | 65 |
| `apps/worker` | 35 | 284 |
| `apps/web` | 3 | 26 |
| `tools/prompt-research` | 30 | 215 |
| **Total** | **86** | **758** |

## What's next

- **P2**：統一 CLI scripts 全部走 queue + audit（目前 `podcast:generate` / `podcast:tts` / `news:refresh` 仍 sync 跑）
- **P3**：抽 `packages/prompts`、把 `tools/prompt-research` 整合成 queue-driven pipeline step
- **P4**：低風險 package upgrades + 加 husky / lint-staged / commit-lint

## Spec / plan

- Spec：`docs/superpowers/specs/2026-05-16-workspace-split-design.md`
- Plan：`docs/superpowers/plans/2026-05-16-workspace-split.md`
- 執行筆記：`~/.claude/plans/p1-workspace-validated-pearl.md`
