# 2026-05-20：P6 codebase-organization cleanup 完工

> P5 機械化紀律之後第一個 phase、「整理 codebase」軸線收尾。位置 / 命名 / 邊界 / dead code 殘渣靠 lint 抓不到的、deliberate 處理乾淨。5 PR、~半天工。

## TL;DR

- **5 PR + 1 docs PR、~12 commit、~半天工**（含 spec / plan）
- **STRUCTURAL 多數、BEHAVIORAL 少數**（嚴格 Tidy First）
- **零 production regression**（every PR merge 後 main 仍 build / type-check / test 全綠）
- **845 tests baseline 維持**（22 個 test 從 worker 搬到新 prompt-research workspace、總數不變）
- **`max-lines-per-function: 80` warnings**：6 → 0（PR #1 全收）
- **knip unused exports/types**：~54 → **0**（PR #4 全收、public-API 透過 knip.json entry expansion 宣告）
- **Workspace 結構變化**：`@lab/prompts` 出、`@lab/prompt-research` 入；`apps/worker/src/lib/` 廢除
- **Agent self-contained**：每 runner 配 co-located `.prompt.ts`、schema 仍 import from `@lab/shared`
- **prompt-research 獨立演進可能**：新 workspace `@lab/prompt-research`、`.` + `./curator` 雙 subpath、77 file 從 worker 內遷出

## 5 個 PR 全貌

