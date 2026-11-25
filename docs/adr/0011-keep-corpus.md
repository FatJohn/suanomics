---
status: accepted
date: 2026-11-25
---

# 保留 corpus 背景庫

#34 把 v0 的 corpus 背景庫接回：每日抓 `external_sources` 的文章寫進 `external_articles`，analyst 的 cascade 檢索讀回當作連動鏈的佐證。驗收要求有／無 corpus 各 5 天、用 brief-judge 比較，決定保留或移除。

做法：正式報告照常帶 corpus。每日另以 `daily:shadow` 拿同一份 `run_inputs`（editor 選稿與市場資料）關掉 cascade 檢索（tier1 與 tier2）重跑一份影子報告，兩份都用 quality judge（claude-opus-5-5）評分。兩臂只差 corpus 檢索；官方公告區塊來自存下的市場資料，兩臂相同。有效日為 2026-11-19、20、23、24、25。

| 5 日合計 | 有 corpus（正式） | 無 corpus（影子） |
|---|---|---|
| 傳導鏈完整 | 2/15 | 6/15 |
| 管道具體 | 7/15 | 7/15 |
| 無依據數字 | 5 | 2 |
| 無依據事件 | 5 | 9 |
| 套話 | 3 | 1 |
| 反證條件 | 4/5 | 4/5 |
| 內文數字對不回段落 claim（narrative-claim-binding） | 157/300 | 187/319 |
| 引用來源數 | 93 | 37 |

judge 的品質分數沒有因 corpus 變好：傳導鏈完整、無依據數字、套話三項是無 corpus 較佳（無依據數字 5 對 2，其中 4 個集中在 11/23 一天），其餘持平；5 天的樣本與 judge 本身的變異不足以下定論。corpus 逐日都穩定帶來的是來源：引用數約為 2.5 倍，無依據事件較少。內文數字對得回 claim 的比例 5 日合計也較高（48% 對 41%），但 11/24 一天是無 corpus 略好。報告的每個數字、事件與因果都要能追溯來源；corpus 在事件與引用上補得最明顯，數字一項沒有改善，取捨後決定保留。

## Consequences

- 成本：報告本身每日多約 US$0.1～0.3（檢索到的文章增加 analyst 的輸入，tier2 也只在有 corpus 時才跑）。corpus refresh 在 Daily Brief 的主排程與備援排程各跑一次，A/B 首週每日合計約 US$0.10～0.14，篇數上限留下的積壓消化完後降到約 US$0.02。
- corpus 會把不適合的文章帶進報告：2026-11-25 的報告引用了政治人物對股市的評論，來源是 corpus 檢索到的新聞，無 corpus 的影子報告沒有這段。收錄與檢索的品質另由 #111 處理。
- `daily:shadow` 與 `eval:judge --shadow` 保留，之後要量其他檢索或來源的改動時可以沿用同一套 A/B。影子報告必須與 `daily.yml` 同設定，CLI 會檢查。
- 每日報告的 `run_inputs` 繼續存，影子報告靠它重跑。
