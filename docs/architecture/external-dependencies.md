# 外部依賴盤點（失敗可見性）

> 這份表只回答一個問題：**某次外部呼叫失敗時，呼叫端分不分得出來、有沒有留下痕跡。**
> 目的：外部依賴的失敗要能被看見。
> 盤點日 **2026-08-22**，以當時的 code 為準。**改動任何 client 的錯誤處理時，順手更新對應那一列**——這份表過時就等於沒有。

> **這張表最可能壞在「漏了一整個模組」，而不是「某一列填錯」。** 填錯的那種讀者還有機會撞到；漏掉的那種只會讓人以為已經看過了。2026-08-22 兩輪獨立複查各抓到一批：第一輪四列判錯、外加漏掉 `prompt-research` 六個呼叫點；第二輪五處新錯，**其中兩個是我自己寫在下面那節的計數（「兩個 HTTP client」其實三個），而漏掉的第七個呼叫點就躲在那個錯數字後面**。
>
> 所以維護方式不是「改哪個 client 就補哪一列」——那只維護得到已經在表上的東西。**每次動這份表，重跑一次文末「怎麼重跑這份盤點」那組指令，用輸出對表，而不是憑印象。** 表上任何一句「共 N 處」都是最容易腐爛的宣稱。
>
> **而三欄裡最不可信的是「留痕」那一欄。** 前兩欄看該模組自己的原始碼就填得出來，留痕要一路追到 job 層才知道。第四輪驗收專門只驗這一欄，**36 列裡判錯 8 列**——包括把 LLM 失敗寫成「job 會倒」（實際上日報主線多半 catch 掉、記進 metadata）、把 `youtube.ts` 寫成掛在 API route 上（實際上它現在只有 CLI 進入點）、以及把 corpus 解析層寫成「無痕」（實際上它是 out-of-band 外部監控覆蓋最好的一類）。這種錯的代價很具體：**後續修改的優先序完全建立在這一欄上**，判錯一列就會去補一個已經存在的洞、同時放過真正裸奔的那個。

## 為什麼需要這張表

這個 repo 有一個系統性模式：外部依賴失效時回傳空結果（`return []`／`return null`），而空結果對多數來源來說**是合法答案**（今天真的沒有新文章、今天是非交易日）。於是「呼叫失敗」與「查無結果」在呼叫端長得一模一樣。

2026-08-21 的 firecrawl 案例是這個形狀的極端版：client 讀錯欄位，金鑰壞著時它安靜回空陣列（無害），金鑰一修好就開始把「沒有內容的 URL」送進 citation 白名單並落到讀者面，而測試全綠。

所以這不是一致性問題，是**契約問題**——不能靠「統一改成 throw」解決，要讓型別分得出這兩件事。

## 怎麼讀

- **抓取層**＝實際發 `fetch`／SDK 呼叫的函式；**外層／解析層**＝拿到回應之後決定要不要吞掉錯誤的那一層。同一個模組兩層行為常常相反（抓取層 throw、解析層靜默回空），所以分開列。
- **分不分得出來**＝呼叫端拿到回傳值時，能不能分辨「呼叫失敗」與「呼叫成功但真的沒東西」。
- **留痕**這一欄只回答一件事：**沿著呼叫鏈往回流的痕跡**（`console.warn/error`、`background_jobs.metadata`、job 的 `status='failed'`）。所以這欄的「無」一律要讀成**「呼叫鏈上無」，不是「沒有人看得到」**——見下面「這欄看不到的那一半」。
- `console` 的痕跡只在容器 log，`/api/ops` 與外部監控看不到；這個差別在下表以「log only」與「DB」區分。
- ★ 標記的是這次盤點**新發現、起點表沒有列**的缺口。

## 總表

### Market data（`apps/server/src/market-data/`）

