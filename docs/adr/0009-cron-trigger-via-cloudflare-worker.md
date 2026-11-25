---
status: accepted
date: 2026-11-07
---

# 觸發器以 Cloudflare Worker 為主、Actions schedule 為備援

GitHub 官方文件明說 `schedule` 事件在整點高負載時會延遲、極端時 queued job 可能被丟棄，且 public repo 60 天沒有 commit 會自動停用排程。報告要在台股 09:00 開盤前上線，排程不可靠就等於產品不可靠。決定用 Cloudflare Worker 的 Cron Trigger（免費層）在 05:00 台北呼叫 GitHub API `workflow_dispatch` 啟動 pipeline；Actions 的 `schedule` 設在 05:20 當備援，pipeline 開頭查「當日已有產出」就結束；`workflow_dispatch` 同時支援手動補跑指定日期。

## Consequences

- 60 天停用只影響 `schedule`，`workflow_dispatch` 路徑不受影響。
- Worker 約 20 行，是日後升級到 Cloudflare Workers 讀 API（[排程批次加靜態網站](0002-batch-pipeline-and-static-site.md) 的選項 B）的第一塊。
- GitHub token 放在 Worker 的 secret，權限只有觸發該 workflow。
