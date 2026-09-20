# @suanomics/db — Postgres 資料層

Drizzle schema + Postgres client + repos + migrations + podcast storage interface。是 api（讀）與 worker（寫）的單一真相來源。

全圖見 [模組地圖](../../docs/architecture/module-map.md)。

## 目錄

```
src/
├── index.ts                       # barrel
├── schema.ts                      # Drizzle table 定義（news_items / external_articles /
│                                  # analyses / daily_briefs / background_jobs）
├── client.ts                      # postgres connection factory
├── migrate.ts                     # CLI：跑 migrations
├── seed.ts                        # CLI：初始 seed
├── seed-external-sources.ts       # CLI：外部 source 表初始化
├── repos/
│   ├── news-repo.ts
│   ├── articles-repo.ts
│   └── analyses-repo.ts
└── storage/
    └── podcast-storage.ts         # podcast WAV：local FS impl、interface 抽好可換 object storage
migrations/                        # drizzle-kit 產生的 SQL（0000 → 0008）
```

## Entry & exports

`package.json` 開放多 subpath、強制 consumer 走 deliberate API：

| Subpath | 內容 |
|---------|------|
| `.` | 主 re-export |
| `./schema` | Drizzle table 純檔 |
| `./client` | `getClient()` connection 工廠 |
| `./seed-external-sources` | CLI helper |
| `./repos/*` | 單一 repo 直接 import |
| `./storage/*` | `podcast-storage` interface + impl |

## 常用命令

```bash
pnpm --filter @suanomics/db build               # tsc → dist/
pnpm --filter @suanomics/db test                # vitest（含 testcontainer Postgres）
pnpm --filter @suanomics/db type-check

# DB 操作（讀 ../../apps/server/.env）
pnpm --filter @suanomics/db db:generate         # drizzle-kit 產 migration
pnpm --filter @suanomics/db db:migrate          # 跑 migration（server 容器的 entrypoint.sh 開機也跑這個）
pnpm --filter @suanomics/db db:seed
pnpm --filter @suanomics/db seed:external-sources
```

## 依賴

| 來源 | 用途 |
|------|------|
| `@suanomics/shared` | Zod schema → type 上游 |
| `drizzle-orm` | ORM |
| `postgres` | driver |
| `zod` | seed 驗證 |

## 被誰用

| Consumer | 用什麼 |
|----------|--------|
| `apps/server` | `repos/*`、`storage/*`、`client`（HTTP 那半以讀為主，job 那半讀寫都有）|
| `@suanomics/jobs` | `client` + `background_jobs` 表（audit） |

## 約束

- 禁依 `apps/*` 任何東西。
- 改 schema 要：(1) `pnpm --filter @suanomics/db db:generate` 產 migration（檔名是 drizzle-kit 隨機 slug、別自己改）。(2) `build` 再跑 consumer test。(3) prod 跑 migration 由 server 容器的 `entrypoint.sh` 開機觸發一次（單一 process，沒有第二個容器會跟它搶）。
- DB migration 一律 forward-only、不寫 down。
- repo 公開的 API surface 不要直接漏 `postgres.Row`、用 inferred type 或 plain DTO 回傳。