| 模組（層） | 失敗時回什麼 | 分得出來嗎 | 留痕 |
|---|---|---|---|
| [`fetch-source.ts:28`](../../apps/server/src/market-data/fetch-source.ts) 共用抓取層 | 非 2xx→`throw HTTP <code>`；timeout→`throw timeout after <ms>`；DNS→原樣 rethrow（刻意不標成 timeout）；解析在 try 內、不吞 | 看得出來（三類錯誤訊息可分） | 本層無，責任在外層 |
| ★ [`fred-client.ts:11`](../../apps/server/src/market-data/fred-client.ts) | 抓取層同上；但解析層 `body.observations ?? []`（:18）——**HTTP 200 而回應換了形狀時靜默回 `[]`**，與 `ex-dividend-source.ts` 同病。（`.` 值 filter 掉是 FRED 表示「該期無觀測值」的正常語意、非失敗） | 抓取看得出來、**解析層看不出來** | 見 `refresh.ts`；解析層無痕 |
| ★ [`twse-client.ts:107`](../../apps/server/src/market-data/twse-client.ts) 解析層 | 全檔只有三處 warn（`stat !== 'OK'`:110、TWT93U 欄序:194、FMTQIK 非 array:211）；**融資／融券／三大法人那三個 parser 走 `pickLegacyCell`（:76），欄名被改掉時回 `undefined`→靜默 `[]`**，與非交易日同型 | **部分**——只有那三處格式錯查得到，`pickLegacyCell` 那三個看不出來 | log only（且只涵蓋三處） |
| [`nasdaq-client.ts:62`](../../apps/server/src/market-data/nasdaq-client.ts) `/historical` | `data:null`（symbol 錯）→**throw**（刻意要吵）；查詢窗無交易日→靜默 `[]`；`rows` 非 array→warn+`[]` | 看得出來 | log + `failures` 進 DB |
| [`nasdaq-client.ts:188`](../../apps/server/src/market-data/nasdaq-client.ts) `/info` 疊加 | 永不 throw，任何看不懂的形狀→warn+`null`；fetch 失敗也只 warn、不計入 failures | 看不出來（**刻意**：這層只能讓結果變好、不能讓結果更糟） | log 完整（每次疊加固定印一行結果） |
| ★ [`taifex-client.ts:28`](../../apps/server/src/market-data/taifex-client.ts) 解析層 | header 不符預期**或**回應是 HTML（非交易日的正常回應）→**兩者都靜默 `[]`** | **看不出來**——「TAIFEX 改格式了」與「今天非交易日」同型 | **無** |
| [`investor-conference-source.ts:17`](../../apps/server/src/market-data/investor-conference-source.ts) | 抓取層自己重複實作了一份 `fetchSource`（非 2xx throw／timeout 改寫）；解析層選不到 `tr[data-type=body]`→靜默 `[]` | 部分（抓取看得出來、解析看不出來） | 模組本身**零 console**；唯一的 log 是 throw 冒到 `context.ts:151` 才 warn，**解析層那條完全無痕** |
| ★ [`ex-dividend-source.ts:37`](../../apps/server/src/market-data/ex-dividend-source.ts) 解析層 | `if (!Array.isArray(body)) return []`——**連 warn 都沒有** | **看不出來** | **無**（兩個公司事件源裡較差的那個；`market-calendar.ts:19` 的 category enum 只有 `ex-dividend`／`investor-conference`） |
| ★ [`context.ts:82`](../../apps/server/src/market-data/context.ts) brief 產出當下 | **這一層會現打外部網路**——`loadMarketContext` 的預設 deps 直接注入 `fetchExDividendEvents()` 與 `fetchInvestorConferenceEvents()`（:86-87），也就是每產一份報告就打一次 TWSE 與 MOPS。`loadCompanyEvents`（:143）一律 catch→warn+`[]` | **看不出來**——「今天沒有除權息」與「TWSE 沒回應」都是空陣列 | log only，**失敗訊息到不了 DB**（brief 本身有 job row，但 `RunMetadata` 只裝 llmCalls／成本／延遲／partialSuccess，沒有任何 market-context 欄位；job 照常成功，讀者面只是行事曆少一塊）。`podcast/generate.ts:77` 是第二條同樣無痕的呼叫路徑 |
| [`refresh.ts:34`](../../apps/server/src/market-data/refresh.ts) 外層 | 逐序列 try/catch，失敗 push 進 `failures` + warn；**整個 job 仍算成功** | 看得出來（有 `failures` 陣列） | **DB**——`failures` 寫進 `background_jobs.metadata`（`apps/server/src/index.ts:114`） |

### Corpus 抓取（`apps/server/src/corpus/`）

| 模組（層） | 失敗時回什麼 | 分得出來嗎 | 留痕 |
|---|---|---|---|
| [`sources/rss.ts:37`](../../apps/server/src/corpus/sources/rss.ts) 抓取層 | 非 2xx→`throw`；timeout **無訊息轉譯**（裸 `AbortError` 往上丟）；DNS 原樣丟 | 看得出來（但錯誤訊息不含來源名） | 見 corpus-worker |
| [`sources/rss.ts:51`](../../apps/server/src/corpus/sources/rss.ts) 解析層 | rss/atom 結構都對不上→靜默 `[]` | 看不出來 | 呼叫鏈上無，**但這是 out-of-band 覆蓋最好的一類**：來源掛零會被 `summarizeSourceSilence` 抓到，讓部署者自備的外部監控可以告警 |
| [`sources/html-selector.ts:23`](../../apps/server/src/corpus/sources/html-selector.ts) | 抓取層同上；selector 選不到任何項目→迴圈跑完、`entries` 維持空陣列、無 warn | 部分（抓取看得出來、解析看不出來——「listing 頁改版」與「今天沒更新」同型） | 見 corpus-worker |
| [`jobs/handlers/corpus-worker.ts:105`](../../apps/server/src/jobs/handlers/corpus-worker.ts) 外層 | catch→`console.error` + `totals.fetchFailed`，彙總成 `failedSources` | 看得出來 | **DB**（`background_jobs.metadata.failedSources`，第 1 級） |
| 兩日一次的排程觸發 | 不適用（它不是呼叫點，只是觸發方式）——失敗行為同上一列 | 不適用 | **與其他觸發方式一致**：2026-09-04 起排程改由部署者自備的外部排程打 `POST /internal/corpus/refresh`，走同一條 enqueue 路徑，所以本來就有 audit row。在那之前它繞過 enqueue、要靠一個「查不到 row 就自己補一筆」的補丁才留得下痕跡 |

