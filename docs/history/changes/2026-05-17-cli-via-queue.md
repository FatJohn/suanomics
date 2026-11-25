# 2026-05-17 CLI via Queue (P2 of 4-phase refactor)

## Summary

把三個原 sync CLI（`podcast:generate` / `podcast:tts` / `news:refresh`）改成
走 BullMQ queue + `background_jobs` audit；新增三個 `/internal` HTTP endpoint
給 cron 用；`daily-brief` 完成後自動 chain `podcast-generate` → 自動 chain
`podcast-tts`、可由 payload `chainPodcast: false` 關掉；CLI 加 `--wait` flag
給 debug UX。

## Why

P1 後三個 CLI 仍 sync 模式、跟既有 `brief:generate` enqueue pattern 不對稱：
cron 必須 SSH 進容器跑 pnpm、失敗無 `background_jobs` 記錄、沒 retry、沒
progress、brief→podcast 每天要手動 chain 三步。P2 統一進入點。

## Brainstorm 決定（5 議題）

1. **Podcast job 顆粒度** = 兩個 job + auto-chain（mirror brief→analyze）
2. **Brief→Podcast 自動 chain** = 默認 true、payload 可關
3. **Concurrency** = podcast-generate 1 / podcast-tts 1 / news-refresh 2、加 env override
4. **CLI deprecation** = 鋼 break sync + 加 `--wait` 輪詢 audit（不走 HTTP）
5. **命名** = `podcast-generate` / `podcast-tts` / `news-refresh`（mirror `corpus-refresh`）

## What changed

| 範圍 | 變動 |
|------|------|
| `packages/jobs/src/types.ts` | 加 3 個 JOB_KINDS / KIND_TO_QUEUE / PayloadSchema；DailyBriefPayloadSchema 加 `chainPodcast` (default true) |
| `packages/db/migrations/0007_motionless_shiva.sql` + `schema.ts` | 擴 `background_jobs_kind_check` constraint 加 3 個值 |
| `apps/worker/src/{podcast,news}/` (新) | extract 純業務 function：`runPodcastGenerate / runPodcastTts / runNewsRefresh` |
| `apps/worker/src/workers/{podcast-generate,podcast-tts,news-refresh}-worker.ts` (新) | BullMQ adapter + audit lifecycle + chain enqueue |
| `apps/worker/src/index.ts` | 註冊 3 個新 Worker、6 個 queue、concurrency 1/1/2 + env override（PODCAST_GENERATE_CONCURRENCY / PODCAST_TTS_CONCURRENCY / NEWS_REFRESH_CONCURRENCY）、news-refresh lockDuration=15min |
| `apps/worker/src/workers/brief-worker.ts` | 成功路徑 conditional enqueue podcast-generate（fire-and-forget、failure path 不 chain）|
| `apps/worker/src/scripts/{news-refresh,podcast-generate,podcast-tts}.ts` | thin enqueuer + 共用 `pollJobUntilDone`；--wait + --timeout=N + 原 sync mode 移除 |
| `apps/worker/src/scripts/lib/job-poller.ts` (新) | DB-direct 輪詢 `background_jobs.findById` |
| `apps/api/src/routes/internal.ts` | 加 3 個 POST endpoint + `/brief/enqueue` 開放 chainPodcast |

## What stayed

- `apps/web/`
- 既有 `corpus:refresh` / `brief:generate` CLI（已 queue-based）
- 既有 corpus / analyze worker
- 任何 LLM agent code / podcast-tts impl
- Database schema 主體（只動 check constraint）

## Deviations from plan

1. **`RunPodcastGenerateResult.forbiddenSanitized` 型別**：plan 寫 `boolean`、實際 `callPodcastWriter` 回 `number`（count of sanitized phrases）。實作改用 `number` 並在 Task 1 follow-up commit 補了 invalid-date 測試 + 還原 Usage block 註解（commit `1bd7011`、code review 反饋後合併）。
2. **Task 1 兩 commit**：extract method 主 commit (`05297e4`) + 後續 code review 收尾 commit (`1bd7011`)。原 plan 預期 1 commit。
3. **Migration 檔名 = `0007_motionless_shiva.sql`**：drizzle-kit 自動產生的 random tag、非 plan 預設的 `0007_add_p2_job_kinds`。內容 OK、constraint 名稱仍 `background_jobs_kind_check`。
4. **Task 10 連帶修了 2 個既有 brief-worker test**：chainPodcast auto-chain 後 enqueue 呼叫從 3（analyze × 3）變 4（analyze × 3 + podcast-generate × 1）、`toHaveBeenCalledTimes` 和 content-length 檢查跟著調整。
5. **Internal endpoint test 多 1 個**（10 個而非 plan 寫的 9 個）。

## Verify

```bash
# 1. Test gate
pnpm -r build && pnpm -r type-check && pnpm -r test

# 2. Migration
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @lab/db db:migrate

# 3. Worker startup
pnpm --filter worker dev
# expected: [worker-entry] 6 workers registered (corpus-jobs, analyze-jobs, brief-jobs, podcast-generate-jobs, podcast-tts-jobs, news-refresh-jobs)

# 4. CLI smoke
pnpm --filter worker news:refresh
pnpm --filter worker podcast:generate -- --date=2026-05-17 --wait --timeout=120

# 5. Endpoint smoke
SECRET=$INGEST_TRIGGER_SECRET
curl -X POST localhost:3000/internal/news/refresh \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" -d '{}'

# 6. Chain test
curl -X POST localhost:3000/internal/brief/enqueue \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"date":"2026-05-17"}'
# grep worker log 應看到 daily-brief → podcast-generate → podcast-tts 連續完成

# 反例：跳過 podcast chain
curl -X POST localhost:3000/internal/brief/enqueue \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"date":"2026-05-18", "chainPodcast": false}'
```

## Deploy notes

- migration 0007 由 `apps/api/scripts/entrypoint.sh` 啟動時自動跑（同 P1 既有 flow）
- 三個 Zeabur service 不需新 env var（concurrency 用 default 1/1/2）
- 若 prod 想調 concurrency：在 Zeabur Dashboard 加 `PODCAST_GENERATE_CONCURRENCY` / `PODCAST_TTS_CONCURRENCY` / `NEWS_REFRESH_CONCURRENCY`、redeploy worker service
- cron 切換指引：原本 SSH 進容器跑 `pnpm news:refresh` 等、改成 HTTP POST 到 `/internal/news/refresh`（GH Actions cron / Zeabur cron / 任意外部 scheduler 都行）
- CLI 行為改變：`pnpm --filter worker news:refresh` 預設 enqueue 即返回；要 sync UX 加 `--wait` flag。原 sync mode 已移除。

## Final test counts

| Package | Test Files | Tests |
|---|---:|---:|
| `packages/shared` | 3 | 82 |
| `packages/db` | 5 | 34 |
| `packages/jobs` | 4 | 65 |
| `apps/api` | 6 | 75 |
| `apps/worker` | 42 | 306 |
| `apps/web` | 3 | 26 |
| `tools/prompt-research` | 30 | 215 |
| **Total** | **93** | **803** |

P1 baseline 758 tests → P2 加 45 tests = 803。

## Spec / plan

- Spec: `docs/superpowers/specs/2026-05-17-cli-via-queue-design.md`
- Plan: `docs/superpowers/plans/2026-05-17-cli-via-queue.md`
- 4-phase 母 plan: `~/.claude/plans/backlog-md-refactor-optimized-meteor.md`
- P1 change note 對照: `docs/changes/2026-05-16-workspace-split.md`
