# 本機開發

## 需求

- Node.js 22 LTS。
- pnpm——版本由 root `package.json` 的 `packageManager` 欄位決定，用 corepack 即可。
- 跑本機 Postgres 時需要 Docker。
- Backend 環境變數放在 `apps/server/.env`。
- Frontend 環境變數放在 `apps/web/.env`。

## 安裝

```bash
pnpm install
```

## 環境檔

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

至少要設定:

- `GEMINI_API_KEY`——backend 呼叫 LLM 用。
- `DATABASE_URL`——Cascade 持久化用。
- `WEB_ORIGIN`——backend CORS 用。
- `VITE_API_URL`——前端呼叫 API 用。
- `INGEST_TRIGGER_SECRET`——production-like 本機檢查時走 `/internal/*` triggers 用。在 `NODE_ENV=development` 模式下、後端會跳過這道 bearer 檢查。
- ~~`FIRECRAWL_API_KEY`~~——**2026-08-21 起應用程式不再讀**，gap-search 路徑已移除。本機不必設。

★ **手上的 `.env` 若是 2026-08-06 之前 `cp` 出來的，會缺 `ANALYST_CLAIMS_ENABLED` 與
`NARRATIVE_LEDGER_ENABLED`**（範例檔後來才加，兩者程式預設關閉）。缺了不會有任何錯誤訊息，
報告照產，只是 `claimLedger` 恆為 0、敘事裡的數字全部掛不上證據——2026-09-05 就是這樣白跑了
一份本機報告才發現的。判斷方法：

```bash
grep -c 'ANALYST_CLAIMS_ENABLED\|NARRATIVE_LEDGER_ENABLED' apps/server/.env   # 要是 2
```

範例檔的本機預設值:

```bash
PORT=3000
WEB_ORIGIN=http://localhost:5173
DATABASE_URL=postgres://postgres:postgres@localhost:5432/suanomics
VITE_API_URL=http://localhost:3000
```

## Build workspace packages

`@suanomics/shared`、`@suanomics/db`、`@suanomics/jobs`、`@suanomics/prompt-research` 的 exports 都指向 `dist/`，
`apps/server` 依賴全部四個，所以第一次跑 server 之前要先 build 全部 workspace：

```bash
pnpm build
```

只 build `@suanomics/shared` 的話，`pnpm dev:server` 會因為找不到 `@suanomics/jobs` 的 `dist/` 而
`ERR_MODULE_NOT_FOUND`。之後改了哪個 package，就要重新 build 它（或再跑一次 `pnpm build`）。

## 本機服務

`docker-compose.yml` 提供 Postgres：

```bash
docker compose -f docker-compose.yml up -d postgres
```

啟動 `postgres:18` 容器名 `suanomics-postgres`、開 `localhost:5432`，預設用：

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/suanomics
```

★ **本機 5432 已被佔用時**：設 `POSTGRES_PORT=5433` 再起 compose（`POSTGRES_PORT=5433 docker
compose -f docker-compose.yml up -d postgres`），並把 `apps/server/.env` 的 `DATABASE_URL`
port 同步改成 5433（`postgres://postgres:postgres@localhost:5433/suanomics`）。

★ `POSTGRES_DB` 只在 volume 第一次初始化時生效——之後改這個值不會建立新資料庫，也不會
重新命名既有資料庫。PG18 的 PGDATA 實際路徑在 `/var/lib/postgresql/18/docker`，所以 compose
掛的是上一層 `/var/lib/postgresql`（不是 `.../data`）；掛錯層容器會直接 exit 1，log 會說明
要掛哪裡。

Postgres healthy 後跑 migrations：

```bash
pnpm --filter @suanomics/db run db:migrate
```

新資料庫要 seed Cascade sources：

```bash
pnpm --filter @suanomics/db run db:seed
pnpm --filter @suanomics/db run seed:external-sources
```

★ **這兩支預設只啟用「以公開發佈為目的」的官方來源**（央行、行政院、金管會、
FOMC、白宮、TWSE 等 8 個網域，見 `packages/db/src/source-policy.ts`）。其餘商業媒體
feed（udn、鉅亨、Bloomberg 等近 20 家）預設**停用**——公開一份內建抓取配方在 ToS
與觀感上有風險，見兩支 seed 檔頭的說明（`packages/db/src/seed.ts`、
`packages/db/src/seed-external-sources.ts`）。要抓齊全部來源，設 `SEED_THIRD_PARTY_SOURCES=true`
（見 `apps/server/.env.example`）再跑上面兩支；沒設就跑，日報選稿會因為少了大部分素材而明顯
變薄，`db:seed` 與 `seed:external-sources` 會各印一行警告列出被停用的 slug。

