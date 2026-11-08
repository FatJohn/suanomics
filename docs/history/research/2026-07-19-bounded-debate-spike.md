# Bounded Debate（有界辯論層）— Spike 結果與 go/no-go

> 日期：2026-07-19。設計 spec：[2026-07-19-bounded-debate-spike-design.md](../superpowers/specs/2026-07-19-bounded-debate-spike-design.md)。
> 對應 backlog §更遠「bounded debate」+ long-term-roadmap §遠期觸發（line 48）。

## 結論（先行）

**NO-GO（就 spike 的確切設計＝always-on + 內化）；但機制已驗證、留一條有條件 GO / 重設計的路徑——最終策略方向交 user 拍板。**

- **辯論真的改善平衡、且不是 mush**：bull/bear/reconcile 產出的反方論點是**真實、具名、grounded 在當日素材**的反論（非空話對沖）。平衡度 pairwise lens：treatment 勝 6 / baseline 勝 1 / 相當 2（9 維度樣本）。fresh verifier 獨立確認非 mush。
- **但命中 spec §6 自訂的 NO-GO 護欄**：treatment 的**可讀性三個交易日全數回退**、**深度在 07-16 也回退**。§6 明列「深度或可讀回退」為 NO-GO 觸發——直球判定即 NO-GO。
- **價值是條件性的**（強確認假設）：baseline 本來單向背書時（07-08、07-15）辯論大勝；baseline 本來就平衡時（07-16）辯論邊際遞減、甚至讓可讀/深度變差、無平衡回報。
- **無編造、無合規硬違規**：verifier 旗標的可疑數字（ASML 43%、金控 4408.75 億）經查**全部在當日 source news 內**、非幻覺（呼應 memory `project_cascade_factual_grounding_verified`）。三份 treatment + 三份 debate 皆無 `FORBIDDEN_PHRASES`、無 ticker-direction 命中。

## 量測數據

### 平衡度 lens（主尺、雙向 pairwise、A=baseline / B=treatment；B 勝=辯論版更平衡）

| 日期 | counterArgs | twoSided | thesisEngages |
|---|---|---|---|
| 2026-07-08 | B | B | B |
| 2026-07-15 | B | B | B |
| 2026-07-16 | 相當 | **A** | 相當 |

聚合：treatment 勝 6 / baseline 勝 1 / 相當 2。

### 深度/可讀 回歸護欄（A 勝=treatment 回退、須警示）

| 日期 | depth | readability | grounding |
|---|---|---|---|
| 2026-07-08 | B | **A** | 相當 |
| 2026-07-15 | 相當 | **A** | B |
| 2026-07-16 | **A** | **A** | 相當 |

**可讀性：baseline 三天全勝**（treatment 一致較難讀）。深度：07-16 回退。→ **§6 NO-GO 觸發成立。**

### 成本
全程 $0.645（3 天 × [thesis derive + baseline narrative(pro) + bull‖bear + reconcile + treatment narrative(pro) + balance judge×2 + quality judge×2]）。辯論本身增量 ≈ 3 flash 呼叫/brief（約 +$0.05~0.06/brief）、可接受。

## 質性判讀（fresh verifier，驗證不自驗）

verifier（fresh context、找碴不背書）逐條結論：

1. **真平衡 vs mush＝PASS**（07-16 部分）：treatment 多出的反論真實具名——07-08「融資餘額逆勢增 390 億→未實質去槓桿」直接反打 thesis 前提；07-15「ASML 50 倍前瞻本益比＋DUV 管制」。07-16 baseline 已自帶具名兩面（禾伸堂/台燿違約交割），treatment 增益小。
2. **trace 品質＝PASS**（有瑕疵）：bear 多為真破口非泛喊風險；reconcile 三日兩面兼顧。瑕疵：07-15 debate bear#4 尾部亂碼「景色與估值上限。」＝trace 品管漏洞。
3. **可讀代價性質＝部分**：07-08/07-15 的密度多來自真反論（可辯護）；但 07-16 把 baseline 具名數字換成 hedge prose、深度同時退＝該日純屬非實質對沖填充、不划算。
4. **合規＝部分**：gate 全過、assessment 皆帶免責；但 07-08 **treatment outro 掉了 baseline 本有的免責句**（narrative 層 disclaimer 非決定性、checkCompliance 不攔；`brief.disclaimer` 欄位另存、不受影響）。
5. **條件性＝PASS（強確認）**：baseline 單向時辯論價值大、baseline 已平衡時價值小、07-16 為後者。