~~corpus-refresh 的留痕分兩條完全不同的路~~——**現在兩條路一致了**：排程觸發（每 2 天一次，是主要觸發方式）以前只有一行 `console.error`，2026-08-22 靠補丁補上 row，2026-09-04 改走 HTTP endpoint 之後連補丁都不需要。

### News 抓取（`apps/server/src/external/`、`news/`）

| 模組（層） | 失敗時回什麼 | 分得出來嗎 | 留痕 |
|---|---|---|---|
| ★ [`external/rss-fetcher.ts:93`](../../apps/server/src/external/rss-fetcher.ts) 抓取層 | 非 2xx→**`throw`**（不是最初起點表寫的 catch-return-`[]`）；timeout 無訊息轉譯；DNS 原樣丟 | 看得出來（外層會標 `failed:true`） | 見 `news/refresh.ts` |
| [`external/rss-fetcher.ts:50`](../../apps/server/src/external/rss-fetcher.ts) 解析層 | XML 語法錯→catch+`[]`；channel 結構不對→靜默 `[]` | 看不出來（**這裡才是真的 catch-return-`[]`**） | 無 |
| [`external/scraper.ts`](../../apps/server/src/external/scraper.ts) | **已改（樣板）**：回 `{ ok: true, text: string \| null } \| { ok: false, reason, detail }`。`reason` 分 `http_error`／`timeout`／`network_error`／`parse_error`；`text: null` 是**呼叫成功但這篇沒有正文**的合法結果，不算失敗。2026-09-08 另修兩個抓取層本身的缺陷（不影響上面這個型別契約）：`hk.finance.yahoo.com` 的標頭超過 undici 預設 16 KB 上限會直接 `Headers Overflow Error`，改用帶 64 KB `maxHeaderSize` 的 undici `Agent` 當 `fetch` 的 dispatcher；`res.text()` 原本一律當 UTF-8 解，Big5 站（MoneyDJ）解出來是 U+FFFD 加錯字，改成 `res.arrayBuffer()` 讀 bytes、依 `Content-Type` 的 `charset=` 或 `<meta>` sniff 決定編碼再解碼，兩者都沒有才落回 utf-8 | **看得出來**——失敗與空結果在型別上分開 | **第 1 級**：失敗數進 `perSource[].scrapeFailed` → `background_jobs.metadata`。★ 但目前**沒有 HTTP 介面讀得到**（`/api/ops` 不碰 `background_jobs`、`/api/jobs/:id` 只挑 `routingMode`），要直連 DB 撈。逐篇的 reason 與 URL 仍只在容器 log（只印前 3 筆） |
| [`news/refresh.ts`](../../apps/server/src/news/refresh.ts) 的 `runNewsRefresh` 外層 | RSS 失敗→`sourcesFailed++`／`perSource.failed` + error log；scrape 失敗現在走自己的分支、逐篇 warn 帶 reason（只印前 3 筆，其餘靠彙總行），**不**把整個來源標成失敗。Google News 代理來源（`isGoogleNewsProxySeed`）整批在 feed 層跳過抓正文，不算失敗——`perSource[].feedSkipped` 記跳過的則數，這批來源只會拿到標題與轉址連結 | RSS 與 scrape 都看得出來、而且是**分開的兩件事** | **DB**（`sourcesFailed`／`perSource`／`perSource[].scrapeFailed`／`perSource[].feedSkipped` 進 `background_jobs.metadata`） |

### Podcast TTS 與音檔儲存

