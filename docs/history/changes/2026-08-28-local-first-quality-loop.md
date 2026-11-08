# 2026-08-28 本機優先的品質迴圈

> 這份記的是**為什麼**，不是怎麼做。執行項在 [backlog.md](../backlog.md) 的 `Now-0`。
> 決策過程是 2026-08-28 一次 `/grilling` session（13 題、5 個唯讀盤點 agent）。

## 背景：三件既成事實

1. **API key 已停用**（08-28 約 12:20，使用者自行操作）。Gemini 與 Anthropic 兩把都停，prod pipeline 即使被觸發也跑不動。
2. **GitHub Actions 的排程從 08-27T00:46Z 之後沒有再觸發過**。不是失敗，是 run 不存在；`slo-watchdog` 同樣停在 08-27T04:30Z。**原因至今未解**（見下方「未解的問題」）。
3. **`DAILY_PIPELINE_ENABLED` 已被使用者設為 `false`**（08-28T04:30:16Z）。所以就算平台側的排程恢復，job 也會被 `if` 擋掉。

也就是說：專案在被有意識地處置之前，已經實質停擺兩天。這次的工作是把它變成**有意識的暫停**，不是修復。

## 決策

### 1. prod 暫停對外，工作收回本機

不是因為成本（Zeabur 帳單低、且同帳號還有其他服務在跑），是因為**現在的工作型態不需要它**。

現況判定：沒發社群、沒有常客、TA 不對、內容自評「不夠驚艷」。實際上的讀者只有作者自己。在這個前提下，「每天自動產出」提供的價值遠低於它施加的約束（不能動壞線上、要等真實時間累積樣本、改動要先部署才驗得到）。

**`suanomics.zeabur.app` 暫時保持原狀**、掛著 08-27 那份報告。處置動作是在花時間買一個沒人注意的整潔。

### 2. 「每天固定跑一次」的需求取消

使用者明確表示手動觸發即可。連帶取消：本機排程、失敗重試、健康訊號、SLO 告警的本機版。

**這條決策後來被第 6 條部分推翻**——不是恢復自動化，而是發現根本不需要「每天」。

### 3. 品質軸要先回頭驗證，才決定下一步做什麼

這是本次最重要的決策。

**觀察到的矛盾**：過去做的品質工作每一項都有量測顯示改善——grounding 58.2%→97.2%、jargon 詞頻 61→4、storyline 佔格 18→4、具名數字（T1／T5 四刀）、每日 thesis 脊椎（T6）、正反觀點區塊（#141）、去贅詞、週末模式、關鍵數字卡。而使用者對成品的評價仍是「不夠驚艷」。

**最強的反證**：2026-07 皓哥對照的診斷結論是「輸在具名數據／thesis／觀點」。這三項後來**全部做完了**，評價沒有跟著變好。這指向「量測的軸不是瓶頸」，不是「還沒累積夠」。

**因此**：在動任何 backlog 品質項目之前，先做一次回頭驗證。**驗證結果決定 backlog 怎麼排**，不是「順便做」。

### 4. 回頭驗證的方法是同素材重跑，不是跨月比較

原本想的做法（拿 6 月的報告和 8 月的報告並排讀）**不可行**。6 月與 8 月的新聞完全不同，讀到的好壞有很大部分來自「那天新聞本身有沒有料」。[judge-discipline.md:111](../operations/judge-discipline.md) 明文禁止跨日 pairwise，理由正是這個，而人讀也逃不掉同一個污染。

現有工具全部不通：pairwise 系列踩禁區；`prod:ledger-metrics` 量的 `claimLedger` 欄位是 08-08 之後才有的，6 月的 brief 天生沒有；`model:ab` 量的是換 model 不是時間軸；`brief:eval`（皓哥對照）在 2026-06-14 已被自己的設計覆盤判定「量不到深度」、07 月起事實上停用。

**正確做法**：拿 6 月某一天的原始素材（`news_items` + `market_data_points`），用**現在的 pipeline** 重跑，跟**6 月當時產出的那份 brief** 並排。素材完全相同，唯一的變數是這三個月的所有改動。這是 canary fixture 已在用的邏輯（同 fixture 對照），只是把時間軸拉長。

### 5. 皓哥對照從輔助升格為主線，但形態改變

**升格的理由**：使用者自陳「我看起來都不錯，因為我沒有財經背景」——他無法判斷報告品質。所有現有評價都來自機器量測。這使得「找一個有財經背景的判準」從 nice-to-have 變成必要條件。

**形態改變（使用者的修正，比原提案準）**：不比覆蓋率。皓哥是**深度優先、少數主題**，本專案的報告是**廣度優先、多主題**；用覆蓋率比，結果只會顯示「他講的我都有講到」——既是真的，也毫無意義。

**改成**：取交集主題，比同一主題上的**論述方式**——他先講什麼、再連到什麼、用什麼數據支撐，對比我們的推論鏈缺了哪一段。產出是 prompt 改動方向，不是分數。

