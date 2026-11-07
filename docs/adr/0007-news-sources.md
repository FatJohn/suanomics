---
status: accepted
date: 2026-11-07
---

# 新聞來源只用 feed 與自抽正文、不買新聞 API

2026-11-07 查核：免費層的新聞 API（GNews、NewsAPI、NewsData、Marketaux、Finnhub）都不給正文，NewsAPI 與 GNews 明文禁止 production 使用；有正文的付費方案最低 €49.99/月且以英文為主、台灣覆蓋差；台灣媒體沒有公開 API 可買。決定不買新聞 API：新聞來源只收官方機構與發行商自己發布的 RSS，沒有 RSS 的台灣媒體經 RSSHub 產生 feed，正文在 pipeline 內用 Readability 類函式庫抽取，抽不到才落到 Firecrawl 免費層；Google News 轉址型來源（只有標題、連結指向 Google 轉址頁）移除。

## Considered Options

- **付費新聞 API**：預算內沒有一個同時有正文與台灣內容。
- **搜尋型服務**（Tavily、Exa、Brave）：按次計費、每月免費額度一千次上下，適合當正文備援不適合當主要發現管道。
- **feed 加自抽正文**（採用）：零費用、來源可逐一對照條款。

## Consequences

- 各來源的 feed URL、條款連結、允許用法逐條記在 `docs/sources.md`；中央社條款限個人非商用且禁轉載全文，鉅亨網禁未授權重製，這類來源只在內部分析使用，網站上只引用標題、連結與自己寫的連動分析。
- 新聞分六類（總經、地緣、產業、能源、天災公衛、其他），來源要跨類：官方機構新聞稿（含總統府、外交部、美國國務院）、國際通訊社只取標題與連結、TechNews 補科技產業。
- 結構化來源以 TWSE OpenAPI 為主；v1 加公開資訊觀測站重大訊息與台美經濟日曆。
- RSSHub 已由 spike #18 實測（2026-11-07，[結果](../spikes/18-rsshub.md)）：v1 不用 RSSHub。原本預期要靠它的三家媒體裡，鉅亨網與經濟日報有自己的公開 RSS，工商時報 RSSHub 沒有 route、站方也沒有公開 feed。公開 instance `rsshub.app` 每次都回 403，站方公告只供測試、不供 production 使用。日後出現只能靠 RSSHub 的來源時，在 Actions job 內自架：image 釘 digest，pull 加啟動約 10 秒，記憶體峰值約 276 MiB；冷快取時每個 route 會對來源站扇出多個請求，pipeline 端要另訂上限。
- v1 不用聯合報系（經濟日報、聯合新聞網）：其著作權聲明禁止未經事前書面同意以報系內容開發任何軟體或程式，包括 LLM、機器學習或 AI，robots.txt 也寫明不允許 LLM／AI 用途，而 pipeline 會把標題送進 LLM。取得書面同意後再評估加回。工商時報同樣不用：查不到條款頁，robots.txt 封鎖具名 AI crawler，也沒有公開 feed。
- NHK World 未決：spike #16 沒找到官方英文新聞 RSS，只找到 podcast RSS 與未公開文件化的站內 JSON（`all.json`，Actions 實測可達）。改讀 JSON、改走 RSSHub、或只留 BBC 與 Al Jazeera，三者擇一，由 ingest issue（#24）定案；若選讀 JSON，要連帶修改本 ADR「只收 RSS」的決策文字。