| 模組（層） | 失敗時回什麼 | 分得出來嗎 | 留痕 |
|---|---|---|---|
| [`podcast-tts/azure-tts-client.ts:50`](../../apps/server/src/podcast-tts/azure-tts-client.ts) | 非 2xx→`throw`（含前 300 字回應）；缺 key/region→提前 throw（設定錯與網路錯同型）；**無 timeout**（無 `AbortController`、可以無限等） | 看得出來 | 見外層 |
| [`podcast-tts/gemini-tts-client.ts:73`](../../apps/server/src/podcast-tts/gemini-tts-client.ts) | 非 2xx→`throw`（含前 500 字）；找不到 `inlineData`→`throw` 具名訊息；**無 timeout** | 看得出來（HTTP 失敗與形狀不對訊息不同） | 見外層 |
| [`podcast/tts.ts:51`](../../apps/server/src/podcast/tts.ts) 外層 | 不 catch，原樣往上到 runner | 看得出來 | **DB**（`background_jobs.status='failed'` + `errorMessage`）——少數一路到底都看得見的完整鏈路 |
| [`s3-podcast-storage.ts:48`](../../packages/db/src/storage/s3-podcast-storage.ts) `save()` | 非 2xx→`throw`；**無 timeout**（`aws4fetch` 未包 `AbortController`） | 看得出來 | DB（同上，失敗會讓 job 失敗） |
| [`s3-podcast-storage.ts:60`](../../packages/db/src/storage/s3-podcast-storage.ts) `exists()` | 403／404／500 全部摺成 `return res.ok` 的 `false` | 看不出來 | 無。**但目前是死碼**：prod 走 `S3PodcastStorage` 分支直接 `urlFor()` 做 302、不呼叫 `exists()`（`apps/server/src/http/routes/audio.ts:26`），只有 `LocalPodcastStorage` 路徑與測試會呼叫 |

### LLM provider

| 模組（層） | 失敗時回什麼 | 分得出來嗎 | 留痕 |
|---|---|---|---|
| [`agents/providers/gemini.ts:36`](../../apps/server/src/agents/providers/gemini.ts) | 原樣 rethrow SDK 拋出的錯誤、不重新分類（SDK 內部行為**未查明**） | 看得出來「失敗了」，但**分不出是哪一種**失敗——沒有 `fetch-source.ts` 那樣的 `AbortError`→具名訊息轉譯 | 見 `llm-wrapper` |
| [`agents/providers/anthropic.ts:35`](../../apps/server/src/agents/providers/anthropic.ts) | 同上；額外一種：回應找不到 `tool_use` block→具名 throw | 同上 | 見 `llm-wrapper` |
| [`agents/llm-wrapper.ts:122`](../../apps/server/src/agents/llm-wrapper.ts) 外層 | 重試 3 次、`AbortError` 不重試、耗盡後原樣 throw | 看得出來 | **視上游而定，多半是第 1 級不是第 2 級**：日報主線的 LLM 失敗大多不會讓 job 倒——`narrative-writer.ts:208` catch 後回 `narrative:null` 並把 `narrativeFailed`／`retryReason` 經 `LlmCallRecord`（`llm-wrapper.ts:31`）寫進 metadata；per-news 失敗走 `orchestrator.ts:299` 的 `metadata.partialSuccess`。真正讓 job 倒的只有沒人 catch 的那些。**中途每次重試失敗仍無紀錄**（`attempts` 只在成功時寫進 record） |
| [`prompt-research/src/gemini-client.ts:33`](../../packages/prompt-research/src/gemini-client.ts) | 自帶重試迴圈（3 次）與固定 45s timeout——**與 `agents/providers/gemini.ts` 分工不同**：那邊本身不重試（重試在 `llm-wrapper`）、timeout 由 `AGENT_TIMEOUT_MS` 決定。兩邊都是原樣 rethrow SDK 錯誤 | 同 providers | 無自己的 log。★ 而且 `prompt-research` 裡 `new GoogleGenAI` 共五處，另外四處各自起 client、不經過這一份（見下一節）——改「失敗要留痕」的樣板時，那四處不會自動跟上 |

### `prompt-research`（非日報主線）

待決問題「`prompt-research` 的 yt-transcript 與 podcast TTS 算不算在盤點內」——**算**，它們一樣會打外部網路；非日報主線，排優先序時往後放。

**但「非日報主線」不等於「人工跑跑而已」**：`prompt-refresh` 是正式註冊的 job kind（`apps/server/src/jobs/handlers/index.ts`），audit lifecycle 由 runner 管，還有 HTTP 觸發端點（`apps/server/src/http/routes/internal.ts:91`）。所以下表各列寫「無自己的 log」指的是**該模組本身不記**，失敗仍會讓整個 job 失敗、在 `background_jobs` 留下 `status='failed'`（三級分類的第 2 級）。別把「無自己的 log」讀成「無痕跡」。