因此這是**質性對照**，不需要 judge schema、不需要打分、也不需要每天跑。節奏定為每批 3 天、做滿三批（9 天素材），每批產出一份紀錄落 `docs/research/`，做完就改 prompt、下一批驗證改動。

**結束條件**：第三批找不出新的結構性差異——也就是剩下的差距是「他有觀點我沒有」這種模型層面的東西，不是「他的推論鏈有一段我漏了」這種可修的東西。到那時才帶著數據去找有財經背景的人看。

### 6. 需要多天樣本的驗證，用批次補跑歷史素材，不等真實時間

`B` 段（viewpoints 反向事實覆蓋率）之類的驗證需要 10–15 個工作日的樣本。原本這意味著要等三週，而且要記得每天手動跑。

**但素材已經在 DB 裡了**。`news_items` 按日期存著，6 月到 8 月都在。dump 回本機之後，可以在一個下午跑完 15 輪歷史素材。原本要等三週的東西變成等三小時。

**這才是本機化真正的價值**，比「不用等 prod」大得多：從「每天只能拿到一個樣本」變成「素材庫裡有幾個月就能拿幾個月」。第 3、4、5 條需要的素材可以在**同一批補跑**裡一次做完。

### 7. Zeabur 環境全部重建，但要等到恢復對外時才做

**為什麼重建**：環境變數已經髒了（死變數、誤放在錯誤 service 的變數、清單與實際不符），逐個清理不如重來。

**為什麼等**：重建的價值全在「乾淨的變數清單」，而那份清單要由**恢復時的實際需求**決定。現在重建等於用今天的資訊猜三個月後的需求。

**現在只做兩件不會過期的事**：刪已證實的死變數（`FIRECRAWL_API_KEY`、`FIRECRAWL_BASE_URL`），以及第 8 條的密鑰輪替。

### 8. 密鑰輪替：dump → 驗證還原 → 輪替，順序不可調換

**洩漏事實**：2026-08-27 的一次 session 執行了 `zeabur variable list`，把 api-worker 的變數連值印進對話紀錄。曝光範圍是本機 session JSONL 檔加上送到 Anthropic API 的請求內容——**不是公開洩漏，也沒有第三方取得**。Gemini 與 Anthropic 兩把已由使用者停用。