★ **拒絕靜默降級**：如果這個 DB 裡已經有第三方來源是手動啟用過的（`is_active` /
`enabled` = true），而這次跑沒開 `SEED_THIRD_PARTY_SOURCES`，兩支 seed 會在寫任何
東西進 DB **之前**先查一次、發現會把這些來源悄悄翻成停用，直接印錯誤並 `exit(1)`
中止（不是印完警告就繼續跑）。要繼續，二選一：設
`SEED_THIRD_PARTY_SOURCES=true`（照常抓第三方來源），或設
`SEED_ALLOW_DOWNGRADE=true`（明確表示你確認要停用它們，見 `apps/server/.env.example`）。
乾淨 clone 第一次跑（DB 裡還沒有任何第三方來源啟用過）不會觸發這個中止。

本機只需要 Postgres 一個容器。2026-09-04 之前還要另外起一個佇列服務，那份 compose 檔已隨佇列一起移除。

★ **改完 `.env` 的 `DATABASE_URL` 要重啟 server**。`pnpm dev:server` 是 `tsx watch
--env-file=...`，env 只在 process 啟動時讀一次，`tsx watch` 只監看原始碼、不監看 env 檔。
不重啟的話它還連著舊 DB，而**照樣正常運作**——job 跑得完、CLI 回 exit 0，只是寫到另一個
資料庫去了。

★ **新聞素材沒有歷史可補。** RSS feed 只吐最近幾十到幾百則，所以 `news_items` 與
`external_articles` 一旦沒抓到就是永久沒有——不像 `market_data_points` 可以跟資料源重抓。
每天沒跑 refresh，就是永久少一天素材。

關掉本機服務：

```bash
docker compose -f docker-compose.yml down
```

## Dev Server

開兩個 terminal 各跑一個。`dev:server` 一個 process 同時提供 HTTP 與執行 job，
所以測非同步 job 不需要再起第三個（2026-09-04 合併前是 `dev:api` ＋ `dev:worker` 兩支）：

```bash
pnpm dev:server
pnpm dev:web
```

本機 URL：

- API：`http://localhost:3000`
- API health：`http://localhost:3000/health`
- Web：`http://localhost:5173`
- Web routes：`/`（landing）、`/brief`、`/brief/news/:id`、`/brief/analyze`、`/transcript`

## 常用檢查

```bash
pnpm -r test       # 需本機 Postgres（packages/db 整包，以及下面列的四支都直連）
pnpm lint          # root 的 `eslint .`；不是 `pnpm -r lint`（後者不含 root project）
pnpm -r type-check
pnpm -r build
```

沒起本機 Postgres 時改跑 `pnpm --filter '!@suanomics/db' -r --no-bail test`，並注意**四支**測試仍會
因為連不上資料庫而紅（`ECONNREFUSED`；沒有 `apps/server/.env` 時是 `DATABASE_URL not set`）：`apps/server` 的 `retriever.test.ts`（整個 suite load 失敗）、
`apps/server` 的 `src/http/routes/ops.db.test.ts`（8 條，2026-08-21 事故後補的真 DB route 測試）、
`apps/server` 的 `tools/cli/demo-seed.db.test.ts`（6 條）與 `packages/jobs` 的
`audit.db.test.ts`（7 條）。
**只有這四支可以忽略**，其他任何失敗都是真的。

## Feature Scripts

pipeline 的 script 住在 `apps/server`（2026-09-04 合併前它們在 worker、api 那份只有 `dev` / `start` / `build` / `test` / `type-check` / `lint` / `transcript`）。DB 相關在 `@suanomics/db`：

```bash
pnpm --filter @suanomics/db run   # db:generate / db:migrate / db:seed / seed:external-sources
pnpm --filter server run    # pipeline 六步 + 各種 eval / smoke
```

★ **pipeline 那七支自己把工作跑完**（2026-09-04 起）——CLI 自己起一個 runner、enqueue、跑到所有 kind 的佇列都空了（含 chain 出去的 job）才退出，所以**不需要另外起 `pnpm dev:server`**。退出碼：completed 0、failed 1、逾時 124；`--timeout=N`（秒）可調，`--wait` 已移除（現在永遠等）。`already-inflight` 與 `already-completed` 直接 exit 0。`@suanomics/db` 那三支不經 job runner、直接執行。

★ **不要在 `pnpm dev:server` 跑著的時候跑 pipeline CLI**：server 開機會把所有 `queued`／`active` 的 row 無條件標成 failed，包括 CLI 正在跑的那一筆。同理**也不要在那時候跑 `packages/jobs` 的測試**——`audit.db.test.ts` 會對真 DB 呼叫無條件的 `failAllInflight()`，掃的是整張表。而 `tsx watch` 存檔就 reload、reload 就再回收一次，所以「server 開著」不只是啟動當下那一瞬間。