**這個 package 的外部呼叫比想像中多**：三個 HTTP client 都寫成 `fetchImpl ?? fetch` 以便注入測試，`rg 'fetch\('` 一個都掃不到；`new GoogleGenAI` 全 package 五處，其中四處（`audio/gemini-stt`、yt-transcript 的三個 stage）自己起 client、不走 `gemini-client.ts`。連同 yt-transcript 的兩個 HTTP 抓取與 `gemini-client.ts` 本身，這個 package 一共十個外部呼叫點。這是「只用 `fetch(` 當下界會漏掉什麼」最好的例子。

| 模組（層） | 失敗時回什麼 | 分得出來嗎 | 留痕 |
|---|---|---|---|
| [`yt-transcript/transcript-fetcher.ts:15`](../../packages/prompt-research/src/sources/yt-transcript/transcript-fetcher.ts) | **沒有任何 try/catch**，第三方套件拋什麼就往上傳 | 看得出來（但不分類）；呼叫端 `dispatchYt` 用 `pMap` 併發 3、不個別 catch，而 `pMap` 內部是 `Promise.all`（`dispatch-helpers.ts:12`），所以**一支影片失敗＝整批失敗** | 模組本身無 log，但整批失敗會讓 `prompt-refresh` job 失敗、留 `status='failed'`（第 2 級）。**唯一完全沒有測試的抓取模組** |
| [`yt-transcript/playlist-resolver.ts:239`](../../packages/prompt-research/src/sources/yt-transcript/playlist-resolver.ts) | 非 2xx→`throw`；無 timeout | 看得出來 | 模組本身無 log，失敗會讓 `prompt-refresh` job 失敗（第 2 級）——同 `transcript-fetcher` |
| [`apps/server/src/transcript/youtube.ts:80`](../../apps/server/src/transcript/youtube.ts) | `classifyError()` 把套件錯誤依**訊息字串 regex** 分成 `no_transcript`／`not_found`／`fetch_failed` | **本表分類做得最好的一個**（呼叫端可依 `reason` 分流） | stderr + `exitCode=1`。★ 它**目前沒有掛在任何 route 上**——`apps/server/src/http/app.ts` 的 `createApp()` 註冊的是 health／brief／market／ops／jobs／internal／audio，唯一 importer 是 CLI `apps/server/tools/cli/transcript.ts:3` |
| [`sources/skill-markdown.ts:24`](../../packages/prompt-research/src/sources/skill-markdown.ts) | 打 `raw.githubusercontent.com`；非 2xx→`throw`（訊息含整份 body）；15s `AbortSignal.timeout` | 看得出來 | 無自己的 log；失敗上浮成 job 失敗（第 2 級） |
| [`podcast-rss/rss-fetcher.ts:13`](../../packages/prompt-research/src/sources/podcast-rss/rss-fetcher.ts) | 非 2xx→`throw`（訊息含整份 body）；15s `AbortSignal.timeout`；解析在呼叫端 | 看得出來 | 無自己的 log；同上（第 2 級） |
| [`audio/download-mp3.ts:27`](../../packages/prompt-research/src/audio/download-mp3.ts) | 非 2xx→`throw`；`content-length` 超過上限→另一種具名 `throw` | 看得出來（兩種失敗訊息可分） | 無自己的 log；同上（第 2 級） |
| [`audio/gemini-stt.ts:73`](../../packages/prompt-research/src/audio/gemini-stt.ts) | Gemini File API：上傳無 `name`→throw；file state `FAILED`→throw；等 ACTIVE 逾時→另一種具名 throw；`generateContent`（:131）原樣 rethrow | 看得出來（三種失敗訊息可分，是本表少見的細分） | 無自己的 log；同上（第 2 級） |
| [`yt-transcript/segmenter.ts:46`](../../packages/prompt-research/src/sources/yt-transcript/segmenter.ts)、[`lens-extractors.ts:93`](../../packages/prompt-research/src/sources/yt-transcript/lens-extractors.ts)、[`consolidator.ts:42`](../../packages/prompt-research/src/sources/yt-transcript/consolidator.ts) | 各自 `new GoogleGenAI` 直呼；`AbortController` 逾時；空回應→`throw empty response from Gemini`；schema/JSON 失敗走各自的重試 | 看得出來 | 有重試紀錄，但**只涵蓋 schema 類失敗**：`logger.emit('retry')` 只在 `ZodError`／`SyntaxError`（與 `empty response`）觸發，**非 2xx／timeout／網路錯誤是原樣 rethrow、零 retry 紀錄**——而那才是本表要問的失敗。且 `run-log.jsonl` 落在容器內 `.prompt-research-out/`（`logger.ts:28`），不是可查詢介面 |

