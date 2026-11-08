# 2026-05-19 → 2026-05-20：P5 architectural cleanup sweep 完工

> 4-phase refactor 收尾後第一個 phase、pre-production 框架下的「architectural cleanup sweep」。把 P1-P4 累積的 codebase debt 一次清乾淨、加機械 enforcement 防 regression、為「pre-production 第一版」奠定乾淨 baseline。11 PR、兩個工作天。

## TL;DR

- **11 PR、~25 commit、橫跨 2026-05-19 → 2026-05-20**（含 spec / plan）
- **STRUCTURAL 多數、BEHAVIORAL 少數**（嚴格 Tidy First、commit-lint 機械強制）
- **零 production regression**（every PR merge 後 main 仍 build / type-check / test 全綠）
- **845 tests baseline 維持**
- **Lint baseline：2146 → 0 errors**（80% 自動修、20% 個案）、PR #1-6 per workspace 各跑一輪
- **Tailwind 4 CSS-first migration**：theme tokens 全進 `@theme` directive、`tailwind.config.js` 刪除
- **3 個新 ESLint rule 機械化紀律**：`max-lines: 300` (error) / `max-lines-per-function: 80` (warn) / `import-x/no-restricted-paths` (workspace boundary zones)
- **Dead code detection 上線**：knip + monorepo config、清掉 5 dead file + 11 unused dep
- **2 個新 dev dep**：`knip` (dead code detection)、`eslint-import-resolver-typescript` (boundary rule resolver)
- **Roadmap doc 落地**：B/C/D phases 寫進 `docs/roadmap.md`、啟動條件「真的進 production」決策後

## 11 個 PR 全貌

