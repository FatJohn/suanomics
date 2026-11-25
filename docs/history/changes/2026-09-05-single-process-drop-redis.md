# 2026-09-05 單一 process、拿掉 Redis 與 BullMQ

> 四個 PR 的合併紀錄。決策過程與逐步計畫在
> [2026-09-04 plan](../superpowers/plans/2026-09-04-single-process-drop-redis.md)（§0 有九條已拍板的決策）。
> 這份記的是**改完之後的樣子與為什麼**，不是怎麼改。

## Summary

部署單位從「api、api-worker、web、Postgres、Redis」縮成「server、web、Postgres」。
`apps/api` 與 `apps/worker` 合併成 `apps/server`，一個 Node process 同時提供 HTTP 與執行所有
async job；佇列改成 process 內的 in-process runner，`background_jobs` 成為 job 狀態的唯一真相。
Redis 與 BullMQ 完全移除。

## Why

痛點不是「Redis 太重」，是**雙狀態**：BullMQ 一份、Postgres 的 audit 一份，兩份會不一致。
repo 裡記錄的一整串補丁全部來自這個根因——

- `runtime-flows.md` 自述「audit 不保證跟著 retry 更新」；
- 2026-07-29 的假告警：第一次 attempt 失敗被寫進 audit，輪詢方看到 `failed` 就 `exit 1`，
  而 job 其實重試成功了；
- `producer.ts` 要主動清 BullMQ 殘骸、workflow 要用 bucket 後綴繞 silent dedup、
  corpus 排程因為不經 enqueue 路徑而長出 `selfHealAuditRow`。

換成 pg-boss 會留著這個根因（還是兩份狀態），所以選了合併成單一 process。
代價寫在 plan 的 D9：單點、部署會切斷進行中的 job、job 與 HTTP 共用 event loop。
個人專案、目前沒有 prod，這些都可接受。

## What changed

