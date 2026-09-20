# canary-example fixtures

這個目錄底下的兩天資料（`2026-03-02`、`2026-03-03`）是**完全虛構的合成資料**，不是真實新聞或真實市場報告。公司名稱（北成電子、海緯航運、龍鼎金控、恆碁科技等）、財報數字、法說會內容全部是編造的，任何與真實企業或事件的雷同純屬巧合。

## 為什麼有這個目錄

`apps/server/tools/eval/fixtures/canary/`（沒有 `-example` 後綴的那個目錄）是給**真實** canary fixtures 用的位置——真實財經媒體的新聞全文受版權限制，不隨這個 repo 發佈，要用的人得自己準備。

沒有那組真實 fixtures，這四支量測腳本在公開版的 clone 上的行為並不一致：`pnpm brief:canary` 會因為「無可用日期」直接 `exit(1)`、完全跑不起來；`pnpm claim:yield`、`pnpm ledger:ab`、`pnpm model:ab` 則不會退出，只會在空的日期清單上跑完迴圈、照樣產出一份沒有任何樣本的空報告（前兩支落檔，`pnpm model:ab` 只印在終端、本來就不寫檔）。兩種行為都讓外部使用者拿不到有意義的量測結果，但退版到這個目錄後，四支都能吃到至少一組資料、走完整條 pipeline。這個目錄的存在是為了讓外部使用者：

1. 看得懂這個專案的 fixture 資料長什麼形狀（`sources.json` / `brief.json` 的欄位與 schema）。
2. 能實際執行那四支腳本、觀察 pipeline 的執行流程與輸出格式。
3. 理解 `MarketBriefSchema` 各欄位（`dailyThesis`、`viewpoints`、`narrative`、`cascadeChains` 的 tier 結構等）之間如何互相引用。

## 這組資料不能拿來做什麼

**不能拿來當量測基準。** 這裡的「新聞」是編造的，數字也是編造的，跑 `brief:canary` 的 content-ablation 或 `model:ab` 的 A/B 比較，得到的深度／可讀性／grounding 判定對這個專案本身沒有任何參考價值——它只證明腳本能跑完、輸出格式正確。要得到有意義的量測結果，得換成你自己準備的真實 canary fixtures。

`apps/server/tools/eval/canary-fixtures.ts` 的 `resolveCanaryDir()` 會在真實 fixtures 目錄不存在時自動退版到這裡；四支消費腳本執行時都會印出 `canaryExampleNotice()` 的警告字串，提醒使用者目前吃的是合成資料。

## 資料形狀

- 每個日期目錄底下有 `sources.json`（4 筆虛構新聞，`contentText` 至少 300 字元）與 `brief.json`（符合 `MarketBriefSchema`、含 `dailyThesis` 與 `viewpoints`，讓 `brief:canary` 的 ablation 不是 no-op）。
- 所有 URL 一律是 `https://example.com/...` 底下的路徑，方便一眼辨識為假資料。
- `cascadeChains` 刻意包含至少一條 tier 1 與一條 tier 2，走過 schema 的兩條 refine 規則。
- 兩天內容各自獨立、主題與數字皆不同，不是同一份內容改日期複製。

## 增補 fixture 時的 SOP

這是公開 repo，公司名、媒體名、證券代號都必須全部虛構，不能跟真實存在的東西撞名。

**證券代號沒有安全區段，一律以查詢結果為準。** 挑好之後跑下面那支檢查，它說乾淨才算
乾淨——不要靠「這個號碼看起來很假」或任何號碼區間的規則來判斷。

這句話是踩過才寫下來的。本檔第一版寫的是「一律挑 `00636` 以下，那段從未被指派過、
等於永久安全」。那是錯的：主動式 ETF 的 `00400A`–`00410A` 整個區塊掛牌時間比 006xx
還晚卻配在 `00636` **之下**，`00625K`、`00631L`–`00635U` 同樣在下面而且都還在交易。
錯誤來自量測時用的 regex 要求代號是「剛好三位數字後面接引號」，把所有帶字母尾碼的
代號整批排除掉了——而被排除的正好就是低位段那些。照著那條假規則挑 `00405` 會撞
`00405A`、挑 `00631` 會撞 `00631L`。

目前 fixture 用的 `00111`／`00222`／`00333` 是**查過乾淨**（2026-09-11），不是因為落在
什麼安全區段；低位段既然會開新區塊，它們哪天被指派走也不奇怪，那正是下面這支檢查
要替你盯的事。（2026-09-11 之前用的是 `00666`／`00777`／`00888`，其中 `00666` 撞到真實
存在的 `00666R 富邦恒生國企反1`。）

增補或改動任何含 ticker 的欄位（`ticker`、`affectedTickers`）之後，跑：

```bash
pnpm --filter server run fixtures:check-canary
```

這支會遞迴掃整個 `canary-example/` 目錄底下所有 JSON 的 ticker 欄位、逐一查詢
TWSE 的 `codeQuery` 端點，撞到任何真實證券就 exit 1 並印出撞到的代號與名稱。
它**刻意不進 CI**（依賴外部服務可用性），要自己記得跑。

**公司名與媒體名沒有自動檢查、也刻意不做。** controller 2026-09-11 拿 TWSE + TPEx
共 1,985 家上市櫃公司名掃過這份 fixture 全文：0 真陽性、4 假陽性，全是子字串誤中
（例如「電力成本」誤中「力成」、「出口值達新台幣」誤中「達新」）。當硬 gate 等於
第一天就要配白名單維護，不值得。這一層純靠人眼——增補公司名或媒體名時自己確認
不是真實存在的實體。

順帶一提，`codeQuery` **也對名稱做前綴比對**（實測：`台積` 回 2330 台積電、
`富邦恒生` 回三檔富邦恒生系列）。所以 `affectedTickers` 這種有時放中文字串的欄位，
順便也擋得住「真實公司名或 ETF 名寫進 ticker 欄位」。但這只涵蓋**這些欄位**，
散文內容（`contentText`、`narrative`、`summary`）不在掃描範圍內。

**覆蓋範圍的誠實話**：`fixtures:check-canary` 只查 ticker 欄位對 TWSE 的比對。
外國公司、未上市的台灣公司、外文媒體名、其他交易所的代號，以及任何寫在散文裡
（而不是 ticker 欄位裡）的真實名稱，都不在它的射程內。
