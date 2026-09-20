# @suanomics/shared — 跨包共用契約

葉子層、零 internal dep。只放「前後端 + worker 都會用到的業務契約」：Zod schema、compliance 攔截字眼、citation 結構。

全圖見 [模組地圖](../../docs/architecture/module-map.md)。

## 目錄

```
src/
├── index.ts          # barrel re-export
├── compliance.ts     # FORBIDDEN_PHRASES + sanitizePhrases()
├── market-brief.ts   # MarketBriefSchema / CascadeChainSchema /
│                     # NarrativeSchema / MarketBriefCitationSchema 等
└── podcast.ts        # PodcastSchema / PodcastStorylineSchema
```

## Entry

`src/index.ts` re-export 三個 module 的 public surface。Consumer 全部 `import { ... } from '@suanomics/shared'`、不走 deep path。

## 常用命令

```bash
pnpm --filter @suanomics/shared build       # tsc → dist/
pnpm --filter @suanomics/shared test        # vitest
pnpm --filter @suanomics/shared type-check
pnpm --filter @suanomics/shared lint
```

## 依賴

- 只依 `zod`、無任何 `@suanomics/*` workspace dep。
- 不依 `drizzle-orm`、不依 `@suanomics/jobs`、不依 `vue`、不依 `hono`。

## 被誰用

| Consumer | 用途 |
|----------|------|
| `apps/web` | type-only：fetch 回傳的 type |
| `apps/server` | LLM structured output validation、compliance 攔截 |
| `@suanomics/db` | repo 寫入時 schema 推回的 type |
| `@suanomics/jobs` | type 上游 |
| `@suanomics/prompt-research` | compliance + brief 契約 |

> `apps/server` 目前**沒有**列 `@suanomics/shared` dep（route input 用 route-local zod 驗證、是刻意清掉的 unused dep）。

## 約束

- 改任何 schema 要先 `pnpm --filter @suanomics/shared build`，再跑 consumer 的 test / build。
- 不放任何 runtime 業務邏輯（除 `sanitizePhrases` 等純函數）。
- 不能 import `@suanomics/db` / `@suanomics/jobs`（會打破葉子層約束）。

## 編輯紀律

- 改 `FORBIDDEN_PHRASES` 屬 compliance 變更、commit 訊息要 `[BEHAVIORAL]`、且需跑 server compliance test。
- 改 schema 屬 contract 變更、可能需要 DB migration（若 worker 寫 DB 的 shape 變）。
