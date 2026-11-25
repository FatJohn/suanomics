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

## 後續

2026-11-25（#107）：Actions `schedule` 不是開盤前的備援。2026-11-10 到 11-25 的 16 次 schedule run 都在台北 09:04 到 13:20 才建立，延遲 3.7 到 8 小時；同期 Worker 每天 05:00:05 準時 dispatch。開盤前的備援改由同一個 Worker 的第二個 Cron Trigger 負責。05:40 那次查 `daily.yml` 在主觸發之後有沒有進行中或成功的 run，沒有才 dispatch，查詢失敗也 dispatch。05:00 的 dispatch 遇 5xx 或網路錯誤會重試。兩個 Cron 共用 Worker 與 token，Cloudflare Cron 沒觸發或 token 失效時會一起失效；`schedule` 因此保留，在開盤後補上這種情況。