`youtube.ts` 的分類有一個潛在陷阱：靠字串比對第三方套件的錯誤訊息，套件升級改了文字就會安靜地全部落回 catch-all 的 `fetch_failed`——而真正的 timeout／DNS 失敗現在也落在同一個 catch-all，兩者無法二次區分。

### 掃到但判定不屬於「外部依賴」

- `apps/web/src/**` 的 `fetch`：打的是自家 `apps/server`，屬前端 UX 範疇。
- `apps/server/tools/cli/*`、`apps/server/tools/eval/**`：一次性人工診斷腳本與 eval 基礎設施，非生產排程路徑。
- `apps/server/src/http/routes/` 的其餘 route：轉派給同 process 的 job runner、讀 DB，或轉呼已列表的模組（`tools/cli/transcript.ts` 只是包 `src/transcript/youtube.ts`）。
- **Postgres 刻意不列**：它確實是跨進程連線、也會失敗，但屬於「自家基礎設施」而非本表定義的第三方外部依賴，失敗語意與治理方式都不同（連不上 DB 是整個服務的事，不是某個來源今天沒資料）。這裡明寫出來，是因為讀者分不出「判定不算」與「忘了列」時，這份表就開始給人假的安全感。

## 留痕的三種強度（別把它們當同一件事）

1. **當成資料記下來**——job 仍算成功，但失敗的來源被寫進 `background_jobs.metadata`，事後可查、可統計：`market-data-refresh` 的 `failures`、`news-refresh` 的 `sourcesFailed`／`perSource`、`corpus-refresh` 的 `failedSources`（**僅手動觸發**，見上）。三處都在 `apps/server/src/index.ts` 的 `makeMetadata`。
2. **讓整個 job 失敗**——`background_jobs.status='failed'` + `errorMessage`，運維看得到但顆粒度只到 job：podcast TTS、LLM provider 耗盡重試後都是這一類。
3. **只有 `console`**——容器 log 裡，無計數、無查詢介面，`/api/ops` 與外部監控都看不到。本表多數解析層屬於這一類。

待處理的是「連第 3 級都沒有」與「該進第 1 級卻只到第 3 級」的那些。

### 這欄看不到的那一半：out-of-band 觀測

上面三級全都是**呼叫鏈上**的痕跡——失敗從抓取層往上流，沿途被誰記下來。但這個 repo 還有一種完全不同的觀測方式：**從資料的缺席反推失敗**。

`/api/ops/publication-status` 的 `sources`（`apps/server/src/http/routes/ops.ts` 裡呼叫的 `summarizeSourceSilence`）看的是各來源在窗內有沒有產出，部署者自備的外部監控可據此判斷來源持續零產出（`silent`）或從未有產出（`never`）並告警。**它不需要任何呼叫鏈上的痕跡**：來源死了、`external_articles` 就沒有新 row，讀這個端點的監控就看得到。

這是「資料面的靜默」，與本份治的「呼叫面的靜默」是兩條互補的軸。**排優先序時必須把兩軸疊起來看**：一個呼叫鏈上完全無痕、但資料缺席可被部署者自備的外部監控抓到的來源，實際風險低於一個呼叫鏈上有 warn、但沒有任何資料面監控的路徑。

out-of-band 這一軸目前覆蓋的是「有落 `external_articles`／`news_items` 的來源」。**覆蓋不到的**是：不產生 row 的呼叫（market-data 的行事曆、TTS、儲存、LLM），以及「有產出但產出是錯的」（firecrawl 那個案例就是——它有回東西，只是那些東西沒有內容）。

（本欄第一版對這半邊完全沒設防：`corpus/sources/rss.ts` 解析層被判「無」，實際上它正是部署者自備的外部監控最容易覆蓋到的一類。複查時抓到這件事——追呼叫鏈的方法**原則上**看不到 out-of-band 的觀測者。）

### 第三軸：設定層的失敗在啟動時就叫（2026-08-22）

（逐一環境變數的分級與已知打錯字陷阱見 [環境設定](configuration.md)；這裡講的是這道檢查本身的設計。）

上面兩軸講的都是**呼叫已經發生之後**的事。但本表裡有一類失敗其實在第一次呼叫之前就已經註定：金鑰沒設。它原本的形狀分三種——lazy client 等第一次呼叫才 `throw`（`GEMINI_API_KEY`）、`?? ''` 帶著空字串照打（`FRED_API_KEY`、四把 R2 憑證）、以及最陰險的**靜默換 provider**（`AI_PROVIDER=anthropic` 缺金鑰時 `resolve.ts` 會 fallback 回 Gemini）。

現在 server 啟動時跑一次 `checkStartupConfig`（`packages/shared/src/startup-config.ts`）：主線缺 → `process.exit(1)`；次要缺 → 大聲 log、服務照起。結果另外掛在 `GET /api/ops/config-health`（只回 key 名與影響、不回值）。

