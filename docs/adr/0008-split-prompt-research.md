---
status: accepted
date: 2026-11-07
---

# Prompt 研究工具拆成獨立 repo，介面是檔案

`packages/prompt-research` 從 YouTube／podcast 逐字稿、skill markdown 等素材蒸餾分析框架，編成各 agent 的 prompt 候選。它對每日報告沒有貢獻（v0 文件記載接進日常流程的評估結果是 NO-GO，只人工 promote 過一個框架），卻在 repo 內製造反向耦合：compiler 寫死 decomposer／analyst／synthesizer 的檔名與 schema，`podcast-writer.prompt.ts` 反過來 import 它的 `GARNISH_DENYLIST`。決定拆成獨立 repo `baguanomics`（八卦 + nomics：既是卦象的來源，台灣口語又是「聽人說什麼」），兩個 repo 零 package 依賴。

## Consequences

- 介面是檔案：`suanomics` 在自己 repo 放各 agent 的「目標 prompt 規格」（現行 prompt 全文、輸出 schema、領域約束如投顧法禁語），`baguanomics` 吃素材清單與規格檔，輸出 candidate prompt 與 diff。
- 蒸餾層（sources、distillers、merger）直接搬；compiler 改成讀規格檔；`FORBIDDEN_PHRASES`、`GARNISH_DENYLIST` 變成規格檔內容。
- `apps/server/src/transcript/youtube.ts` 與 package 內的 transcript fetcher 是部分重複，合併成一份、歸 `baguanomics`。
- 時機：`suanomics` v1 驗收後、phase 2 之前，先做「原樣搬出去能跑」，不做功能改良。
