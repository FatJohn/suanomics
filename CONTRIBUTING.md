# Contributing

謝謝你願意花時間看這個專案。這份文件說明開發環境怎麼起、測試怎麼跑、commit 紀律，以及什麼樣的貢獻比較容易被接受。

## 開發環境

前置需求與完整 Quick Start 見 [README.md](README.md)。這裡只補充幾個容易踩到的細節。

- **Node.js 22**（`.nvmrc` 鎖 `22`、`package.json` 的 `engines.node` 是 `>=22`）。
- **pnpm 由 `packageManager` 欄位自管**——不要自己另外裝一個特定版本，跑 `corepack enable` 之後 `pnpm install` 就會自動抓到 root `package.json` 裡 `packageManager` 指定的版本。
- **Postgres 18**，用 repo 內建的 `docker-compose.yml` 起本機資料庫：

  ```bash
  docker compose up -d postgres
  ```

  這會起一個叫 `suanomics`（帳號密碼都是 `postgres`）的資料庫，監聽本機 5432 port。跑 migration 與 seed 的步驟見 README 的 Quick Start。

- 兩個 `.env.example`（`apps/server/.env.example`、`apps/web/.env.example`）要各自複製成 `.env` 並填值；本機開發至少要一把可用的 LLM provider key（預設是 `GEMINI_API_KEY`）。**跑測試不需要真的 LLM key**，見下一節。

## 測試

CI 跑的是 `pnpm -r test`（`.github/workflows/ci.yml` 的 Test 步驟），而且**帶一個真實的 Postgres 18 service container**。這代表：

- **正確的本機做法是先起 Postgres 再測試**（`docker compose up -d postgres`），這樣 `pnpm -r test` 才會跟 CI 同口徑。
- 如果你手上暫時沒有本機 Postgres、只想先跑一輪，這個 repo 大量的 repo／route 測試會直接打真的資料庫（刻意不 mock，避免測試綠燈但實際 DB 邏輯是壞的），所以會看到一大片因為連不到 `localhost:5432` 而失敗的測試。**這是預期行為、不是你把東西弄壞了**——判斷方式很單純：失敗訊息裡出現 `ECONNREFUSED ... :5432`（port 跟著你的 `DATABASE_URL`）就是這一類；還沒建 `apps/server/.env`、shell 也沒 export `DATABASE_URL` 時，訊息會是 `DATABASE_URL not set`，同樣屬於這一類。

  無 Postgres 時，完整 `pnpm -r --no-bail test` 實測結果（供對照，數字會隨測試增減而變動，重點是「哪些檔案會紅、為什麼」）：

  | package | 結果 | 全紅原因 |
  |---|---|---|
  | `packages/db` | 大量失敗 | 這個 package 幾乎全是真實 DB 測試 |
  | `apps/server` | 少數失敗 | `src/agents/retriever.test.ts` 整個測試檔案載入失敗、`src/http/routes/ops.db.test.ts` 與 `tools/cli/demo-seed.db.test.ts` 的全部測試 |
  | `packages/jobs` | 少數失敗 | `src/audit.db.test.ts` |
  | `packages/shared`、`apps/web`、`packages/prompt-research` | 全綠 | 這幾個 package 沒有真實 DB 測試 |

  想只跑不需要資料庫的純邏輯測試，可以用 `pnpm --filter '!@suanomics/db' -r --no-bail test` 排除掉紅得最兇的 `packages/db`；但 `apps/server` 與 `packages/jobs` 上面那幾個檔案還是會因為同一個原因（連不到 DB）繼續紅，這仍然是預期行為，不用去改它們。

- **提 PR 不需要真的 LLM API key。** CI 裡 `GEMINI_API_KEY` 被設成假值 `test-key`（見 `.github/workflows/ci.yml`），足以讓初始化路徑不炸；測試本身多半是 mock LLM 呼叫，不會真的打 API。這代表你完全可以不申請任何 LLM provider 的 key，PR 照樣能跑過 CI。

## Lint 與型別檢查

**Lint 一律用 `pnpm lint`（root 的 `eslint .`），不要用 `pnpm -r lint`。** 兩者差很多：`-r` 是逐 workspace 跑，**不含 root 這個 project**，所以 root 目錄下的設定檔（`package.json`、`eslint.config.js` 等）一個都不會被掃到。CI 跑的正是 `pnpm lint`，本機用 `pnpm -r lint` 全綠不代表 CI 會過。

