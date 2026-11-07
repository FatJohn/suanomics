# Spike #18：RSSHub 在 Actions job 內自架 vs 公開 instance

- Issue：[#18](https://github.com/FatJohn/suanomics/issues/18)（parent #15 Phase 0）
- 量測日期：2026-11-07（Actions run 時間 2026-11-07T15:01:46Z–15:02:39Z）
- Workflow run：<https://github.com/FatJohn/suanomics/actions/runs/42384356524>，commit `692de5cd3d7e7bf28457d13d0908cd2cafba3a77`
- Runner：`ubuntu-latest`，Linux 7.0.0-1017-azure x86_64、4 vCPU、15983 MiB RAM（run log 的 `runner:` 行）
- 探測腳本：[`spikes/18/probe.sh`](../../spikes/18/probe.sh)；每個 URL 5 次、間隔 1.2 秒、UA `Mozilla/5.0 (compatible; feed-probe/1.0)`、不帶任何 secrets
- 下表數字都可在 run log 的 `STAT`／`TIMING`／`MEMORY` 行核對

## 結論

v1 兩條都不用：三家媒體裡 RSSHub 只有 udn 一個 route，鉅亨網與經濟日報各有自己的公開 RSS 可以直接用，工商時報 RSSHub 沒有 route、站方也沒有公開 feed；日後真的出現「只能靠 RSSHub」的來源時改用 job 內自架（pull 加啟動 10.2 秒、0/5 失敗），公開 instance `rsshub.app` 每次都回 403，站方明說不供 production 使用。

## Route 盤點

依 RSSHub 官方 repo（`DIYgod/RSSHub` master，查核時 `26c5fa2`）的 `lib/routes/`：

| 媒體 | RSSHub route | 說明 |
|---|---|---|
| 鉅亨網（cnyes） | 無 | `lib/routes/` 沒有 `cnyes`／`anue` 目錄，`git log` 對 `lib/routes/cnyes` 與 `lib/v2/cnyes` 也查不到 commit，代表從未存在 |
| 經濟日報（money.udn.com） | 無 | `lib/routes/udn` 只有聯合新聞網 `udn.com` 的即時新聞 `/udn/news/breakingnews/:id` 與轉角國際 `/udn/global`；沒有 money.udn.com |
| 聯合新聞網（udn.com） | `/udn/news/breakingnews/6`（財經）、`/udn/news/breakingnews/11`（股市） | 本 spike 量測的兩個 route；同集團最接近經濟日報的內容 |
| 工商時報（ctee） | 無 | 同 cnyes，目錄與 commit 都不存在；中時新聞網的 `/chinatimes/:category` 是另一個媒體，且需要 Puppeteer |

## 公開 RSS（不需 RSSHub）

2026-11-07 本機各打 1 次確認（不是 Actions 上量的數字，Actions IP 能否連到這些站由 #16 負責）：

| 媒體 | Feed | 結果 |
|---|---|---|
| 鉅亨網 | `https://news.cnyes.com/rss/v1/news/category/tw_stock`（另有 `wd_stock`，舊系統 `main` 的 `packages/db/src/seed.ts` 已在用） | 200 `application/rss+xml`，100 則 |
| 經濟日報 | `https://money.udn.com/rssfeed/news/1001/5591?ch=money`（另有 `5590`、`5588`，同上 seed） | 200 `text/xml`，20 則 |
| 工商時報 | 無公開 feed：`https://www.ctee.com.tw/rss` 與 `/feed` 都回 403 Cloudflare WAF 錯誤頁 | 舊系統 seed 註記「ctee 沒有可用的公開 feed」，只走 Google News 搜尋 feed |

## (1) 公開 instance `rsshub.app`

| Route | 失敗 | 延遲中位數 | 延遲最大值 | 狀態碼 | 限流訊號 |
|---|---|---|---|---|---|
| `/udn/news/breakingnews/6` | 5/5 | 76 ms | 130 ms | 403 ×5 | 無 `Retry-After`；回應本文為站方公告 |
| `/udn/news/breakingnews/11` | 5/5 | 73 ms | 80 ms | 403 ×5 | 同上 |

- 可用 route：無。
- 403 的回應本文（全文）：「Due to cost considerations, we will gradually restrict access to rsshub.app for some feed readers. Please note that rsshub.app is intended for testing purposes only and should not be used as a production RSS source. For stable and long-term usage, we strongly recommend self-hosting RSSHub.」本機（台灣家用網路）打 `/udn/news/breakingnews/6` 一次也回相同的 403，不是 Actions IP 才被擋。
- Actions 多花的時間：整段探測 13.0 秒（`TIMING public probe_total_s`），約 0.22 分鐘，其中大半是請求間隔。

## (2) Job 內自架

Image：`diygod/rsshub@sha256:3e1607718bc059815e95110f45636c87305befa9863b61f66246d098eb6cf762`（2026-11-07 的 `latest` multi-arch index，Docker Hub `last_updated` 2026-11-07T05:28:26Z，amd64 壓縮後 132,875,506 bytes），`docker run -p 1200:1200 -e NODE_ENV=production`，以 `/healthz` 回 2xx 判定 ready。

| 項目 | 數值 |
|---|---|
| `docker pull` | 8.4 秒 |
| 啟動到 ready | 1.8 秒 |
| Actions 多花的時間（開始 pull 到 ready） | 10.2 秒，約 0.17 分鐘 |
| Container 記憶體峰值 | cgroup `memory.peak` 275.7 MiB；`docker stats` 每秒取樣最大 271.8 MiB（10 筆） |

| Route | 失敗 | 延遲中位數 | 延遲最大值 | 每次 item 數 |
|---|---|---|---|---|
| `/udn/news/breakingnews/6` | 0/5 | 28 ms | 6999 ms | 20 |
| `/udn/news/breakingnews/11` | 0/5 | 18 ms | 5562 ms | 20 |

- 可用 route：`/udn/news/breakingnews/6`、`/udn/news/breakingnews/11`。
- 最大值都是第 1 次（cold）：RSSHub 先打 udn 的列表 API，再對 20 篇文章頁各發一次請求（`pMap`，`concurrency: 3`），結果進 container 內建快取，第 2–5 次直接回快取。Pipeline 每天每個 route 只打一次，實際要算的是 cold 的 5.6–7.0 秒。
- 這個 cold 請求的扇出（每次至少 21 個對 udn 的請求：列表 API 1 次加 20 篇文章頁，文章頁 3 條並行）不受本 spike「請求間隔至少 1 秒」約束，若日後採用要在 pipeline 端另訂上限。

## 使用條款

| 媒體 | 條款連結 | 是否允許抓標題與連結 |
|---|---|---|
| 經濟日報／聯合新聞網（聯合線上） | [著作權聲明](https://udn.com/page/topic/495)、[服務條款](https://member.udn.com/member/rule.jsp)、[robots.txt](https://money.udn.com/robots.txt) | 未明文允許：條款禁止未經授權「下載、轉貼或以他法重製」內容，並另立一段「未經事前書面同意，禁止任何人使用本報系內容開發任何軟體或程式，包括但不限於訓練大型語言模型（LLMs）、機器學習或人工智慧（AI）」；robots.txt 註解也寫明 LLM／AI 用途與商業用途不被允許。suanomics 會把標題餵給 LLM，用之前要先判斷或取得授權 |
| 鉅亨網 | [隱私權政策 & 使用者條款](https://www.cnyes.com/cnyes_about/cnyes_sos05.html) | 未明文允許：第七條「智慧財產權」規定非經事前書面授權不得重製、改作、編輯、公開傳輸或散布內容；條款對象寫的是「訂閱戶」，沒有針對 RSS 的另行規定 |
| 工商時報 | unknown：官網對通用 UA 回 403 Cloudflare WAF，Wayback 2026-10-25 的首頁存檔也沒有條款連結；可查到的只有 [robots.txt](https://www.ctee.com.tw/robots.txt)，對 `ClaudeBot`、`anthropic-ai`、`GPTBot` 等具名 AI crawler 一律 `Disallow: /` | 無法判定；本 spike 不建議用 |

本 spike 結論不使用任何 RSSHub route，上表是給之後 `docs/sources.md` 對三家媒體的條款底稿。