| PR | 風險 | Commits | Theme | Surprise |
|----|------|---------|-------|----------|
| [#16](https://github.com/FatJohn/macroeconomics-report/pull/16) | 低 | - | `@lab/shared` lint sweep（101 → 0）| 0 |
| [#17](https://github.com/FatJohn/macroeconomics-report/pull/17) | 低 | - | `@lab/db` lint sweep（53 → 0）| 0 |
| [#18](https://github.com/FatJohn/macroeconomics-report/pull/18) | 低 | - | `@lab/jobs` lint sweep（82 → 0）| 0 |
| [#19](https://github.com/FatJohn/macroeconomics-report/pull/19) | 低 | - | `apps/api` lint sweep（60 → 0）| 0 |
| [#20](https://github.com/FatJohn/macroeconomics-report/pull/20) | 低 | - | `apps/web` lint sweep（395 → 0）| 0 |
| [#21](https://github.com/FatJohn/macroeconomics-report/pull/21) | 中 | - | `apps/worker` lint sweep（1455 → 0）| 大宗、跨多 commit batch |
| [#22](https://github.com/FatJohn/macroeconomics-report/pull/22) | 中 | 2 | Tailwind 4 CSS-first migration | 0 visual regression、Preview MCP 5 page 對比 |
| [#23](https://github.com/FatJohn/macroeconomics-report/pull/23) | 中 | 4 | File size audit + max-lines rule | 6 functions warn（80 line）留 IDE 提醒、不擋 commit |
| [#24](https://github.com/FatJohn/macroeconomics-report/pull/24) | 中 | 2 | Workspace boundary + import-x rule | 需要 `eslint-import-resolver-typescript` 才能跑、否則 rule silently 跳過 |
| [#25](https://github.com/FatJohn/macroeconomics-report/pull/25) | 中 | 4 | knip + dead code + TODO audit | TODO/FIXME 0 hits（P5 lint sweep 順手清完）、剩 ~54 unused exports 多在 prompt-research 子樹 |
| [#26](https://github.com/FatJohn/macroeconomics-report/pull/26) | 極低 | 2 | docs/roadmap.md + backlog.md sync | 純 docs |

## Lint baseline 對比（PR #16-21）

| Workspace | Before | After |
|-----------|--------|-------|
| `packages/shared` | 101 | 0 |
| `packages/db` | 53 | 0 |
| `packages/jobs` | 82 | 0 |
| `packages/prompts` | 0 | 0 |
| `apps/api` | 60 | 0 |
| `apps/web` | 395 | 0 |
| `apps/worker` | **1455** | 0 |
| **Total** | **2146** | **0** |

PR #22 之後新增 6 個 `max-lines-per-function` warning（80 line 閾值、IDE highlight 提醒、不擋 commit）、屬設計預期、非 error。

## Tailwind 4 CSS-first migration（PR #22）

把 `apps/web/tailwind.config.js` 全部刪、theme tokens 改寫進 `apps/web/src/assets/main.css` 的 `@theme` directive：

```css
@import 'tailwindcss';

@theme {
  --color-bg: oklch(0.985 0.004 95);
  --color-accent: #1e3a5f;
  /* ... colors / fonts / radius / shadow */
}

@layer base {
  :root {
    --bg: var(--color-bg);  /* 短別名、相容既有元件 var(--bg) usage */
    /* ... */
  }
}
```

- 對齊 shadcn-vue v4 CSS-first 慣例
- 既有元件 `var(--bg)` / `var(--accent)` / `var(--border)` 短別名透過 `:root` 反查 `@theme`、零行為改動
- 移除 `@config` directive、不再走 JS config
- Verify：Preview MCP 截 5 page（landing / brief / brief/news / brief/analyze / transcript）+ computed style 對比 `--bg` / `--accent` / `--font-tc` / `--radius-md` 等 token 1:1 match
- Bundle size：`index.css` 39.75 → 40.06 kB（+0.3 kB、可接受）；JS 不變

## 機械化紀律（3 條新 rule）

### `max-lines: 300` (error) + `max-lines-per-function: 80` (warn)（PR #23）

```js
{
  files: ['**/*.{ts,tsx,vue,js,mjs,cjs}'],
  rules: {
    'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
  },
},
{
  files: ['**/*.{test,spec}.{ts,tsx,js,vue}'],
  rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
},
```

執行前 audit 4 個 source 超 300：

- `apps/worker/src/agents/orchestrator.ts`（368）→ 抽 `tier2-fanout.ts`（105）、orchestrator 274 行；barrel re-export 保 caller surface
- `apps/worker/src/agents/analyst.ts`（341）→ 拆 `analyst-tier1.ts`（165）+ `analyst-tier2.ts`（150）+ `analyst-shared.ts`（31）；analyst.ts 變 7 行 barrel
- `apps/worker/src/agents/podcast-writer.ts`（303）→ 抽 `podcast-writer-schema.ts`（32）、main file 275 行
- `apps/web/src/views/TranscriptView.vue`（302）→ skipBlank + skipComment 後 <300、無 violation

6 個 max-lines-per-function warning 留 IDE 提醒（皆 80-160 行 helper、其中 `runDailyBrief` 82 行只超 2 行）。

### `import-x/no-restricted-paths` zones（PR #24）

```js
'import-x/no-restricted-paths': ['error', {
  basePath: REPO_ROOT,  // import.meta.dirname、避免 pnpm --filter 從 subdir 跑時錯位
  zones: [
    { target: './apps/api',    from: './apps/worker' },
    { target: './apps/api',    from: './apps/web' },
    { target: './apps/worker', from: './apps/api' },
    { target: './apps/worker', from: './apps/web' },
    { target: './apps/web',    from: './apps/api' },
    { target: './apps/web',    from: './apps/worker' },
    { target: './packages',    from: './apps' },
  ],
}]
```

Audit 結果：0 violations。需要 `eslint-import-resolver-typescript` 處理 `.js` → `.ts` ESM mapping + `@/*` path alias + `@lab/*` workspace package、否則 resolver 失敗 → rule silently 跳過。

副作用：`useAnalyzeJob.test.ts` / `BriefAnalyzeView.vue` 內擋 `import-x/extensions` 的 inline disable 是 resolver 缺位的 workaround、resolver 上線後變 unused directive、一併移除。

### Knip dead code detection（PR #25）

`knip.json` monorepo config、每 workspace `entry` 含 `src/**/*.{test,spec}.ts`、`ignoreDependencies` 收 4 個 false-positive：`@iconify-json/lucide` / `shadcn-vue` / `ioredis` / `tailwindcss`（runtime / build / CLI 走 knip 看不到的路徑）。

清掉：

- **5 dead file**：`apps/web/src/components/ui/skeleton/{index.ts,Skeleton.vue}`、`apps/web/src/lib/utils.ts`、`apps/worker/src/lib/prompt-research/{curator/index.ts,/index.ts}`
- **11 unused dep**：`pako` × 2 + `@types/pako` × 2 + `@lab/shared` × 2（api / jobs）+ `class-variance-authority` + `clsx` + `tailwind-merge` + `tw-animate-css`

剩 ~54 unused exports / types 寫進 backlog（多在 `prompt-research/` 子樹、2026-05-10 cascade-only refactor 殘留）。

## 新 dev dep（2 個）

- `knip@^5.x`：dead code detection（spec §Out of Scope 明示「除 knip 外不加新 dep」）
- `eslint-import-resolver-typescript@^4.x`：boundary rule 必需 tooling、否則 `from './foo.js'`（TS ESM 慣例）resolver 失敗、`no-restricted-paths` 視為 unresolvable 並 silently 跳過、tsconfig `@/*` path alias 也讀不到。屬 lint infra dep、合理破例

## File 拆分（PR #23 結構性 split）

| Before | After |
|--------|-------|
| `orchestrator.ts` (368) | `orchestrator.ts` (274) + `tier2-fanout.ts` (105) |
| `analyst.ts` (341) | `analyst.ts` (7 barrel) + `analyst-tier1.ts` (165) + `analyst-tier2.ts` (150) + `analyst-shared.ts` (31) |
| `podcast-writer.ts` (303) | `podcast-writer.ts` (275) + `podcast-writer-schema.ts` (32) |

所有 barrel re-export 保 caller surface、既有 import path（`'./analyst.js'` / `'./orchestrator.js'`）無需修改。Test files 不動。

## Roadmap doc（PR #26）

`docs/roadmap.md` 收 3 個 phase：

- **B Observability + Reliability**（5-7 PRs、~2-3 週）：structured logging / error tracking / rate limit / monitoring / retry policy 統一
- **C Compliance + Security**（4-6 PRs、~2 週、需 legal expertise）：FORBIDDEN_PHRASES hardening / audit trail / secret rotation / prompt injection / OWASP / citation 驗證
- **D CI/CD pipeline**（2-3 PRs、~1 週）：GH Actions + knip strict gate + commitlint CI + coverage + preview env

啟動條件：「真的進 production」確認後啟動；順序建議 **D → B → C**（CI gate 先機械化）。

`docs/backlog.md` 同步更新「P2 架構整理」段：標出 P5 已處理三條紀律（max-lines / workspace boundary / knip）、剩餘 lib 命名 / dep 方向 / agent+prompt+schema 位置三項照舊。

## 教訓 + 經驗（給 P6/PB 用）

1. **Pre-commit hook 跑 `eslint --fix`、commit message 必須 ≤72 字 header**：兩條紀律全 PR 都會撞、習慣後一次過。
2. **lint-staged 自動 fix 會吃掉抵銷的編輯**：若一個 file 加了 disable comment 又撤掉、`git add` 後 staged 變空、commit 仍 OK。記住 staged 是 "diff vs HEAD"、不是 "diff vs 本次編輯起點"。
3. **import-x rule 沒 resolver 會 silently 跳過、要 deliberate 試一個 bad import 驗證 rule 真的能 fire**：PR #24 差點 ship 不會擋的 rule、靠 inline test 才抓到。
4. **knip 對 test files 預設不認識、需要把 test glob 列進 entry**：first knip run 報 91 個 unused file（多是 test）、加 `**/*.{test,spec}.ts` 進 entry 後降到 5 個。
5. **`max-lines-per-function: 80` 比 CLAUDE.md `50` 寬鬆是務實**：prompt builder / `runDailyBrief` 等 helper 80 行剛好擺平；50 行會逼成不必要 split。

## P5 完工狀態

- 11 PR 全 merge 進 main
- `pnpm -r build && type-check && test && lint`：全綠（含 6 warning、皆設計預期）
- Lint baseline：2146 → 0 errors（80% auto-fix / 20% 個案）
- 機械化紀律 3 條上線（max-lines / workspace boundary / knip）+ P4 commit-lint 共 4 條機械化紀律
- 「pre-production 第一版」乾淨 baseline 達成、可長期維護
- Phase B / C / D 收進 [`docs/roadmap.md`](../roadmap.md)、「真的進 production」決策後再啟動
