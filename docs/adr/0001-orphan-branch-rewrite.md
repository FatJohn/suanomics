---
status: accepted
date: 2026-11-07
---

# 在同一 repo 以 orphan branch 重寫

`suanomics` 是 `macroeconomics-report` 的 open source 版（2,658 commits 的歷史在原 repo，open source 版從 2026-09-20 起只有 18 commits）。重構的幅度——拿掉常駐 server 與 job runner、換 LLM 呼叫層、換前端框架、砍掉一半 workspace——大到原地演進會讓每個 PR 都在跟舊架構打架。決定在 `suanomics` 開 orphan branch `rewrite` 從空樹開始，舊 `main` 保留為歷史與搬遷素材。

## Considered Options

- **原地逐步重構**：每一步都要維持舊架構可跑，速度慢，且舊 HTTP 層與 job runner 會一直留到最後。
- **開第三個新 repo**：乾淨，但 issue、star、搜尋可見度都要從零，且兩個同名產品的 repo 並存會混淆。
- **同 repo orphan branch**（採用）：空樹起步、歷史不丟、完成後接回 `main`。

## Consequences

- 搬遷的檔案第一個 commit 原樣搬（`[STRUCTURAL]`），改寫在之後的 commit，`git log --follow` 才追得回原版。
- 完成驗收後的接回方式：在舊 `main` 打 tag `v0-legacy`，在 `rewrite` 上 `git merge --allow-unrelated-histories -s ours main`（結果樹＝`rewrite` 的內容、舊 `main` 成為祖先），再把 `main` fast-forward 過去；不 force push。
- 原 repo `macroeconomics-report` 設為 archived；其 `docs/changes/`、`docs/research/`、`PRODUCT.md` 搬進本 repo `docs/history/`，`docs/superpowers/` 的 plans 與 specs 不搬。