型別檢查用 `pnpm -r type-check`（這個要逐 workspace 跑，沒有上面 lint 那個坑）。

## Commit 紀律：Tidy First（Kent Beck）

這個 repo 用 husky + commitlint 強制兩件事：

1. **每個 commit message 的 subject 或 body 必須帶 `[STRUCTURAL]` 或 `[BEHAVIORAL]` 標籤**，用來標記這個 commit 是「整理」還是「改行為」。
2. **subject 符合 [Conventional Commits](https://www.conventionalcommits.org/)**、長度不超過 72 字元，`type` 限定在 `feat`、`fix`、`refactor`、`chore`、`docs`、`test`、`build`、`ci` 之中。

背後的方法論是 Kent Beck《Tidy First?》裡的 structural／behavioral 分離：

- **structural**：不改變行為的整理——改名、搬移檔案、抽出函式、調整格式。跑測試前後行為完全一樣。
- **behavioral**：真的改變了系統的行為——修 bug、加功能、改邏輯。

**判斷方式很直接**：如果把這個 commit revert 掉，使用者或呼叫端會不會看到不一樣的結果？會，就是 behavioral；不會（純粹整理內部結構），就是 structural。

**兩者絕對不能混在同一個 commit**——如果一個改動同時需要整理程式碼跟改變行為，先做 structural（整理完先 commit、跑一次測試確認沒壞），再在下一個 commit 做 behavioral。這樣 review 的人才能分開看「這裡有沒有整理錯」跟「這裡改的邏輯對不對」。

這個 repo 實際的 commit 範例（`git log` 裡找得到）：

```
refactor: extract the seed gate into a testable function [STRUCTURAL]
docs: fix the model table and document custom providers [STRUCTURAL]
feat: choose the LLM provider explicitly [BEHAVIORAL]
feat: gate third-party sources behind an opt-in [BEHAVIORAL]
```

**不要用 `--no-verify` 跳過 commit hook**——這個 repo 把跳過 hook 視為違反紀律，即使 hook 報錯也請直接修好再 commit，不要繞過去。

**小而頻繁優於大而罕見。** 與其憋一個大 PR，不如拆成幾個各自可獨立驗證的 commit／PR。

## PR 流程

1. Fork 或開 feature branch，一個 PR 只做一件事。
2. 確保本機 `pnpm lint`、`pnpm -r type-check`、`pnpm -r test`（有 Postgres 的情況下）都過。
3. 開 PR、描述清楚動機與做了什麼；CI（`ci` job 的 `build` / `lint` / `type-check` / DB migrate / `test`，以及 `docker` job 的兩個 image build）要全綠才會被考慮 merge。
4. 由維護者 review 並 merge（這個 repo 用一般的 merge commit，不用 squash merge，所以 PR 裡每個 commit 的訊息都會留在歷史裡——commit 紀律因此更重要）。
5. 大改動（新功能、架構調整）建議先開 issue 討論方向，再動手實作，避免做完才發現方向不合。

## 什麼樣的貢獻會被接受

歡迎的方向：bug 修復、測試覆蓋率補強、開發工具與 DX 改善、文件修正、在既有架構下的功能擴充（見 [ROADMAP.md](ROADMAP.md) 的「想做的方向」）。

修改任何 LLM agent 的 prompt 之前，**務必先讀 [compliance-and-citations.md](docs/architecture/compliance-and-citations.md)**——這個專案對輸出內容有硬式的投信投顧法合規攔截，動 prompt 的 PR 一定要連同跑過 compliance 相關測試。

明確不接受、請不要在 PR 裡加入的方向（範圍決策，非技術優劣判斷）：

- 用戶註冊、登入、付費機制
- LINE Bot 整合
- 券商 API 串接、券商授權或持股管理
- 圖片 OCR、LINE 截圖辨識
- pgvector 或其他向量檢索式 RAG（目前語料規模用 prompt 硬塞就夠、暫不考慮）
- 把 backend 換成其他語言（目前是 TypeScript + Node.js，這是已經做過的決策）
- 引入額外的規格框架（例如 OpenSpec 之類的工具）

如果不確定一個想法算不算在範圍內，先開 issue 問，不要直接開一個大 PR。