**但風險等級不能因此調降**。Zeabur 的資料庫服務[預設同時提供 Public(External) 與 Private(Internal) 兩組連線資訊](https://zeabur.com/templates/B20CX0)，「只能內部連」不是預設、是要主動關掉才成立；而本專案跑在 dedicated server 上，[防火牆預設放行 30000-32767](https://zeabur.com/docs/en-US/server/firewall)，正是 TCP 服務對外轉發會落的 NodePort 埠段。repo 內只能證明**從來沒用過**外部端點（查 prod DB 一律走 `zeabur service exec`），不能反證它不存在。

配上「歷史資料是活資產」的判定（corpus 重抓不回來，新聞源會過期），Postgres 密碼是唯一需要立刻處理的項目。

**順序約束**：先 `pg_dump` 並驗證還原成功，再輪替。反過來做的話，輪替後任何一處沒同步到，dump 就變麻煩。

### 9. 資料保全：全量 dump、兩份並存、驗證後才刪舊環境

全量 dump 不挑表。整個 DB 大約是 41 份 brief + 近 3000 篇 corpus + 時序資料，挑選要花的思考時間比多 dump 幾張表的成本高；而且既然決定全部重建，**dump 完整性從此是唯一防線**，挑錯一張表等發現時舊 project 已經沒了。

本機開**兩個 database**：一份還原 dump 當「歷史對照組、唯讀」，一份當「重跑工作區」。理由是 `daily_briefs.briefDate` 是 unique（[schema.ts:56](../../packages/db/src/schema.ts)），補跑歷史日期會撞唯一鍵或覆蓋掉要當對照組的原始產出。

舊 Zeabur project 在新環境驗過之前不刪——那是免費的第二份備份。

## 這次盤點出來的事實

### 本機跑 pipeline 比預期簡單

所有 CLI script（`apps/worker/src/scripts/*.ts`）直接呼叫 `enqueueJob()` 寫 Redis + Postgres，由常駐的 BullMQ worker 消費。prod 那條 GitHub Actions → `apps/api` `/internal/*` 的 HTTP 路徑只是另一個入口，兩條路匯到同一個 queue。

**本機不需要 `apps/api`、不需要 R2、不需要 Azure**：音檔儲存本機預設就是 local filesystem，零設定。

**唯一硬缺口**：`market-data-refresh` 沒有對應的 worker CLI script，本機要跑這步得補一個或起 api 用 HTTP 觸發。

### IP 風險的方向與直覺相反

`udn-money` / `udn-main` 是**家用 IP 200、機房 403**（#269 因此停用）；`commercial-times` 與 BLS 則兩邊都 403。收回本機對 corpus 覆蓋率不是純損失，可能撿回兩個 feed。

### 環境變數

- **`FIRECRAWL_API_KEY` 確認死透**，全 repo 零讀取點。連帶 `FIRECRAWL_BASE_URL` 也是死的（[deploy-zeabur.md:43](../operations/deploy-zeabur.md) 已註記），prod 上兩個都還在。
- **`ANTHROPIC_API_KEY` 的服務歸屬記錯了**：讀取點在 worker 不在 api（`apps/worker/src/agents/providers/resolve.ts:96`）。同一支檔案確認「`AI_PROVIDER=anthropic` 才真打 Claude」為真，而 `AGENT_MODEL_DEFAULTS` 現在全是 Gemini，所以預設組態下 Claude 花費是零。
- **三個實際會被讀但清單漏列的變數**：`PODCAST_S3_PUBLIC_BASE_URL`（S3 是 6 個不是 5 個）、`AZURE_SPEECH_VOICE`、`AZURE_SPEECH_RATE`。
- **`PASSWORD`、`API_WORKER_HOST`、`WEB_HOST` 在整個 repo 連字串本身都不出現**（含隱藏目錄）。推測是 Zeabur 平台層的東西（Postgres 模板注入 `PASSWORD`、`DATABASE_URL` 引用它），**未確定**，刪之前要確認沒有其他變數以 `${PASSWORD}` 形式引用。

完整盤點表在重建時取用，落在 session scratchpad，不進 repo（含變數名清單但無值）。

### 品質待辦的形狀

三條線：`B` 段（viewpoints 反向事實缺 claimLedger，第一刀 PR #237 已上但效果不穩定）、`Q4` 九項衍生待辦、corpus-integrity spec 第 4 刀 + authority tier。

四個品質相關 open issue：**#296（88.8% 新聞輸入只有標題）**、#289（補產四處時間基準錯誤）、#286（TWSE OpenAPI adapter）、#199（跨市場訊號一致性，backlog 全無提及）。

**#296 可能就是第 3 條決策要找的答案**：如果 88.8% 的新聞輸入只有標題沒有內文，那過去所有品質工作都在**處理層**，而瓶頸在**素材層**。標題級的素材寫不出獨到觀點，只能寫出正確但平淡的綜述——這跟「不夠驚艷」對得起來。**這個數字本次未親自驗證**，動 #296 之前要重算。

**明確標著「還沒量」的改動**：PR #164（A 刀美股指數資料源），[quality-trend.md](../operations/quality-trend.md) 原文特別註明「別讀成量過了沒差」。

## 未解的問題

**GitHub Actions 排程為什麼停止觸發**。已排除的：60 天無活動自動停用（那條規則只對 public repo 生效，本 repo 是 private，且兩支 workflow 的 `state` 都還是 `active`）。剩下的候選是平台側排程丟棄——08-26T22:56Z 至 08-27T19:44Z 之間有兩起官方 Minor 事件（Billing 與 Actions），最後一次成功觸發正好落在窗內。**但這個解釋撐不住**：事件在 08-27T19:44Z 標記解決，而之後的 21:10Z 與 23:15Z 兩次排程仍然沒有紀錄。

要證實或推翻只需要 `gh workflow run daily-brief.yml`（走 workflow_dispatch、不受 schedule 機制影響），但那會真的跑一輪 pipeline。**恢復對外之前必須解掉**，否則新環境可能重蹈。

## 明確不做

- **不追 podcast 主軸**（這一輪）。使用者確認 podcast 升格為「內容重心轉移」而非「載體翻轉」或「發行翻轉」，工程上零成本，但這一輪不處理——報告品質優先。
  - 附帶記錄：**發行翻轉（進 Apple Podcasts / Spotify）與「手動觸發就好」不能同時成立**。podcast 平台是所有載體裡最吃固定節奏的，日報漏一天只有作者知道，podcast 漏更新是訂閱者會感覺到的。要走那條路，自動化需求會原封不動地回來。
- **不改版網站**。使用者明確定位為「其他方面的改變」，優先序在報告品質之後。
- **不現在重建 Zeabur 環境**（理由見決策 7）。
- **不開 spec**。`docs/superpowers/specs/` 那個層級是給有明確驗收條件的實作任務用的；這次一半是維運動作、一半是還沒定案的探索，寫成 spec 會逼著現在填不知道的欄位。等回頭驗證跑完、知道要修什麼了再開。

## 附帶發現（不在本次範圍，各自獨立）

- **`docs/operations/local-dev.md` 的「Feature Scripts」整節指令是錯的**：寫 `pnpm --filter api run news:refresh` 之類，但那十個 script 沒有一個存在於 `apps/api/package.json`。正確的 filter 是 `@lab/db`（DB 三個）與 `worker`（pipeline 六個）。
- **讀者面缺「這不是今天的報告」提示**。使用者看到頁面顯示 08-27 時的第一反應是「日期顯示錯了」，而行為其實是正確的——`/api/brief/daily` 的語意是「回傳 DB 裡日期最新的一筆」（`packages/db/src/repos/news-repo.ts:261`），不跟系統時鐘比對。既有的空狀態（`apps/web/src/views/HomeView.vue:170`）只在 DB 完全沒有 row 時觸發，不在「最新那筆不是今天」時觸發。這個缺口在 pipeline 恢復後依然存在，只要哪天延遲產出就會再犯。
