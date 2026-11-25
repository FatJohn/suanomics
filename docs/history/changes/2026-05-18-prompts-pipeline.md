# 2026-05-18 Prompts Pipeline (P3 of 4-phase refactor)

## Summary

抽 `packages/prompts` workspace、把 `tools/prompt-research/` 整 retire 進
`apps/worker/`、新增 `prompt-refresh` BullMQ queue + `/internal/prompt-research/refresh`
HTTP endpoint + `prompt:refresh` CLI、candidate 寫 `packages/prompts/_candidates/<runId>/`
人工 PR review promote。同時收 P2 兩個 follow-up（news-refresh hourly
bucket nonce + podcast-generate skip-and-complete）。

## Why

- P2 後唯一 sync 跑的 work product 是 prompts；單獨 workspace 跟 queue infra 不對稱
- Auto-generated `.system.ts` 已存在 worker 內、抽 packages/prompts 把依賴顯式化
- P2 follow-up 跟 queue infra 同主題、塞 P3 開頭 cleanup

## Brainstorm 決定（6 議題）

1. Workspace 邊界 = 全搬 worker
2. Artifact 格式 = TS-only @lab/prompts
3. Review queue = File-based `_candidates/<runId>/`
4. A/B = 純人工 review
5. Payload = Hybrid `{ sources?, bucket? }`
6. P2 follow-up = P3 開頭兩 commit

## What changed

| 範圍 | 變動 |
|------|------|
| `packages/prompts/` (新) | workspace + src/*.system.ts + curation/*.yml + _candidates/ + index.ts re-export |
| `apps/worker/src/lib/prompt-research/` (新) | 整批從 tools/prompt-research/src/ 搬入、含 215 tests |
| `apps/worker/src/prompt-research/` (新) | runPromptRefresh 純業務 function |
| `apps/worker/src/workers/prompt-refresh-worker.ts` (新) | BullMQ adapter、無 chain |
| `apps/worker/src/scripts/{prompt-refresh,prompt-research-distill,prompt-research-compile,prompt-research-curate}.ts` | thin enqueuer + 3 個 local CLI |
| `apps/worker/src/agents/*.ts` | 5 個 agent import 改 `@lab/prompts` |
| `packages/jobs/src/types.ts` | (a) NewsRefreshPayloadSchema 加 bucket (b) 加 PROMPT_REFRESH JobKind + SourceSpecSchema + PromptRefreshPayloadSchema |
| `packages/db/migrations/0008_*.sql` + schema.ts | 擴 background_jobs_kind_check 加 'prompt-refresh' |
| `apps/api/src/routes/internal.ts` | (a) /news/refresh 自動填 hourly bucket (b) 加 /prompt-research/refresh |
| `apps/worker/src/podcast/generate.ts` + worker | existing podcast → skipped、不 chain tts |
| `tools/prompt-research/` | DELETED |
| `pnpm-workspace.yaml` | 移除 tools/* entry |

## What stayed

`apps/web/`、既有 corpus/analyze/brief/podcast 業務邏輯、LLM agent 內部實作、podcast-tts impl、其他 packages 主體。

## Verify

```bash
# Test gate
pnpm -r build && pnpm -r type-check && pnpm -r test
# expected: ~828 tests 全綠（baseline 803 + ~25）

# Migration
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @lab/db db:migrate

# Worker startup
pnpm --filter worker dev
# expected: [worker-entry] 7 workers registered (...prompt-refresh-jobs)

# CLI smoke
pnpm --filter worker prompt:refresh -- --source=yt-yutinghao --wait --timeout=600

# Endpoint smoke
SECRET=$INGEST_TRIGGER_SECRET
curl -X POST localhost:3000/internal/prompt-research/refresh \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" -d '{}'

# Candidate output
ls packages/prompts/_candidates/<runId>/
# expected: *.system.ts files
```

## Deploy notes

- migration 0008 由 `apps/api/scripts/entrypoint.sh` 啟動時自動跑
- 3 個 Zeabur service 不需新 env var（concurrency 預設 1）
- 若 prod 想調 prompt-refresh concurrency：加 `PROMPT_REFRESH_CONCURRENCY` + redeploy worker
- cron 接線 P3 後續：手動人工 POST 或 GH Actions cron 都能用

## P2 follow-ups（一同收掉）

1. news-refresh 加 hourly bucket nonce：cron hourly 跑不再被 24h dedupe 撞掉
2. podcast-generate 改 skip-and-complete：re-brief 同 date 不再留 failed audit row

## Final test counts

(controller verified pre-dispatch — fill in actuals below)

| Package | Test Files | Tests |
|---|---:|---:|
| `packages/shared` | 3 | 82 |
| `packages/db` | 5 | 34 |
| `packages/jobs` | 4 | 79 |
| `packages/prompts` | 1 | 3 |
| `apps/api` | 6 | 82 |
| `apps/worker` | 73 | 526 |
| `apps/web` | 3 | 26 |
| **Total** | **95** | **832** |

P2 baseline 803 tests → P3 加 29 tests = 832。

## Spec / plan

- Spec: `docs/superpowers/specs/2026-05-17-prompts-pipeline-design.md`
- Plan: `docs/superpowers/plans/2026-05-18-prompts-pipeline.md`
- 4-phase 母 plan: `~/.claude/plans/backlog-md-refactor-optimized-meteor.md`
- P1 change note: `docs/changes/2026-05-16-workspace-split.md`
- P2 change note: `docs/changes/2026-05-17-cli-via-queue.md`
