# 部署

> **目前沒有 prod，**主機還沒選。本頁寫的是**與主機無關**的那一半：要跑起來需要哪些容器、哪些環境變數、
> 有哪些跟這個架構綁死的注意事項。選定主機後的實際操作步驟另外補。
>
> 文件與程式註解裡仍會看到「prod 實測」這類帶日期的數字：那是作者自己跑過的環境留下的歷史量測，
> 不是一個現在對外提供的服務。用語定義見 [orientation 的詞彙表](../architecture/orientation.md#附錄完整詞彙表)。

## 部署單位

兩個 image 加一個資料庫：

| 單位 | 來源 | 說明 |
|---|---|---|
| `server` | `Dockerfile.server` | 一個 Node process 同時提供 HTTP（`EXPOSE 3000`）與執行所有 async job。entrypoint 是 `apps/server/scripts/entrypoint.sh`：先跑 `db:migrate`，再 `exec node dist/index.js`。 |
| `web` | `Dockerfile.web` | Vue SPA 的靜態站。build 時要 `VITE_API_URL`（server 的公開 URL），它會被編進 bundle，改了要重 build。 |
| Postgres | 官方 image | 唯一的持久狀態。`background_jobs` 也在這裡——**沒有第二個資料服務**（2026-09-04 起佇列在 server process 的記憶體裡）。 |

podcast 音檔在 Cloudflare R2，不綁主機。

## 環境變數

以 `apps/server/.env.example` 為準——那個檔案標了每一項是 `[FATAL]`（缺了 `process.exit(1)`）還是
`[DEGRADED]`（缺了只大聲 log、服務照起），判定本身在 `packages/shared/src/startup-config.ts`，
啟動時會把結果印在 stderr，也掛在 `GET /api/ops/config-health`。

最低限度：`DATABASE_URL`、`GEMINI_API_KEY`、`INGEST_TRIGGER_SECRET`（`NODE_ENV=development` 時豁免）。
`WEB_ORIGIN` 缺了 CORS 白名單只剩 localhost，瀏覽器端全被擋，但 HTTP 端點與每日 pipeline 照跑。

★ **有兩個旗標不在上面那套分級裡，`startup-config.ts` 也不查**，但要讓敘事的證據追溯層（claim ledger）完整運作就得開——
漏設不會有任何症狀，報告照產，只是整個證據追溯層安靜地消失：

| 變數 | 值 | 漏設的後果 |
|------|----|-----------|
| `ANALYST_CLAIMS_ENABLED` | `true` | analyst-tier1 不輸出 claims，`claimLedger` 恆為 0 |
| `NARRATIVE_LEDGER_ENABLED` | `true` | narrative 不消費 ledger，敘事裡的數字全部掛不上證據 |

兩個都只認字串 `'true'`。前者是後者的前提：沒有 claim 就沒有
ledger 可餵，所以只開後面那個等於兩個都沒開。2026-09-05 本機實測：關著時 ledger 0 條、
敘事 34 個數字全 unbound；開著時 ledger 32 條、45 個數字只有 2 個 unbound——**而報告表面
讀起來一樣**，這正是它漏了不會有人發現的原因。

排程要怎麼觸發見下方「排程觸發（自備）」。

## 用 docker compose 起一份

`docker-compose.deploy.yml` 是與主機無關的參考設定：Postgres 18 + `server` + `web`，
三個容器。它**不是** repo 根的 `docker-compose.yml`（那個只起本機開發用的 Postgres，
兩個檔刻意分開）。

```bash
cp apps/server/.env.example apps/server/.env    # 填 GEMINI_API_KEY、INGEST_TRIGGER_SECRET 等
docker compose -f docker-compose.deploy.yml up -d --build
curl -fsS localhost:3000/health | jq '.jobs'    # server（PORT 由 SERVER_PORT 覆寫）
curl -sI localhost:8080/ | head -1              # web（由 WEB_PORT 覆寫）
```

compose 讀 `apps/server/.env` 當 `env_file`，但 `DATABASE_URL`、`NODE_ENV`、`PORT`、`WEB_ORIGIN`
四個由 compose 自己覆蓋——容器裡連的是同一個 network 上的 `postgres`，不是 `localhost`。

★ `docker compose -f docker-compose.deploy.yml config` 會把 `env_file` 展開、**把 `.env` 裡的
API key 明文印在終端機上**。要看解析結果就加 `| grep <想看的 key>`，不要整份貼進聊天或 issue。

`web` 是**建置期**吃 `VITE_API_URL`（讀者瀏覽器會打的公開位址，不是 `http://server:3000`）。
改了要重 build，重啟沒有用。

Postgres 大版本定在 **18**（2026-09-05 決定）。CI（`.github/workflows/ci.yml`）與本機
`docker-compose.yml` 也是 18，所以那幾支刻意不 mock 的真 DB 測試跑在跟部署同一個大版本上。
**三邊要一起動**——只動其中一邊，唯一被驗證過的版本就不是部署跑的那個。

決定的理由不是「18 比較新」：原本三邊都是 16，而那是沒有人選過的既成事實。既然當時沒有 prod、
沒有讀者，換版本的成本只有一次本機 dump／restore，那是它會有的最低價；PG16 的官方支援到
2028-11，再拖只會讓遷移更貴。技術風險當場驗掉了：14 支 migration 在 PostgreSQL 18.6 上
`db:migrate` exit 0、9 張表建齊。

★ **掛載點跟著 PG18 換了層**：PGDATA 從 `/var/lib/postgresql/data` 變成
`/var/lib/postgresql/18/docker`，官方 image 宣告的 VOLUME 也上移成 `/var/lib/postgresql`，
所以 compose 要掛 `/var/lib/postgresql`。沿用舊路徑不會靜默丟資料，是**容器直接 exit 1**、
log 明白告訴你要掛哪裡（實測）。

★ **既有的 PG16 volume 不能原地升**：data directory 帶大版本標記，PG18 起不來。要走
dump + restore 到新 volume，舊 volume 留著當退路。

## 排程觸發（自備）

server 沒有內建排程。要每天產報告，部署者自己選一個 scheduler（GitHub Actions 的 cron、系統
cron、雲端 scheduler 都行）定時打 `/internal/*`，bearer 帶 `INGEST_TRIGGER_SECRET`（要與 server
那份**同值**）。呼叫順序見 [smoke-test.md](smoke-test.md) 的「Daily Refresh」小節，這裡不重複貼指令。

語料更新（兩日一次即可）打 `POST /internal/corpus/refresh`。報告日一律是台北曆日，不是觸發當下的
UTC 曆日。market-data 要在美股收盤後觸發才抓得到定案的收盤值，時區換算與已知的邊界風險見
[`nasdaq-client.ts` 的 `ACCEPTED_MARKET_STATUSES` 註解](../../apps/server/src/market-data/nasdaq-client.ts)。

`GET /api/ops/publication-status` 是設計給外部監控讀的：今日（或往回 N 日）報告是否存在、準時、
完整、夠新。欄位契約由
[`apps/server/src/http/routes/ops.test.ts`](../../apps/server/src/http/routes/ops.test.ts) 釘住——
外部監控常直接用 jq 之類的工具讀這份 JSON，缺欄位時只會靜靜回空、不會報錯，接告警前建議先讀過
那份測試，確認要讀的欄位真的保證存在。

排程要多久跑一次、逾時多久算異常，由排程端自己決定——server 不內建這層判斷。

R2 的設定與主機無關，照 `.env.example` 的 `PODCAST_S3_*` 填即可，不必因為換主機而動。

## 上線後要換掉的佔位值

`apps/web/index.html` 的 `og:url`、`og:image`、`twitter:image` 三個 meta 目前是佔位網域
`https://your-domain.example/`。選好 web 的公開 URL 之後要把這三處換掉——它們不影響部署跑不跑得
起來，但分享連結的預覽圖靠它們，不換就是壞的，而且**沒有任何測試會紅**。圖檔本身
（`apps/web/public/og-image.png`）已經在 repo 裡，只需要改網域。

## 這個架構要知道的三件事

**① migration 在 entrypoint 自動跑。** 每次容器啟動都會先 `db:migrate` 再起 server，所以部署即遷移；
不需要另一個 migrator service。

**② 重啟會切斷進行中的 job。** 佇列只活在 server process 的記憶體裡，重啟就沒了。開機時
`failAllInflight()` 會把所有 `queued`／`active` 的 row 無條件標成 `failed`（`error_message` 寫
`server restarted`），靠下一次觸發補。不清的話同 payload 會被當成 `already-inflight` 永遠擋著。

實務影響：news-refresh 實測約 31 分，部署時機落在它中間就是重跑一次。SIGTERM 之後 server 會先關
HTTP、**再**等執行中的 job 最多 30 秒——兩段是串起來的，所以 `stop_grace_period` 的預算是
「HTTP 收尾 + 30 秒」，不是 30 秒。寬限期到了會 SIGKILL，runner 的收尾一秒都跑不到。
compose 檔寫 45s：HTTP 那段 2026-09-05 實測是 0 秒（連 idle keep-alive 連線也不會擋住 close），
而 job 端點一律回 202 不佔連線，所以 15 秒餘裕夠用。日後若加了會長時間佔住連線的端點
（SSE、串流回應、同步的長查詢），這個值要跟著調。

**③ 只能跑一個 instance，而且新舊容器不得並存。** 第二個容器有自己的一份佇列，兩邊會各自跑
同一天的工作。要水平擴充 job 那半，得先把佇列搬回一個共享的地方——這是 2026-09-04 明確接受的取捨。

**這條對「怎麼部署」有硬要求：stop-then-start，不能 rolling。** 多數 PaaS 預設是 rolling
（新容器起來、健康後才關舊的），而新容器開機的 `failAllInflight()` 掃的是整張表、沒有窗——它會把
舊容器**還在跑**的 row 標成 `failed`。舊容器跑完會 `markCompleted` 蓋回去，但中間那段時間
若排程觸發方的輪詢邏輯只要看到 `failed` 就判定失敗，就會收到一封報告其實有產出的假告警。
所以選主機時要把「單 instance、部署時先停再起」當成不可妥協條件，不是事後再調的選項。

## 放上公網前要知道的事

以下是現況與建議；有幾點防線 server 內建已經處理（token 比對、analyze 限流、容器非 root），其餘仍是「沒有一套外部系統在做這些事」，是不是要補、補在哪一層，由部署者自己決定。

- **`GET /api/ops/publication-status` 與 `GET /api/ops/config-health` 沒有認證**：`app.ts`（[`apps/server/src/http/app.ts`](../../apps/server/src/http/app.ts)）把 `opsRoute` 掛在 `/api` 下，中間只有 CORS、沒有任何 auth middleware；`ops.ts`（[`apps/server/src/http/routes/ops.ts`](../../apps/server/src/http/routes/ops.ts)）自己也沒加。兩個端點分別會吐出逐來源文章數／可用率／報告新鮮度，與哪些環境變數沒設好。這是設計上給外部監控直接讀的（見上方「排程觸發（自備）」），但代表任何人都能讀。需要的話請在反向代理層擋（IP allowlist、Basic Auth 等）。
- **`POST /api/brief/analyze` 公開、但 server 內建兩層 in-memory 限流**：每個客戶端每分鐘（`ANALYZE_RATE_LIMIT_PER_CLIENT_PER_MIN`，預設 5）與全域每小時（`ANALYZE_RATE_LIMIT_GLOBAL_PER_HOUR`，預設 60），任一層超過回 `429` 並帶 `Retry-After`；設 `0` 可停用該層。限流只活在 process 記憶體、**重啟即歸零**，這是延續本頁「單一 instance」取捨的代價，不是漏洞。客戶端識別預設用實際 TCP 來源，`TRUST_PROXY=true` 時改信任 `X-Forwarded-For` 最右邊一段，僅適用前面剛好一層可信反向代理的部署——完整設計見 [環境設定「`POST /api/brief/analyze` 限流」](../architecture/configuration.md#post-apibriefanalyze-限流)。這道限流是給「濫用式的量」設的粗防線，仍建議搭配反向代理層的驗證或更細緻的流量控管。
- **`/internal/*` 在 `NODE_ENV=development` 時完全略過驗證，其餘情況 token 比對是 constant-time**：[`internal.ts`](../../apps/server/src/http/routes/internal.ts) 的中介層第一行就是「`NODE_ENV === 'development'` 直接放行」，其餘情況才用 `safeEqual`（[`safe-equal.ts`](../../apps/server/src/http/safe-equal.ts)）比對 `INGEST_TRIGGER_SECRET` 的 Bearer token，避免逐字元比較的側信道。不要用 `NODE_ENV=development` 部署——包含 `node dist/index.js` 這種 `NODE_ENV` 未設的情況也要確認沒有被其他地方設成 `development`。
- **`docker-compose.deploy.yml` 的 Postgres 密碼預設是 `postgres`**（`POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}`）。部署前務必用自己的 `POSTGRES_PASSWORD` 覆寫，不要照抄參考設定的預設值。
- **兩個容器都以非 root user 執行**：`Dockerfile.server` 切到 Node 官方 image 內建的 `node` user，`Dockerfile.web` 建立專用的 `app` user 並改聽 8080（非特權 port）。攻擊面比 root 執行小，但這不是沙箱——容器內能寫的路徑（`/src` 下）仍然可寫，不要假設它等同完整隔離。
- **CORS allowlist 固定包含 `http://localhost:5173`**：見 `app.ts` 的 `allowedOrigins` 組成，這是為了本機開發方便寫死的，正式環境的請求來源判斷不應該只依賴這個 allowlist。

## 相關

- 兩半在同一個 process 裡怎麼分工：[apps/server README](../../apps/server/README.md)
- job 生命週期、retry 與降級：[Runtime Flows](../architecture/runtime-flows.md)
