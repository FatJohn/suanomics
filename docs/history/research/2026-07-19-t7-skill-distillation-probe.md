# T7 分析 skill repo 蒸餾 — verify-first 探針結果

> 日期：2026-07-19。backlog §T7。前置連結：https://github.com/anthropics/financial-services

## 結論（先行）

**「把 financial-services 當蒸餾素材源接進 route a 管線」＝ verify-first NO-GO**（promote 命中率 1/6、素材 macro 價值薄）。**但探針撈到一個具體可落地的 nugget＝real-rate decomposition frame、已手作 promote**（不走蒸餾搬字、改綁 FRED 美債資料）。

## 背景與路線

- user 2026-07-08 提供外部 repo 連結，預期是「總經分析素材源」。
- backlog 兩路線：**a**＝餵進 `packages/prompt-research` 既有蒸餾管線（`skill-markdown.ts` → `skill-to-digest.ts` → frame 候選 → 人工 promote）；**b**＝手工轉 `macro-frames.ts` 式 deterministic frame。硬約束：不做 runtime agentic 掛載。
- user 2026-07-19 拍板走「窄範圍路線 a cheap verify-first 探針」。

## 探索：前提被推翻

`anthropics/financial-services`（Apache-2.0、117 個 SKILL.md、366 檔）主題是**公司/證券層級分析**（DCF/LBO/comps、GL 對帳、KYC、法說會），**與本專案「總經新聞連動」重疊低**。唯一 macro 相關的是 `plugins/partner-built/lseg/skills/` 下的利率/FX/衍生品 skill（bond/swap/fx/macro-rates），且高度綁 LSEG 專屬 MCP tool。

## 探針執行（throwaway、不落 main）

對 3 篇最 macro 相關的 LSEG skill 跑**真實蒸餾管線** `distillSkillToDigest`（Gemini flash、內建投信投顧法合規 gate）：`macro-rates-monitor`、`fx-carry-trade`、`swap-curve-strategy`。共產出 6 個 analystFrame 候選。harness 用畢即刪、working tree 保持乾淨。

## 評估（fresh verifier、驗證不自驗）

逐一判 6 候選對照既有 6 個 `macro-frames.ts`：

| 候選 | 裁決 | 理由 |
|---|---|---|
| 總經指標發布衝擊（macro-rates） | 邊際 PASS | 勞動/GDP/PMI 驚奇角度 net-new，但 PMI 非 FRED 免費源、價值中等 |
| 殖利率曲線利差（macro-rates） | REJECT | 與 `yield-curve-shape` 重複；net-new 部分綁 swap（取不到） |
| 外匯套利（fx-carry） | REJECT | 全綁 forward points/implied vol/risk reversal，衍生品資料取不到 |
| 交換曲線斜率（swap-curve） | REJECT | 綁 IRS swap，取不到；概念與 yield-curve 重疊 |
| 交換利差信用流動性（swap-curve） | REJECT | swap spread = swap − govt，swap rate 取不到 |
| **名目/實質利率通膨分解（swap-curve）** | **PASS-promote** | 最強候選；real=nominal−breakeven、限制性程度、對 R-star；補皓哥 macro 具體角度缺口；可行（改綁 FRED T10YIE+DFII10+既有美債名目、非 swap） |

**verifier bottom-line**：不是乾淨 NO-GO 但接近——4/6 綁死取不到資料或重複、僅 1 個真 feasible+net-new（+1 邊際），且連它都需改寫（swap→美債）才能用。蒸餾管線本身機制健全（news-frame 導向、剝掉 tool plumbing、合規 gate 詞彙層有效），是**素材 macro 價值薄**。

**verifier 關鍵警告**：real-rate frame 可用的前提是「把 swap 載體改綁美債+FRED」；若逐字搬入蒸餾產物，questions 會指向取不到的 swap 曲線、讓 analyst 對台灣新聞硬套→產無資料支撐的空泛拆解（正是皓哥詬病的表面複述）。

## 落地（手作、非蒸餾搬字）

- **加 2 FRED 序列**（`series-config.ts`）：`us-10y-real-rate`（DFII10）、`us-10y-breakeven`（T10YIE）。FRED API 實測存在且新鮮（T10YIE 2026-07-17=2.24%、DFII10 2026-07-16=2.35%；real+breakeven≈4.59 ≈ 既有名目 10Y 4.58%、分解自洽）。
- **加 1 手寫 frame**（`macro-frames.ts`）`real-rate-decomposition`：綁美債名目/實質/breakeven、3 條深度問題（名目變動來源分解、實質利率限制性、通膨預期錨定度）。
- 測試：series-config 24 序列 + macro-frames guard（snapshotRefs ⊆ SERIES_SPECS、無禁詞）；861 綠、type-check clean。

## Scope / 未做（誠實留痕）

- **不接 financial-services 進蒸餾管線**（route a NO-GO）；`default-sources.ts` 未加該 source。
- 邊際的「總經數據驚奇」frame 未做（PMI 免費源另議、價值邊際）。
- swap/vol/carry 類 frame 全棄（資料取不到、非本產品場景）。
- real-rate frame 的資料要等 prod refresh 才有值（新 FRED 序列進 refresh loop、比照 T5）。

## 教訓

- **蒸餾管線 ≠ 素材價值**：route a 機制健全、但外部 repo 若主題不對（公司/證券 vs 總經），distill 出來多是取不到資料或重複的 frame。verify-first 探針（真跑蒸餾 + fresh verifier 評估產出）以極低成本問出「值不值得接」。
- **蒸餾產物不可逐字搬**：LLM 蒸餾會忠實保留原文的資料載體（swap 曲線），落地前必須人工把資料綁定改成本專案取得到的源，否則 frame 看似豐富、實則 analyst 無資料可依、退化成表面複述。
