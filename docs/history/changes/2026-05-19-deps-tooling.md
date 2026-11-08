# 2026-05-19：P4 deps + tooling refactor 完工

> 4-phase refactor 收尾 phase。dependency hygiene + 紀律工具 + P3 deferred cleanup、7 PR 風險遞增、每 PR 獨立可 revert。

## TL;DR

- **7 PR、~43 commit、~7 hr 工**（含 brainstorm / spec / plan）、橫跨 2026-05-18 evening → 2026-05-19 morning
- **STRUCTURAL 多數、BEHAVIORAL 少數**（嚴格 Tidy First、commit-lint hook 從 PR #1 起機械強制）
- **零 production regression**（every PR merge 後 main 仍 build / type-check / test 全綠）
- **843 → 845 test baseline**（+2 merger metric parity tests in PR #6）
- **Tooling 上線**：husky + lint-staged + commit-lint、`[STRUCTURAL] | [BEHAVIORAL]` tag 機械強制
- **Major bumps 全升**：zod 3→4、@google/genai 1→2、@hono/node-server 1→2、commander 12→14、@types/node 22→25、@antfu/eslint-config 8→9、tailwindcss 3→4
- **Deprecated 替換**：lucide-vue-next → @iconify/vue、string-similarity → fastest-levenshtein
- **P3 deferred 4 項全做**：SourceSpec dedup、wrapAuditLifecycle helper、runCompile writtenPaths、`_candidates/` retention

## 7 個 PR 全貌