verifier bottom-line：**傾向 NO-GO（至多有條件 GO）**。要救成有條件 GO 的前置：① 只在 baseline thesis 單向時才注入辯論（gate）；② prompt 強制保留 disclaimer；③ 收斂 hedge 填充、守住可讀/深度護欄；④ 修 trace 亂碼。

## 判讀：為什麼是 NO-GO、又為什麼不是「直接砍」

- **核心假設（辯論→更平衡、非 mush）成立**——這在窄義上是正向結果、不是失敗的實驗。
- **但當前設計（always-on + 內化）用可讀/深度換平衡、且無條件**——而深度與可讀正是本產品的**既有強項**（memory `project_brief_depth_axis_verify_first`：深度是強項）。無條件拿強項換一個「只在 2/3 天有回報」的平衡增量、不划算。這正是 §6 護欄要擋的。
- **內化（讓同一篇 narrative 更平衡）本身可能是錯的 delivery**：把兩面性塞進主敘事必然增密、傷可讀。spike 反而點出——**當初 deferred 的「顯性正反觀點區塊」設計，可能才是對的載體**：把平衡價值放進獨立區塊、不動主 narrative 的可讀性。

## 三條路（策略層、交 user 拍板）

1. **砍掉這個賭注**：平衡增量不值可讀/深度代價 + 複雜度；記入 verify-first 否決史。
2. **有條件 GO（gated 內化）**：只在「baseline 單向背書」時才注入辯論 + 守住護欄 + 修 disclaimer/trace。**代價**：需另建「單向性偵測器」gate（本身是新分類問題）、複雜度高、且內化天生傷可讀。
3. **重設計為顯性區塊**（原 deferred 選項）：把已驗證的平衡價值放進獨立「正反觀點」區塊、不污染主 narrative 可讀性。需另一輪 brainstorm（UI/schema/compliance framing）。

**本報告作者建議**：不走 (2)（gated 內化 ROI 低、複雜度高、內化本質傷可讀）。在 (1) 砍掉 與 (3) 重設計為顯性區塊 之間二選一——(3) 保留了「辯論價值真實」這個已驗證資產、且避開可讀回退，是把 spike 正向發現接下去的較佳路徑；但它是**擴 scope 的產品決策**、須 user 拍板才開。

## 方法與限制（誠實留痕）

- **乾淨 A/B、真 prod 素材**：3 份 post-T6 prod brief（07-08/15/16）經 prod API 拉、重建 narrative-writer 輸入；同一份素材 narrative-writer 跑兩次、唯一變數＝debate block。歸因乾淨。
- **重建限制**：stored brief 無 `dailyThesis`（worker-local 未持久化）→ 由 headline+summary+cascades derive（兩臂共用同一 thesis）；`analystOutputs` 由 cascadeChains 依 citation URL 重建（只作 prompt 素材、不入 schema）；`marketSnapshot` 未接（兩臂皆 null、隔離不受影響、但兩臂都少了市場數字脈絡）。
- **narrative-writer 兩臂皆跑 production 預設 model（gemini-3.1-pro-preview）**、辯論 agent 走 flash（隔離「辯論結構」單一變數、非模型升級）。
- **N=3、小樣本**：pairwise 雙向已控位置偏誤，但 3 天不是統計檢定、是 go/no-go 級的訊號讀取。
- **spike code 為 throwaway**：`bounded-debate-{lib,ab,preflight}.ts`（`apps/server/src/scripts/`）+ 對 `narrative-writer.ts` 的一個 **inert `debateBlock` 參數**（未傳時 byte-identical、production caller 不受影響、僅存 spike 分支 `feat/bounded-debate-spike`、**不 merge 進 main**）。此為忠實 A/B 的最小必要注入點、屬設計 spec §8 的一個 branch-only 例外（見下方 spec 修訂）。
- 產出檔（narrative/debate/summary）在 `apps/server/.eval-out/bounded-debate/`（gitignore、不入 repo）。
