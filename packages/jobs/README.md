# @suanomics/jobs — in-process job runner + audit

封裝 job runner（per-kind 佇列、retry／backoff、progress）、`background_jobs` audit、payload-hash dedupe，與所有 job kind 的 Zod payload schema。

2026-09-04 之前這裡包的是一個外部佇列服務的 client；現在 job 就在呼叫方的 process 裡跑，`background_jobs` 是狀態的唯一真相。

全圖見 [模組地圖](../../docs/architecture/module-map.md)。Job kind 與 chain 行為見其「Apps：對外 surface § apps/server」段。

## 目錄

```
src/
├── index.ts          # barrel
├── types.ts          # JOB_KINDS、各 *PayloadSchema、JobPayloadByKind、retry 與窗的常數
├── runner-types.ts   # JobCtx / JobHandler / JobSpec / JobRunner 等公開契約
├── runner.ts         # createJobRunner()：enqueue dedupe + 佇列 + retry + progress
├── audit.ts          # createAuditRepo()：background_jobs CRUD
├── inflight.ts       # 「這筆 inflight row 算不算殘骸」的純函式判定
└── payload-hash.ts   # 計算 idempotency key
```

## Entry & exports

只開放主 subpath（`.`）、`index.ts` 一次 re-export 所有公開 surface：

- `JOB_KINDS` / `JobKind`
- 各 `*PayloadSchema`（`CorpusRefreshPayloadSchema` 等 7 個）
- `JobPayloadByKind` 型別索引
- `createJobRunner()`、`createAuditRepo()`，與 `JobHandler`／`JobCtx`／`EnqueueFn` 等型別

沒有 module 層級的 `enqueueJob` 單例：enqueue 就是「推進某一個 runner 的佇列」，拿不到 runner 就不該排得出來。

## 8 個 job kind

| Kind | Payload 重點 | 預設 chain |
|------|--------------|-----------|
| `corpus-refresh` | `sourceSlugs?`、`force` | — |
| `analyze` | `title` / `content` / `reportDate` / `url?` / `newsItemId?` | — |
| `daily-brief` | `date`、`chainPodcast`（預設 true） | → `podcast-generate` |
| `podcast-generate` | `date`、`force` | → `podcast-tts` |
| `podcast-tts` | `date` | — |
| `news-refresh` | `bucket`（必填、hourly） | — |
| `prompt-refresh` | `sources?`、`bucket`（必填） | — |
| `market-data-refresh` | `bucket`（必填、daily） | — |

> **日期／bucket 一律由呼叫端傳入。** job payload 不接受「不帶就用今天」——
> 中間層只算得出 UTC 曆日，而報告日是台北曆日，兩者在 pipeline 的執行時刻差一天。
> 新增直接呼叫 `enqueue()` 的地方時，日期要由最外層觸發者算好往下傳。

## 常用命令

```bash
pnpm --filter @suanomics/jobs build
pnpm --filter @suanomics/jobs test
pnpm --filter @suanomics/jobs type-check
```

## 依賴

| 來源 | 用途 |
|------|------|
| `@suanomics/db` | `background_jobs` 表 CRUD、Postgres client |
| `drizzle-orm` | audit repo 用 |
| `zod` | payload schema |

## 被誰用

| Consumer | 用什麼 |
|----------|--------|
| `apps/server` | HTTP 那半：注入的 `enqueue`（`/internal/*` routes）、`audit` 讀（`/api/jobs/:id`）；job 那半：`createJobRunner()` 配 `jobs/specs.ts` 與 `jobs/handlers/`，chain 走 `ctx.enqueue` |
| `@suanomics/prompt-research` | `SourceSpec` type re-export 來源 |

## 約束

- 加新 job kind 要：(1) `types.ts` 補 `JOB_KINDS` + Payload schema + `JobPayloadByKind`。(2) `packages/db` 跑 migration 擴 `background_jobs_kind_check`。(3) `apps/server/src/jobs/handlers/<name>-worker.ts` 寫 handler，並在 `handlers/index.ts` 與 `jobs/specs.ts` 各補一列（兩者都是 `Record<JobKind, …>`，漏了是編譯錯誤）。(4)（若需 cron 觸發）`apps/server/src/http/routes/internal.ts` 加 endpoint。(5)（若需 CLI）`apps/server/tools/cli/` 用 `run-job-cli.ts` 加一支。
- payload schema 一改，enqueue 與 handler 都會跟著 strict 驗證、不要塞額外欄位。
- 禁依 `apps/*`。
