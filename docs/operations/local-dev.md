# 本機開發

讀者：要在本機建置、測試、跑網站的貢獻者與 AI coding agent
型別：接入指南

照本頁從 fresh clone 做到 build、lint、type-check、測試、資料庫 migration 全過，並在瀏覽器打開網站。資料庫一律用本機的 Postgres container，不連 Neon production。分支、commit 與 PR 的規矩見 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

## 前置條件

- Node 26：版本寫在根目錄 `.nvmrc`，用 nvm、mise 等版本管理工具切換。
- pnpm 11.8.0：版本由根目錄 `package.json` 的 `packageManager` 鎖定，安裝方式見 [pnpm 官方安裝說明](https://pnpm.io/installation)。
- gitleaks：husky 的 pre-commit hook 會呼叫它，沒裝就 commit 不了；macOS 用 `brew install gitleaks`。
- Docker：起本機 Postgres 18 用。
- git commit 簽章：`rewrite` 的 ruleset 要求 commit 有簽章，設定方式見 [GitHub 的 commit 簽章說明](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits)。

## 步驟

1. 在 repo 根目錄安裝依賴，同時裝上 husky hook：

   ```bash
   pnpm install --frozen-lockfile
   ```

2. 建置所有 workspace。`@suanomics/shared` 的 exports 指向 `dist`，沒建置過的話下一步的 type-check 會找不到模組：

   ```bash
   pnpm -r build
   ```

3. 跑 lint、type-check、測試與未使用程式碼檢查，四條都要以 0 結束。lint 用根目錄的 `pnpm lint`，`pnpm -r lint` 掃不到根目錄的設定檔：

   ```bash
   pnpm lint
   pnpm -r type-check
   pnpm -r test
   pnpm knip
   ```

4. 起一個本機 Postgres 18 container。port 用 55432，避開本機可能已在跑的 Postgres：

   ```bash
   docker run -d --rm --name suanomics-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18
   docker exec suanomics-pg pg_isready -U postgres
   ```

   第二條印出 `accepting connections` 才往下做；剛起的 container 要幾秒才就緒。

5. 對本機 Postgres 套用全部 migration，最後一行印出 `[db:migrate] done`：

   ```bash
   DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm --filter @suanomics/pipeline run db:migrate
   ```

   要長期使用時，把同一個 `DATABASE_URL` 寫進 `apps/pipeline/.env`；`.env*` 已在 `.gitignore`，不會進 git。

6. 啟動網站的開發伺服器，用瀏覽器打開它印出的網址：

   ```bash
   pnpm --filter @suanomics/web dev
   ```

   在非互動環境（例如 AI coding agent 的 shell）裡，它以背景模式啟動並印出 pid，用 `pnpm --filter @suanomics/web exec astro dev stop` 停止。

7. 用完停掉 Postgres container（`--rm` 會一併刪掉 container 與其中的資料）：

   ```bash
   docker stop suanomics-pg
   ```

## 驗證紀錄

| 項目 | 驗證 |
|---|---|
| 步驟 1–3 全部以 0 結束 | 已實測（2026-11-08，macOS arm64、Node 26.13.0、pnpm 11.8.0） |
| 步驟 4–5 在 `postgres:18` container 上印出 `[db:migrate] done` | 已實測（2026-11-08，macOS arm64、Docker） |
| 步驟 6 開發伺服器回 HTTP 200，非互動 shell 下以背景模式啟動 | 已實測（2026-11-08，macOS arm64） |

## 參考

- 本機缺的環境變數名稱列在根目錄 `.env.example`；只填這次要用到的。
- CI 的檢查順序與資料庫設定在 `.github/workflows/ci.yml`。
- 為什麼測試不連 Neon：見 [程式碼規則的〈資料庫與測試〉](../rules/coding.md#資料庫與測試)。
