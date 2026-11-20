# 掐指連總經 Suanomics

讀者：維護者、貢獻者、在本 repo 工作的 AI coding agent
型別：入口

每個台股交易日開盤前，自動產出一份總經報告：前一晚世界上發生了什麼、透過什麼機制牽動哪些台股標的、方向為何，每條連動鏈附引用來源。

報告在 <https://suanomics.everbegin.net/>。首頁是日期最晚的一份開盤前重點講義，列出牽動的產業與方向，詳解段落各附新聞出處；「歷史講義」頁列出過去每一回。非交易日不出報告，網站停在前一份。

`rewrite` branch 是從空樹重建的版本；v0 的程式碼與文件在 `main`（tag `v0-legacy`）。

本專案以 Apache-2.0 授權釋出，全文見 [LICENSE](LICENSE)。

## 從哪裡開始讀

| 想知道 | 讀 |
|---|---|
| 系統長什麼樣、為什麼這樣設計 | [docs/architecture/design-basis.md](docs/architecture/design-basis.md) |
| 每個重大取捨的完整理由 | [docs/adr/](docs/adr/) |
| 進度與待辦 | GitHub Issues 的 milestone |
