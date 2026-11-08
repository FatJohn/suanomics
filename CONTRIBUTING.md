# 貢獻指南

讀者：要提交程式碼或文件的貢獻者（人與 AI coding agent）
型別：流程

一個改動從開分支到合併走五步：開 issue、開分支、小步 commit、開 PR 進 `rewrite`、CI 綠燈後由維護者合併。本機環境的準備見 [本機開發](docs/operations/local-dev.md)；程式碼規則見 [程式碼規則](docs/rules/coding.md)。

## 流程

1. 先有 issue。改動範圍、驗收條件寫在 issue 裡；要換 Tech Stack 或碰設計依據〈不做的事〉的項目，先在 issue 討論。
2. 先 `git fetch`，再從 `origin/rewrite` 開分支，命名 `<type>/<issue 編號>-<主題>`，`<type>` 用 commit 的 type（例如 `feat/21-skeleton`、`docs/28-rules-and-docs`）。
3. 小而頻繁地 commit，structural 與 behavioral 分開（見〈Commit〉）。
4. push 分支、開 PR 進 `rewrite`，說明寫清楚改了什麼、怎麼驗的、關聯的 issue。
5. CI 的 `ci` 與 `gitleaks` 兩個 check 都綠，維護者 review 後以 merge commit 合併（不 squash）。agent 不自行 merge。

## Commit

commit 分兩種，同一個 commit 只放一種：

| 種類 | 內容 | tag |
|---|---|---|
| structural | 不改行為的整理：改名、搬檔、抽函式、調整格式 | `[STRUCTURAL]` |
| behavioral | 改變程式行為：功能、修 bug、改設定值 | `[BEHAVIORAL]` |

兩者都要改時，先 commit structural、跑測試確認沒壞，再 commit behavioral。從 v0（`main`）或其他 repo 搬檔時，第一個 commit 原樣搬、標 `[STRUCTURAL]`，改寫放在之後的 commit。

commit message 用英文、Conventional Commits 格式，由 husky 的 commit-msg hook 跑 commitlint 檢查：

- type 限 `feat`、`fix`、`refactor`、`chore`、`docs`、`test`、`build`、`ci`。
- 標題上限 72 字元。
- 標題或內文要含 `[STRUCTURAL]` 或 `[BEHAVIORAL]`。

```text
refactor: extract feed parser into its own module [STRUCTURAL]

feat: skip ingest on TWSE holidays [BEHAVIORAL]
```

pre-commit hook 跑 gitleaks 擋金鑰。兩個 hook 擋下時修正內容再 commit，不用 `--no-verify`。

## 測試

哪些改動要先寫測試、哪些可以先做再補，見 [程式碼規則的〈開發紀律〉](docs/rules/coding.md#開發紀律)。開 PR 前跑過這四條，全部以 0 結束：

```bash
pnpm lint
pnpm -r type-check
pnpm -r test
pnpm knip
```

碰到 drizzle schema 或 migration 時，再對本機 Postgres container 跑一次 `db:migrate`，步驟見 [本機開發](docs/operations/local-dev.md)。

## 文件

長存文件（README、本檔、`AGENTS.md`、`docs/**`）照 writing-principles skill 寫，寫完跑：

```bash
python3 tools/agents-guideline/check_docs.py --repo .
```

最後一行要是 `RESULT PASS`。設定在根目錄 `.writing-principles.conf`，排除的檔與理由寫在該檔註解；`docs/adr/` 與 `CHANGELOG.md` 不在掃描範圍。決策紀錄（`docs/adr/`）不改寫，只追加或改狀態；`CHANGELOG.md` 只追加，改動寫進 `## [Unreleased]` 區段。

改了 [程式碼規則](docs/rules/coding.md) 的 `###` 標題後，重跑產生指令讓 `AGENTS.md` 的規則清單同步：

```bash
python3 tools/agents-guideline/rules_index.py --repo . --config docs/rules/agent-rules.conf
```

## 授權

本 repo 以 Apache-2.0 授權。新增 dependency 前確認它的授權與 Apache-2.0 相容。