它與前兩軸互補也有明確邊界：**它只看得到「缺」，看不到「有但是壞的」**。firecrawl 那個案例的金鑰是有效的、壞的是欄位讀錯——那種形狀這一軸看不到，要靠故障注入與以真實樣本為底的 mock（後者見下面的第四軸）。

### 第四軸：測試裡的樣本有沒有現實依據（2026-08-22）

前三軸講的都是**線上**的失敗怎麼被看見。這一軸講的是**測試**——因為 firecrawl 事故發生時，線上與測試都沒叫：mock 自造了一個真實 API 不會回的形狀，測試從第一天就是綠的，驗的是「實作與 mock 之間的一致性」。

盤點 `apps/server` 底下 `__fixtures__` 的 9 份樣本發現**三份是手寫的**（`rss-sample.xml` 的內容是 `Sample Feed`／`example.com`，`html-listing-sample.html` 是 `新聞1/新聞2/新聞3`，`cnyes-sample.json` 是 `鉅亨新聞一/二/三`），另外六份看起來像真實擷取但**沒有任何出處紀錄**。兩類躺在同一個目錄、檔名同樣帶 `-sample`，在此之前分不出來。

處置是每個 `__fixtures__` 目錄配一份 `manifest.ts`（來源 URL、`origin` 三態、`shapeVerifiedAt`、抓取後做過什麼），加一支 `pnpm fixtures:check` 打真 URL **只比形狀不比值**。**刻意不進 CI**——外部服務不可用造成的紅燈會訓練出「忽略紅燈」的習慣。

★ 這一軸的判準是「**形狀有沒有被驗證過**」，不是「是不是真實擷取」。手寫樣本填上真實 URL 照樣能對，那一比正是在問「這個人推測出來的形狀，真實 API 到底回不回」。第一次跑就抓到 `cnyes-sample.json` 有一個真實 API 不回的 `url` 欄位。★ 範圍限 `apps/server`；`packages/prompt-research` 的 `yt-streams-sample.html` 是手造的 `ytInitialData`、與 firecrawl 完全同型，屬**已知未涵蓋**的第二現場。

## 最該先處理的三個

1. ~~**`external/scraper.ts`**~~ **已處理**（型別契約樣板）。原本的問題：非 2xx、timeout、DNS、body 讀壞，加上「正文太短」這個合法情境，五種狀況共用同一個 `null`，而且零留痕。選它當樣板的理由是形狀最單純、呼叫點只有一個（`rg scrapeArticle` 只命中 `news/refresh.ts`），改動可以完整 review。

   當初選它時寫過「它只能示範型別分流、示範不了留痕」——**那句話後來不成立了**：`perSource[].scrapeFailed` 已經把失敗數送進 `background_jobs.metadata`。留下來的限制是**逐篇的 reason 與 URL 仍只在容器 log**。

   另外，「傷害面最大」這個說法不成立：scrape 失敗只讓 `contentText` 留 `null`、分析變淺。真正把**錯的東西**端到讀者面的是 `taifex-client.ts` 與 `ex-dividend-source.ts` 那種靜默 `[]`——關鍵數字卡與行事曆少一項，而沒有任何人會知道。
2. ~~**corpus-refresh 的排程觸發不寫 `background_jobs`**~~ **已處理**（2026-08-22 補丁，2026-09-04 改走 HTTP endpoint 後成為結構性保證）。它原本壞在：來源掛零這件事部署者自備的外部監控看得到（out-of-band 的 source-silence 訊號從資料缺席就抓得到），看不到的是「這次 refresh 到底跑了沒、跑了幾個來源、失敗了幾個」——所以真正的後果是**分不出「來源死了」與「refresh 根本沒跑」**。現在排程跑會留 row，那條分不出來的線補上了。
3. **LLM provider 的測試**——`gemini.test.ts` 完全沒有失敗路徑測試，兩份 provider 測試的 mock 都是自造的成功回應形狀，與觸發 firecrawl 事故的 mock 模式同型。目前還沒有已知傷害（這兩層是原樣 rethrow、沒有像 firecrawl 那樣做欄位改寫），但形狀風險一樣（見上面『第四軸：測試裡的樣本有沒有現實依據』）。

## 與最初起點表的差異

最初那張六列的起點表（`rg 'fetch\('` 掃出來的）有四處要更正：