| PR | 一句話 | 主要內容 |
|---|---|---|
| [#312](https://github.com/FatJohn/macroeconomics-report/pull/312) | `apps/worker` → `apps/server` | 純改名，行為零改動 |
| [#314](https://github.com/FatJohn/macroeconomics-report/pull/314) | `apps/api` 併入 `apps/server` | route 搬進 `src/http/`、單一 entry 同時起 HTTP 與 queue 消費（Redis 當時還在） |
| [#315](https://github.com/FatJohn/macroeconomics-report/pull/315) | BullMQ → in-process runner，刪 Redis | runner（TDD）、migration `0013` 刪 `queue_name`／`bullmq_job_id`、七支 CLI 自己起 runner 跑到 chain 完成、corpus 排程改 GitHub cron、`docker-compose.dev.yml` 刪除 |
| [#317](https://github.com/FatJohn/macroeconomics-report/pull/317) | 部署參考與這份紀錄 | `docker-compose.deploy.yml`、`Dockerfile.web` 換通用 caddy image、三支 workflow 的 API base 改 repo variable |

幾個值得單獨記的點：

- **retry 語意刻意保留**（3 次、5s exponential backoff、per-kind 佇列與併發）。不是為了對齊舊實作，
  是因為它有實績：2026-07-29 那次首個 attempt 是 `This operation was aborted`，重試之後才有報告。
  podcast chain 不受 workflow 監看、使用者觸發的 `analyze` 也沒有 workflow 觸發面，所以
  「靠 GitHub Actions 重跑」補不上這一塊。
- **中途失敗的 attempt 不寫 audit**，這是 2026-07-29 假告警的守門。#315 的 Smoke 3 在真實 pipeline
  上驗到了：`podcast-generate` 第一次 attempt 撞 schema 下限而 zod-parse 失敗，backoff 後第二次成功，
  audit row 最終是 `completed`、`attempts=2`、`error_message` 為空。
- **CLI 語意改了**：以前七支 pipeline CLI 是 thin enqueuer，要另外起一個 worker 才有人消費；
  現在 CLI 自己起 runner、`drain()` 到所有 kind（含 chain）都空才退出。`--wait` 旗標刪除
  （永遠等），`--timeout=N` 保留。
- **Postgres 大版本定在 18**，本機 `docker-compose.yml`、CI service 與 `docker-compose.deploy.yml`
  三邊一起升（原本都是 16）。**理由不是「18 比較新」**：三邊原本的 16 是沒有人選過的既成事實，
  所以「維持被測過的版本」這個理由站不住。當時沒有 prod、沒有讀者，換版本的成本只有一次本機
  dump／restore——那是它會有的最低價，而 PG16 支援到 2028-11，再拖只會更貴。
  風險當場驗掉：14 支 migration 在 PostgreSQL 18.6 上 `db:migrate` exit 0、9 張表建齊。
  **兩個一定要知道的**：① PG18 的 PGDATA 變成 `/var/lib/postgresql/18/docker`、宣告的 VOLUME
  上移成 `/var/lib/postgresql`，沿用 `.../data` 是容器直接 exit 1（大聲失敗、不會靜默丟資料）；
  ② PG16 建的 data directory 在 PG18 底下起不來，既有 volume 要 dump + restore，
  本機那顆的步驟在 [local-dev](../operations/local-dev.md)，舊 volume 留著當退路。

## What stayed

- **Postgres**（jsonb、真 DB 測試都綁著它）、**Cloudflare R2**（音檔不綁 compute host）。
- **GitHub Actions 當外部觸發與唯一告警通道**。in-process cron 被否決：process 重啟就歸零，
  兩天週期在會重啟的主機上不可靠。
- **`/internal/*` 與 `/api/jobs/:id` 的 HTTP 契約**（response 只拿掉 `bullmqJobId` 欄位，
  workflow 本來就沒讀它）。
- **`inflight.ts` 的過窗回收**：`findInflight` 查到過窗 row 就順手標 failed，負責「CLI 被 kill
  而 server 沒重啟」的情境。開機時的 `failAllInflight()` 只是它的無條件版本，兩者都在。

## Deviations from plan

1. **workflow 的 `API_BASE` 守門位置**。plan 寫「`if` 加 `vars.API_BASE != ''`」，實作改成
   **在第一個步驟裡檢查並 `exit 1`**。job 層的 `if` 會讓 run 顯示成綠色的 skipped，跟「今天沒有
   應該做的事」在 Actions 列表上長得一模一樣——設定漏了不該跟正常狀態共用同一種外觀。
   `DAILY_PIPELINE_ENABLED` 的 `if` 維持不變（那個 skip 是刻意的暫停）。
2. **`docker-compose.deploy.yml` 要寫死專案名**。plan 沒提。compose 預設拿目錄名當專案名，
   於是它與 repo 根的 `docker-compose.yml` 落在同一個專案的同一個 `postgres` service——
   起部署那份會把本機開發用的容器 **recreate 掉**，連著換掉它掛的 volume。2026-09-05 實測踩到
   （舊 volume 還在、資料沒丟，`docker compose -f docker-compose.yml up -d` 就救回來了）。
   加 `name: suanomics-deploy` 之後兩份互不干擾。
3. **`Dockerfile.web` 要自帶 `Caddyfile`**。plan 說得對，但值得記下為什麼：換掉的那個平台專屬
   image 內建了 SPA fallback，通用 `caddy:2-alpine` 沒有。少了 `try_files` 的話首頁正常、
   深連結與重新整理 404，是上線之後才會被讀者踩到的那種缺陷。

## Verify

- 四個 PR 各自 CI 綠。#315 另跑四條 smoke（正常鏈、retry 語意、CLI + chain 實跑一天真報告、
  開機回收），紀錄在 plan 的「PR 3 驗收」節。
- #317：`docker compose -f docker-compose.deploy.yml build` 成功；`up -d` 後
  `GET /health` 回 `jobs` 八個 kind 的統計（代表 migration 跑過、DB 連上），web 的 `/` 與
  `/brief/news/123` 都回 200（SPA fallback 生效）；`stop` 後容器 exit code 0（graceful
  shutdown 在 45s 寬限內跑完，另外量了帶一條 idle keep-alive 連線的情況：`stop` 仍是 0 秒、
  exit 0，所以 HTTP 那段不會吃掉寬限期）；`down -v` 清乾淨。
- **端到端（2026-09-05 實跑通過）**：GitHub Actions → cloudflared 臨時通道 → 本機
  `docker-compose.deploy.yml` 起的 server 容器 → in-process runner → Postgres。
  `workflow_dispatch` 帶 `date=2026-09-03`（挑一個有新聞但還沒有 brief 的平日，避免撞去重
  讓 VERIFY 變成回頭檢查舊報告），[run 33955052060](https://github.com/FatJohn/macroeconomics-report/actions/runs/33955052060)
  九個步驟全過、末步 `VERIFY OK`，`{"narrative":true,"podcast":true}`、`audioUrl` 非 null。
  DB 落地：`market-data-refresh` → `news-refresh`（9m41s）→ `daily-brief` → `analyze` ×7 →
  `podcast-generate` → `podcast-tts`，**全部 `attempts=1`**；產出 narrative 3 段、podcast 4 acts、
  `2026-09-03.mp3`。跑完即刪 repo variable `API_BASE`、關通道、`down -v`。
  ★ **`workflow_dispatch` 預設跑 default branch 的 workflow 檔**：第一次沒帶 `--ref` 觸發，
  跑到的是 main 上還寫死舊 host 的版本。要驗分支上的 workflow 一定要 `--ref <branch>`。

## Deploy notes

操作細節在 [deploy.md](../operations/deploy.md)，這裡只列三個會咬人的：

1. **只能一個 instance，而且部署要 stop-then-start，不能 rolling。** 新容器開機的
   `failAllInflight()` 掃的是整張 `background_jobs`、沒有時間窗，會把舊容器**還在跑**的 job 標成
   `failed`；輪詢的 workflow 看到就 `exit 1`，是 2026-07-29 假告警的翻版。而且兩個容器的記憶體
   佇列互看不到，同一天的工作會跑兩份。多數 PaaS **預設是 rolling**，這是選主機時要主動關掉的
   東西，不是預設安全。compose 檔能做的只有宣告單一 replica 與給足收尾時間，它擋不住 PaaS。
2. **`stop_grace_period` 的預算是「HTTP 收尾 ＋ 30 秒」，不是 30 秒。** SIGTERM 之後 server 先關
   HTTP，**再**等執行中的 job 最多 30 秒，兩段串起來。寬限期到了會 SIGKILL，runner 的收尾一秒
   都跑不到。compose 寫 45s：HTTP 那段實測 0 秒（連 idle keep-alive 也不擋 close）、job 端點一律
   回 202 不佔連線，所以 15 秒餘裕夠用；日後加了會長時間佔住連線的端點要重算。
3. **repo variable `API_BASE` 要設。** 三支排程 workflow 都吃它，沒設會在第一個步驟 fail。
   換主機只改這一個值。