★ **env 從 `apps/server/.env` 來**（「環境檔」節 `cp` 出來的那個），script 自己會載、不必在指令前面帶 `DATABASE_URL`。（2026-08-28 之前 pipeline 那七支指向 root `.env`，而那個檔案不存在、也沒有任何步驟會造它，照文件跑會拿不到連線字串。）

當前的 Cascade 與維運 scripts：

```bash
pnpm --filter @suanomics/db run db:migrate
pnpm --filter @suanomics/db run db:seed
pnpm --filter @suanomics/db run seed:external-sources
pnpm --filter server run market-data:refresh
pnpm --filter server run news:refresh
pnpm --filter server run brief:generate "$(TZ=Asia/Taipei date +%F)"              # positional、不帶 --
pnpm --filter server run corpus:refresh
pnpm --filter server run podcast:generate -- --date "$(TZ=Asia/Taipei date +%F)"  # flag 形式、要帶 --
pnpm --filter server run podcast:tts -- --date "$(TZ=Asia/Taipei date +%F)"
pnpm --filter server run news:health                     # 素材健康檢查（只讀、不走 queue）
pnpm --filter server run news:health -- --days=30 --json
pnpm dev:server              # HTTP + job runner（root script）
pnpm --filter server start   # 跑 dist、要先 build
```

★ **跑 `apps/server` 的任何 script 之前，`@suanomics/shared`、`@suanomics/db`、`@suanomics/jobs`、
`@suanomics/prompt-research` 都要先 build**——四者的 `exports` 都指向 `dist/`（見
`packages/db/package.json` 的 `./repos/*`），改過任一個卻沒 build，import 會拿到舊的或
直接失敗：`pnpm --filter @suanomics/shared build && pnpm --filter @suanomics/db build && pnpm --filter @suanomics/jobs build && pnpm --filter @suanomics/prompt-research build`。
最簡單的做法是直接跑一次 `pnpm build`（build 全部 workspace）。

★ **`news:health` 是換 feed 之後唯一算數的驗收方式**：它直接查 `news_sources` ×
`news_items`，逐來源印窗內則數、可用則數（`hasBodyBeyondTitle`，與 SLO 端點同一支）、
`content_source` 分佈、內文長度 p50/p90 與最新 pubDate，並標四種旗標——`silent`（窗內
零則）、`title-only`（有則數但沒有一則超出標題）、`no-scrape`（全停在 `rss-excerpt`）、
`zombie`（有內容但停更）。**「HTTP 200」判不出後三種**：feed 可能 item 全空
（`udn.com/rssfeed/news/2/6638` 就是 200 + 20 個空 item + pubDate 1970）、可能停更十年
（CSIS）、可能只有錨點 markup（Google News 代理）。

★ **Google News 代理來源（`rss_url` 的 host 是 `news.google.com`）亮 `title-only`／
`no-scrape` 是既定狀態，不是待修缺陷**：這批來源在 `news-refresh` 的 feed 層就整批跳過抓
正文（見 [runtime-flows](../architecture/runtime-flows.md) 的 `news-refresh` 段），讀者拿
到的是標題與轉址連結。需要正文請自行以合法方式取得：改用發行商自己的公開 feed（`seed.ts`
裡 cnyes／udn／yahoo-stock 是先例），或自行在 `apps/server/src/news/refresh.ts` 的
`resolveArticleTarget`／`fetchAndStoreBody` 接上 URL 解析。

★ 它只讀不寫，所以可以指向**任何** `DATABASE_URL` 取對照數字：

```bash
DATABASE_URL='postgres://<user>:<password>@<host>:<port>/<dbname>' pnpm --filter server run news:health
```

★ **參數形式不一致是既有事實、不是筆誤**：`brief:generate` 吃 positional 日期（`process.argv[2]`），`podcast:generate` / `podcast:tts` 吃 `--date` flag、所以要 `--` 把參數穿過 pnpm；`podcast:tts` 另外相容 positional。

Cascade 資料的常見本機操作順序：

```bash
pnpm --filter @suanomics/db run db:migrate
pnpm --filter @suanomics/db run db:seed
pnpm --filter @suanomics/db run seed:external-sources
pnpm --filter server run market-data:refresh
pnpm --filter server run news:refresh
pnpm --filter server run brief:generate "$(TZ=Asia/Taipei date +%F)"
```

corpus 工作同樣由 CLI 自己跑完（它會抓外部來源、打 LLM，時間較長）：

```bash
pnpm --filter server run corpus:refresh --timeout=2400
```