| PR | 風險 | Commits | Theme | LLM cost | Surprise |
|----|------|---------|-------|----------|----------|
| [#9](https://github.com/FatJohn/macroeconomics-report/pull/9) | 極低 | 5 | husky / lint-staged / commit-lint | 0 | 0 |
| [#10](https://github.com/FatJohn/macroeconomics-report/pull/10) | 低 | 15 | Stage 1 patch/minor batch | 0 | 0 |
| [#11](https://github.com/FatJohn/macroeconomics-report/pull/11) | 低-中 | 7 | P3 deferred cleanup（4 items） | 0 | helper API 設計小幅 widen |
| [#12](https://github.com/FatJohn/macroeconomics-report/pull/12) | 中 | 4 | @types/node 25 + commander 14 + antfu 9 + @hono/node-server 2 | 0 | **零 source fix needed** |
| [#13](https://github.com/FatJohn/macroeconomics-report/pull/13) | 高 | 4 | zod 3 → 4 | 0 | surface 比預期小、`.url()/.email()` 仍 work |
| [#14](https://github.com/FatJohn/macroeconomics-report/pull/14) | 高 | 3 | @google/genai 1→2 + merger metric | < $0.01 | **零 source fix on @google/genai**（v2 breaking 全在新 Interactions API） |
| [#15](https://github.com/FatJohn/macroeconomics-report/pull/15) | 高 | 3 | tailwindcss 4 + shadcn 2.7 + @iconify/vue | 0 | utility renames 是 no-op（repo 未用 deprecated classes） |

## 紀律工具細節（PR #1）

新增 dev deps：
- `husky@^9.1.7`
- `lint-staged@^17.0.5`
- `@commitlint/cli@^21.0.1`
- `@commitlint/config-conventional@^21.0.1`

### `.husky/pre-commit`
```sh
pnpm exec lint-staged
```

### `.husky/commit-msg`
```sh
pnpm exec commitlint --edit "$1"
```

### `.lintstagedrc.json`
```json
{ "*.{ts,vue,tsx,js,mjs,cjs}": ["eslint --fix"] }
```

### `commitlint.config.js` 重點
- extends `@commitlint/config-conventional`
- 自訂 plugin rule `must-have-structural-or-behavioral-tag`、用 regex `\[(STRUCTURAL|BEHAVIORAL)\]` 偵測 message raw（subject + body 任一處）
- `type-enum` 限定 `feat / fix / refactor / chore / docs / test / build / ci`
- `header-max-length: 72`
- `subject-case: [0]`（disable、容繁中 + 英中混用）

### 不引入 prettier（決策）
sticky to `@antfu/eslint-config` + `eslint-stylistic`、避免雙 formatter 衝突、PoC 階段無實際痛點。

## Stage 1 patch/minor batch（PR #2）

15 個 dep、每個一個 commit：
- `@vitejs/plugin-vue` 6.0.6 → 6.0.7
- `postcss` 8.5.10 → 8.5.14
- `reka-ui` 2.9.6 → 2.9.7
- `vite` 8.0.8 → 8.0.13
- `tsx` 4.21.0 → 4.22.2
- `vue-tsc` 3.2.6 → 3.3.0
- `vue` 3.5.32 → 3.5.34
- `vue-router` 5.0.4 → 5.0.7
- `vitest` 4.1.4 → 4.1.6
- `fast-xml-parser` 5.7.1 → 5.8.0
- `tailwind-merge` 3.5.0 → 3.6.0
- `eslint` 10.2.0 → 10.4.0
- `hono` 4.12.14 → 4.12.19
- `bullmq` 5.76.1 → 5.76.10
- `shadcn-vue` 2.6.2 → 2.7.3（只升 dep version、v4 config 對齊留 PR #7）

## P3 deferred cleanup（PR #3）

4 個 deferred items 全做：

### 1. SourceSpec schema dedup（`5356dba`）
- worker `apps/worker/src/lib/prompt-research/types.ts` 刪除 local `SourceSpecSchema`、re-export from `@lab/jobs`
- 移除 `runPromptRefresh.ts` 的 `as SourceSpec[]` cast
- `SourceKindSchema` 與 `PipelineKindSchema` 保留 local（jobs 未 export）

### 2. wrapAuditLifecycle helper（`c74fa29` + `d63ee0e`）
- TDD 嚴格遵守（4 個 spec test、red → impl → green）
- Helper signature：`wrapAuditLifecycle<TPayload, TResult>({ audit, processFn, makeResultRef, makeMetadata? })`
- index.ts **247 → 183 行（-26%）**、6 個 processor 套 helper
- **processAnalyze 保留 inline**：用 `markMetadata(partial)` side-channel 在 process 中段寫 cache routing metadata、helper 不暴露 auditId 給 processFn、強行 fit 失真
- 行為 byte-for-byte 不變（spec reviewer 對 6 processor 逐個對照、含 error path semantics 分析）

### 3. runCompile 回傳 writtenPaths（`6dd64ae` + `ff8572f`）
- `RunCompileResult` 加 `writtenPaths: string[]`
- 4 個 writeFile 收集 path 回傳
- `run-prompt-refresh.ts` 消費 result.writtenPaths、移除 hardcoded 4 paths

### 4. `_candidates/<runId>/` retention policy（`fadca84` + `22da9df`）
- 純函式 `pruneOldCandidates({ candidatesBase, maxRuns })`、TDD 3 個 spec test
- count-based、保留最近 10 個 dir（依 mtime 排序）、其餘 rm -rf
- 接進 `runPromptRefresh` 每次 compile 後自動 prune
- `RunPromptRefreshResult` 加 `candidatesPruned: string[]` 回傳

## Major bumps 結果

### Type/CLI/lint majors（PR #4、零 source fix）

| Package | From | To | Surface |
|---------|------|-----|---------|
| `@types/node` | 22.19 | 25.9.0 | Buffer/Uint8Array 區分變嚴、本 repo 未踩 |
| `commander` | 12.1.0 | 14.0.3 | 3 個 CLI script 用、`--help` smoke 全過 |
| `@antfu/eslint-config` | 8.2.0 | 9.0.0 | lint error count 跟 v8 相同（stash + reinstall 對照）、未引入新 rule |
| `@hono/node-server` | 1.19 | 2.0.3 | `/health` smoke 200 |

### zod 3 → 4（PR #5）

實際 breaking surface（5 種 patterns）：
- `z.record(value)` → `z.record(key, value)` 兩參數強制（@lab/db）
- `z.ZodEffects` 型別移除 → 拿掉顯式回傳型別（@lab/shared）
- `z.ZodIssueCode.custom` enum 移除 → string literal `'custom'`（@lab/shared）
- `.nullish().transform()` 在 v4 變必填 key → 追加 `.optional()`（worker RawSourceRefSchema 3 fields）
- `_def.typeName` 內部 API 移除 → 改用 `.isOptional()` public API（worker drift guard test）

**沒碰到**：`z.string().email/url/uuid/datetime()` 仍 work、drizzle-zod 未用、ZodError.errors 未存取、discriminatedUnion 既有用法在 v4 build clean。

### @google/genai 1 → 2（PR #6）

**零 source fix**。v2 breaking 全在新 Interactions API（multi-turn agent sessions、SSE 事件、response_format polymorphism）、本 repo 只用 `GenerateContent` + `Files` + native TTS、那塊 surface 在 v2 完全未變。Real Gemini smoke 跑通：latency 2.2s、cost $0.000007、structured output 正確 parse。

### tailwindcss 3 → 4（PR #7）

- 加 `@tailwindcss/vite` plugin、`vite.config.ts` 整合
- CSS 入口 `@tailwind base/components/utilities` → `@import "tailwindcss"` + `@config "../../tailwind.config.js"`
- `postcss.config.js` 移除 tailwindcss plugin entry、autoprefixer 保留
- **不做 CSS-first config migration**（保留 JS config + `@config` directive、CSS-first 留 P5）
- `shadcn-vue` v4 對齊只改 `components.json` 一個 field
- **utility renames 是 no-op**：grep `shadow-sm` / `rounded-sm` / `bg-opacity-` 等 0 hits、repo 從未用 deprecated classes

## Deprecated 替換

### `lucide-vue-next` → `@iconify/vue`（PR #7）

7 個 `.vue` file 替換 icon import：
- `AppHeader.vue`、`BriefDetailsAccordion.vue`、`CitationCard.vue`、`BriefView.vue`、`LandingView.vue`、`TranscriptView.vue`、`BriefNewsView.vue`

API shift：`:size` + `:stroke-width` → `:width` + `:height`、SVG pre-baked、stroke-width 不可控（lucide 預設 2、原本 1.75）。visual smoke 看不出明顯差異。

`Loader2` 對應到 `lucide:loader-circle`（lucide v4 改名）。

### `string-similarity` → `fastest-levenshtein`（PR #6）

merger.ts 用 `compareTwoStrings`（Sørensen-Dice bigram）換 `distance` + 自訂 `similarityRatio` 正規化：

```ts
function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - distance(a, b) / maxLen
}
```

**FUZZY_THRESHOLD 0.7 → 0.6**（保守放鬆）：canonical 案例 `'央行升息時'` vs `'當央行升息'` 在 Dice = 0.75、Levenshtein ratio = 0.6、對短 CJK 字串 Levenshtein 比 Dice 嚴、threshold 對應放鬆。+2 個 parity tests 鎖 grouping 行為。

## 驗證流程亮點

### Real Gemini smoke（PR #6）

不跑全 cascade（DB empty）、寫 inline smoke script `/tmp/genai-v2-smoke.ts`、呼叫 `callAgentLLM` with structured schema：

```
[smoke] LLM call: agent=decomposer tokensIn=31 tokensOut=15 costUsd=0.000007 latencyMs=2233ms
[smoke] Result: { "greeting": "Hello P4!", "confidence": 0.95 }
[smoke] PASS: @google/genai v2 GenerateContent API works at runtime
```

驗證點：client init / `models.generateContent` / `res.text` / `usageMetadata.{promptTokenCount,candidatesTokenCount}` / `responseSchema` / abort signal。

### Visual smoke via Claude Preview MCP（PR #7）

跑 dev server、截 3 個 page：
- **Landing**：icons 全顯（newspaper、youtube、arrow-right）、layout 對、CTA buttons 對
- **Transcript tool**：YouTube icon + form + button、active nav state 對
- **Brief page**：header/footer icons 對（DB empty 所以 content 區是空、預期）
- Console 0 warn / 0 error

## Known caveats / 留 backlog

- **`@lab/shared` 102 pre-existing lint errors**：橫跨 P1-P4 baseline 維持、不在本 phase scope、留 backlog 清理
- **其他 workspace 也有 pre-existing lint debt**：apps/web 57、apps/api 447、apps/worker 82（部分）、apps/worker 60、apps/worker 1498（看數量級判斷影響）。lint-staged 只把關被 touch 的 file、不擋 PR。後續可 sweep
- **Icon stroke-width 微差**：lucide 預設 2 vs 原本 1.75、視覺上看不出
- **tailwindcss CSS-first migration 未做**：保留 JS config 透過 `@config` directive、CSS-first 留 P5（架構級工作）
- **TypeScript 6 / ESLint 10 未跨 major**：依母 plan 原決策、技術成熟度未到 + 風險不必要
- **Vite 8 已穩定、未追下一個 major**：8.0 stable、本期不跳

## 結語

P4 是 4-phase refactor（P1 workspace split → P2 CLI via queue → P3 prompts pipeline → P4 deps + tooling）的最後一個 phase。意外發現多個「assumed risky」的 major bump 實際上 surface 極小（zod 4 / @google/genai 2 / @hono/node-server 2 / @types/node 25 / commander 14 / antfu 9 / tailwindcss 4 utility renames 全屬此類）。

**主要收穫**：
- **commit-lint 機械強制 Tidy First**：之後所有 phase 享受 `[STRUCTURAL] | [BEHAVIORAL]` tag 紀律、不再靠記憶
- **subagent-driven dev 紀律穩**：spec reviewer + code quality reviewer 兩階段、catch 多個設計級問題（wrapAuditLifecycle I1 「processAnalyze 不能套 helper」、AuditRepoLike type widening 必要性、merger threshold 0.7 → 0.6 etc）
- **Dep migration cost 是「discovery」、不是「fix」**：實際 fix surface 多半比讀 changelog 想像的小 5-10 倍
- **PoC 階段 staging verify ≠ Zeabur preview env**：local docker stack + Claude Preview MCP screenshots + targeted real-API smoke 已足

PoC 進入 P5 階段（如有）規劃時、可考慮：
- CSS-first tailwind config migration
- `@lab/shared` 跟其他 workspace 的 pre-existing lint debt sweep
- TypeScript 7 / ESLint 11 評估（若 release 且風險可控）
- prettier 再評估（若有具體 .md / .yaml format 痛點出現）