1. **`external/rss-fetcher.ts` 的「`catch → return []`」不準確。** 抓取層其實是 `throw`，會被 `news/refresh.ts` 接住並標記 `sourcesFailed`；真正 catch-return-`[]` 的是解析層。粒度要跟同表的 `corpus/sources/rss.ts` 那列一致、拆成兩層。
2. **用 `fetch-source.ts` 一列代表整個 market-data 抓取層是過度概括。** 那只是共用的 fetch 骨架；四個 client 的**解析層**差異很大——`nasdaq-client.ts` 留痕最完整，`taifex-client.ts` 完全靜默。
3. **`taifex-client.ts` 的解析層缺口原表沒列**（格式改版與非交易日同型、無 warn）。
4. **`ex-dividend-source.ts` 的解析層缺口原表沒列**（連 warn 都沒有）。

## 未查明

盤點時明確查不到、需要另外動手才能確定的（**不要用推測填空**）：

1. `@google/genai` SDK 內部對非 2xx／timeout／DNS 各自拋出什麼型別與訊息形狀。
2. `aws4fetch` 的 `AwsClient.fetch` 對簽章失敗與網路層錯誤是否可區分。
3. `youtube-transcript-plus` 在各種失敗情境下實際拋出的 Error 子類別與訊息文字（`classifyError` 的 regex 是否窮盡）。

原本列在這裡、但一個指令就查得到的四項已經結掉，答案記在這裡免得下次又被列成未知：

- **`@anthropic-ai/sdk` 有現成的錯誤子類別**——`APIError`／`APIConnectionTimeoutError`／`RateLimitError`（`apps/server/node_modules/@anthropic-ai/sdk/core/error.d.ts:4,29,57`）。`providers/anthropic.ts` 原樣 rethrow、沒有用它們分類，這是可以直接撿的低垂果實。
- ~~**只有 corpus 有繞過 enqueue 的排程進入點**~~ → 2026-09-04 起**沒有任何繞過 enqueue 的進入點**：corpus 的兩日排程改成外部排程打 `/internal/corpus/refresh`，process 內不再有 scheduler。
- **沒有人在讀 `background_jobs.metadata.failures`**——在 suanomics 重跑 `rg failures apps/server/src` 已非零命中（market-data 那組的寫入者與測試斷言字面就含 `failures`），但逐一核對後沒有一處是**讀取**這個欄位的下游消費者（`apps/server/src/http`、`apps/server/src/brief` 均不讀）。寫進去了、但沒有下游消費，這是待補的缺口。
- **`gemini-client.test.ts` 存在**（`packages/prompt-research/src/gemini-client.test.ts`）。

## 怎麼重跑這份盤點

下界是 `rg 'fetch('`，但**只用它會漏掉走 SDK 的那些**（Gemini／Anthropic／aws4fetch／youtube-transcript-plus 都不長那樣）：

```bash
# 1. 下界。注意它掃不到寫成 fetchImpl ?? fetch 的 client（prompt-research 有三個）
rg 'fetch\(' apps packages --type ts -g '!*.test.ts'

# 2. 補上注入式 client 與 SDK。用 import 掃、不要用 new GoogleGenAI——
#    prompt-research 那幾處是先 cast 再呼叫，字面 new 掃不到
rg -l 'fetchImpl|@google/genai|@anthropic-ai/sdk|aws4fetch|youtube-transcript-plus' \
  apps packages --type ts -g '!*.test.ts'

# 3. 其他 HTTP 途徑（axios／node-fetch／XMLHttpRequest 目前零命中，掃是為了確認維持零；
#    undici 2026-09-08 起有命中，見下方說明，不算灌水）
rg '\baxios\b|node-fetch|undici|XMLHttpRequest' apps packages -n -g '!*.test.ts'
```

第 3 條的 `undici` 命中**不是新的呼叫點、也不是灌水**：唯一的 import 是 `external/scraper.ts`
為了加大 `fetch` 的 dispatcher `maxHeaderSize` 而 `import { Agent } from 'undici'`。
其餘命中是 `scraper.ts` 內數處註解與 `package.json` 的依賴宣告。它本來就走全域 `fetch`
（本表既有的呼叫點），不是多開一條 HTTP 途徑，所以不用在上面的總表加新的一列。

第 2 條的輸出要逐檔看過再判：`@google/genai` 有四個命中是**只 import `Type` enum 定義 response schema**（`brief/analyzer.ts`、`corpus/entity-summary-response-schema.ts`、`prompt-research` 的 `digest-response-schema.ts` 與 `yt-transcript/response-schemas.ts`），不是呼叫點。把它們當呼叫點會讓表灌水，而灌水的表跟漏列的表一樣不能信。

留痕那一欄要另外追呼叫鏈到 job 層才填得出來（`console` 的痕跡與 `background_jobs` 的痕跡差很多）：

```bash
rg -n 'background_jobs|markMetadata|markFailed|job_kind' packages/jobs/src apps/server/src -g '!*.test.ts'
rg -n 'makeMetadata' apps/server/src/index.ts
```