| PR | 風險 | Commits | Theme | Surprise |
|----|------|---------|-------|----------|
| [#30](https://github.com/FatJohn/macroeconomics-report/pull/30) | 中 | 10 | PR #1 cleanup warmup（4 unused export + 6 max-lines refactor）| 0 |
| [#31](https://github.com/FatJohn/macroeconomics-report/pull/31) | 中 | 2 | PR #2 agent prompt co-location（廢 `@lab/prompts`、prompt 進 agent）| `_shared.prompt.ts` 在 eslint --fix 過程被砍（原 SHARED_PREAMBLE import 從未被使用、自動清掉後 orphan）|
| [#32](https://github.com/FatJohn/macroeconomics-report/pull/32) | 高 | 1 | PR #3 extract `@lab/prompt-research` workspace（73 file `git mv`）| 抽出時發現 `prompt-refresh.ts` 內有 dynamic `import()`、原 audit 漏；`types.ts` re-export 從 `@lab/jobs` 來的 `SourceSpec`、新 workspace 補 `@lab/jobs` dep |
| [#33](https://github.com/FatJohn/macroeconomics-report/pull/33) | 低 | 2 | PR #4 knip 收尾（47 → 0 unused）| knip 6 不支援 inline `// knip-ignore` comment、改用 knip.json entry expansion 宣告 public-API |
| [#34](https://github.com/FatJohn/macroeconomics-report/pull/34) | 低 | 1 | PR #5 lib/ 扁平化（`_p-map.ts` / `_wrap-audit-lifecycle.ts`）| 0 |

## Lint baseline 對比

| Metric | Before P6 | After P6 |
|--------|-----------|----------|
| `max-lines: 300` errors | 0 | 0 |
| `max-lines-per-function: 80` warnings | 6 | **0** |
| `knip` unused exports + types | ~54 | **0** |
| `pnpm -r lint` errors | 0 | 0 |

## Workspace 結構變化

| Before | After | Δ |
|--------|-------|---|
| `packages/db` | `packages/db` | — |
| `packages/jobs` | `packages/jobs` | — |
| `packages/prompts` | ❌ 廢除 | - |
| 無 | `packages/prompt-research` | + |
| `packages/shared` | `packages/shared` | — |
| `apps/api` | `apps/api` | — |
| `apps/web` | `apps/web` | — |
| `apps/worker` | `apps/worker` | — |

7 → 7 workspace（一進一出）。`@lab/prompts` 工作量挪進 `apps/worker/src/agents/<name>.prompt.ts`；`@lab/prompt-research` 從 `apps/worker/src/lib/prompt-research/` 抽出。

## Agent prompt co-location（PR #2）

廢除 `@lab/prompts` workspace、prompt 字串搬到 agent runner 旁邊：

- `packages/prompts/src/analyst-tier1.system.ts` → `apps/worker/src/agents/analyst-tier1.prompt.ts`
- 6 個 prompt file + 1 個 test 共 8 file `git mv`
- 6 個 runner（analyst-tier1 / analyst-tier2 / decomposer / narrative-writer / podcast-writer / synthesizer）改 import 從 `@lab/prompts` → `./<name>.prompt.js`
- 3 個 test mock 路徑跟著更新

副作用：`_shared.system.ts` export 的 `SHARED_PREAMBLE` 在 6 個 prompt file 內 imported but never used（原碼已 inline 進各 SYSTEM_PROMPT template literal）。pre-commit eslint --fix 順手移除 unused import、`_shared.prompt.ts` 變 orphan、commit 2 一併刪。零行為改動。

結果：agent self-contained、改 prompt 與改 runner 在同一 dir 內、不再跨 workspace 跳。

## prompt-research workspace 抽出（PR #3）

`apps/worker/src/lib/prompt-research/` 73 file 整 subtree 抽到 `packages/prompt-research/`：

- `package.json`：`@lab/prompt-research`、`exports` field 含 `.` + `./curator` 雙 subpath
- `src/index.ts` 只 export pipeline runtime 用的 6 個 surface：`runCompile` / `pruneOldCandidates` / `mergeDigests` / `DEFAULT_SOURCES` / `dispatchSource` / `Digest` / `SourceSpec` type
- 其他 sub-module（`curator/` / `distillers/` / `sources/yt-transcript/`）保 internal、CLI 走 `@lab/prompt-research/curator` subpath import
- `apps/worker/package.json` 加 `@lab/prompt-research` dep、自動移除 `fastest-levenshtein` / `youtube-transcript-plus`（轉到新 workspace 直接依）
- `apps/worker/src/lib/prompt-research/` 空 dir 刪
- `apps/worker/src/prompt-research/run-prompt-refresh.ts` + 4 個 CLI script + 對應 test mock 改 import

抽出後 worker 體積大幅縮、prompt-research workspace 可獨立演進（對齊 backlog P1「Transcript 工具擴張」起點素材設計）。

## knip 收尾（PR #4）

PR #3 抽出後 knip 報 47 個 unused export/type、處理：

- **Worker 4 個 unused type**：`AgentName` / `SourceRow` / `CorpusRefreshPayload` 移 `export` keyword（仍存在但 internal）；`CascadeHypothesis` type alias 整個砍（沒人用、Schema 仍 export）
- **prompt-research 43 個**：
  - 多數移 `export` keyword 變 internal（curator schemas / merger helpers / response schemas / 部分 type schemas）
  - public-API surface（`sources/yt-transcript/index.ts` 的 lens 系統 types / `types.ts` 的 source config schemas）透過 `knip.json` entries expansion 宣告為 deliberate API surface

knip 6 不支援 inline `// knip-ignore` comment（與 spec / plan 假設不同）、改用 knip.json entry expansion 機制。

結果：knip 報告從 47 → **0**、public-API surface 仍對外 export、無 inline ignore noise。

## `apps/worker/src/lib/` 扁平化（PR #5）

PR #3 抽出 prompt-research 後 `lib/` 只剩 2 個 single-file utility（`p-map.ts` + `wrap-audit-lifecycle.ts`）、不夠分量保留 dir。改用 `_` prefix 對齊既有 `agents/_truncate.ts` 慣例：

- `lib/p-map.ts` → `_p-map.ts`
- `lib/wrap-audit-lifecycle.ts` → `_wrap-audit-lifecycle.ts`
- test files 跟著 `git mv` 保 history
- 3 個 caller import path 同步更新
- 空 `lib/` dir 刪

## 教訓 + 經驗（給未來 phase 用）

1. **`git mv` 保 history**：跨 workspace 大規模搬動（PR #3 73 file）用 `git mv` 而非 `rm`+`add`、reviewer 用 `git log --follow` 仍能追 file 歷史
2. **eslint --fix 在 commit hook 內會「順手」刪 unused import**：PR #2 `_shared.prompt.ts` 被自動 orphan-then-delete 是教訓——下次跨 file refactor 前先檢查目標 file 對 caller 內哪些 export 真的有 consumer、避免「自動清理」吃掉看似 deliberate 的 file
3. **knip 6 配 `// knip-ignore`**：不支援、必須用 `knip.json` entries 擴展、entry expansion 是宣告 public-API 的標準方法
4. **pnpm workspace `exports` subpath**：`packages/prompt-research/package.json` 用 `exports: { ".": ..., "./curator": ... }` 開放 deep import、CLI consumer 走 `from '@lab/prompt-research/curator'` 而非 internal path、合理 boundary
5. **dynamic `import()` 容易在 audit 漏掉**：PR #3 漏 `prompt-refresh.ts` 內的 dynamic import、`grep -rEn "from ['\"].*<module>"` 抓 static import OK、但 `import('<module>')` 要另外 grep。下次大重構 audit 兩種 pattern 都跑
6. **抽 workspace 時 deps 重新評估**：原 worker 拉的 `fastest-levenshtein` / `youtube-transcript-plus` 是 prompt-research 用的、抽出後 worker 不再依、自動清掉 worker package.json + 新 workspace 補上。pnpm `--filter <ws> remove <pkg>` 是 helper
7. **test count 對帳**：PR #3 後 worker tests 從 539 → 317、新 workspace 217、合計 534 + DB skip 20 + 其他 ws → 845 baseline 維持。tests 沒 lost、只是搬家

## Backlog 更新

P5 PR #25 加入的「P2 knip unused exports 後續清理」項目可以從 backlog 移除——P6 PR #4 已全部處理。

## P6 完工狀態

- 5 PR + 1 docs PR 全 merge 進 main
- `pnpm -r build && type-check && test && lint`：全綠
- knip：0 unused exports + 0 unused types + 0 unused dependencies
- agent self-contained（runner + prompt co-located）
- prompt-research workspace 可獨立演進
- 「pre-production 第一版」乾淨 baseline 補上最後一塊
- Phase B / C / D（observability / compliance / CI/CD）待「真的進 production」決策後啟動（[docs/roadmap.md](../roadmap.md)）
