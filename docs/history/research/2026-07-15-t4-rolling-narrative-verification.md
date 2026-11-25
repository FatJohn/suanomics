# T4 Rolling-Narrative 驗收 + 策略決策報告

> 日期：2026-07-15。對應 backlog §T4（rolling-narrative 三部曲成效驗收、ops task）。
> 設計 spec：[docs/superpowers/specs/2026-07-15-t4-rolling-narrative-verification-design.md](../superpowers/specs/2026-07-15-t4-rolling-narrative-verification-design.md)。
> 純 ops/分析、零 repo code。

## 結論摘要（TL;DR）

| # | 子量測 | 結論 | 一句話 |
|---|--------|------|--------|
| ② | SP-A valence 健康（PASS/FAIL） | **PASS** | prod storylines valence 混合（support 10 / challenge 3 / extend 1）、同日重複 0、note 皆 delta |
| ① | SP-B → podcast-mirror go/no-go | **NO-GO（defer）** | narrative 已可靠做跨日 delta；podcast 有輕量 R3 連續性但無跨日 delta framing、差距對輔助產品聽眾低感、升級成本低、想做再開 |
| ③ | 具體度缺口 → retrieval spike go/no-go | **NO-GO** | T1 已把讀者面 narrative 具名數字從 ~0 拉到 14；殘留模糊處零星且不可靠撈、不達高門檻 |

**附帶發現（非 T4 範圍、列維運注意）**：prod daily pipeline 自 **2026-07-08** 起無新 brief（今 07-15、約一週斷產）；prod 僅 12 個 brief 日期、且 06-30~07-07 亦無產出。這限制了 ③ 的 post-T1/T5 樣本量（見下）。

## 方法論前提（verify-first 修正 backlog）

backlog §T4 原寫「`brief:continuity` 量 SP-B before(06-22 前) vs after 跨日對打」，與 T8 剛落地的 `docs/operations/judge-discipline.md` 衝突——該 SOP 明訂「pairwise 只在同輸入兩版本間有效、不可拿不同天的 brief 對打（新聞量不同會污染 depth/grounding）」。故本報告改用：SP-B 走同日兩版本機制（已由 fixture PR #112 證）+ 真 prod 質性讀；具體度缺口走質性讀（pairwise + grounding vagueness bias 測不準絕對具體度、且 retrieval 版本尚不存在無第二版）。不產 trend row。詳見 spec §1。

## 資料集

- **Briefs**：prod API `GET /api/brief/by-date/:date` 撈 7 份（06-21 / 06-22 / 06-26 / 06-27 / 06-28 / 06-29 / 07-08）。`GET /api/brief/dates` 顯示 prod 僅 12 個日期、最近 = 2026-07-08。
- **Storylines**：prod postgres。**Zeabur `service exec` 對 postgres 容器跑 psql 一致回 524（Cloudflare gateway timeout、env 探測可通故 gateway 本身正常、疑 psql 連線 hang）**；改走 api 容器（node v22、有 prod `DATABASE_URL` + postgres.js）以 node 腳本查詢成功。ops 教訓見末節。

---

## ② SP-A valence 健康 — PASS

SP-A spec §7 ops 驗收（`docs/superpowers/specs/2026-06-23-rolling-narrative-sp-a-storyline-quality-design.md`）。prod storylines 查詢結果（窗 2026-06-27 → 07-08、9 條 storyline 皆 open、14 筆 updates）：

| §7 條件 | 結果 | 判定 |
|---------|------|------|
| valence 分布混合（非塌單一值） | support **10** / challenge **3** / extend **1**（三值皆現） | **PASS** |
| 無同日重複（每 storyline,briefDate ≤1 筆） | sameDayDupCount = **0** | **PASS** |
| note 是 delta（非流水帳） | 每筆 note 皆當日具體發展、非 thesis 複述 | **PASS** |

**最強證據 = storyline #3「中東地緣溢價消退與原油供需重估」的弧內 valence 變化**：06-27 `challenge`（美軍襲擊挑戰消退假說）→ 06-28 `extend`（停火協定壓金價但船隻遇襲油價持穩）→ 06-29 `challenge`（船隻再遇襲）→ 07-08 `challenge`（撤銷伊朗售油授權油價跳升）。同一條線隨事件演化給出不同 valence，正是 SP-A 判別邏輯 work 的關鍵訊號（非 98% 單一值）。

**note delta 抽樣**（storyline #1「AI通膨與科技供應鏈估值修正潮」4 筆 support 皆為不同日的具體進展）：
- 06-27「費半及台股恐慌暴跌 + 00929 剔除台積電/聯發科」
- 06-28「費半暴跌逾5% 引導台股重挫 1683 點」
- 06-29「費半大跌+外資提款+IMF 警告 AI 財富效應」
- 07-08「費半重挫近5%+台積電 ADR 跌逾4%+中國低價 AI 模型市佔上升」

**次要觀察（非失敗）**：9 條 storyline 中 4 條（#5/#6/#8/#9）在此窗 0 updates（建立為 theme 但未累積 dated update）。不影響 valence 健康、但屬 SP-A 資料的輕微「空殼線」現象、可未來留意（非本輪處理）。resolve 未在此短窗 fire（9 條皆 open）——符合 §7「resolve 短窗不保證、主靠單元測試證機制」。

---

## ① SP-B → podcast-mirror go/no-go — NO-GO（defer）

### 現況（verify-first、code-fact）
- **narrative-writer**（`apps/server/src/agents/narrative-writer.prompt.ts` §跨日連續性）：完整 SP-B——「只在真有延續回顧、講 delta（相較昨日新增/改變）、誠實鐵律禁硬連、最多兩條」。含完整弧（前日 note / arcDays）的 storylineBlock 在 brief-worker 建、經 orchestrator 轉發給 narrative-writer（`storyline-block.ts` 的 `entriesFromEditorResult`→`makeEntry` 帶 priorNote/priorDate/arcDays）。
- **podcast-writer**（`apps/server/src/agents/podcast-writer.ts:238-241`）：**已接** storylineBlock（R3、prompt「敘事線參考、可自然回顧這些追蹤線的進展與先前論點」），但**較輕**——資料由 `getStorylinesTouchedOn(date)` 建、只含當日 touch（無前日 updates 脈絡）；prompt 無 narrative 那套 delta/誠實鐵律。

→ 「podcast mirror」**不是從零接線、而是「要不要把 podcast 升級到 narrative 的 SP-B richness（前日脈絡 + delta/誠實指令）」**。

### prod 實證（讀 06-29 + 07-08 全文）
- **narrative 可靠做跨日 delta**：06-29「接回『AI通膨…』主線、先前…今日進展則多重驗證」、「接回『中東地緣…』主線、先前…今日進展直接挑戰…證偽」；07-08「相較於先前…今日進展進一步印證」。
- **podcast 無跨日 delta framing**：用 storyline 分 act（同結構、R3）但 prose 是同日主題解說（賽博半仙口吻「我們先聊聊」「接下來最有意思的是」）；06-29 podcast 完全無跨日 delta 語言；07-08 podcast 的「昨日」多為時間框架、非 storyline delta。

### 判準套用
podcast 連續性確實弱於 narrative（無「相較先前→今日進展」delta）。但：
1. podcast 是**輔助產品**、格式是 persona 每日解說（賣點是聲音 + 連動解說、非多日連載）。
2. podcast 已長（2000–2800 字、撞 schema 下限、見 memory `project_podcast_scripted_speech`）、加跨日 delta 有 bloat + 與 casual persona 衝突風險。
3. 升級成本低（podcast prompt 加 carry-forward 指令 + 餵前日脈絡 storylineBlock）——**想做隨時可做**。

→ **NO-GO（defer）**：narrative 已扛連續性 moat；podcast 弱點對聽眾低感、ROI 低。**觸發條件**：日後 podcast 升為主力 surface、或聽眾回饋想要弧、再開（低成本）。

---

## ③ 具體度缺口 → retrieval spike go/no-go — NO-GO

### 具名數字統計（regex 掃 %/點/億/兆/元/美元 等）
| 日期 | narrative #num | podcast #num | 註 |
|------|:---:|:---:|----|
| 06-21 | 0 | 3 | pre-T1 |
| 06-22 | 1 | 1 | pre-T1 |
| 06-26 | 0 | 5 | pre-T1 |
| 06-27 | 2 | 3 | pre-T1 |
| 06-28 | 0 | 2 | pre-T1 |
| 06-29 | 0 | 5 | pre-T1 |
| **07-08** | **14** | **10** | **post-T1（#122 merged 07-07）** |

→ narrative 具名數字 pre-T1 幾乎 **0**（0/1/0/2/0/0）、post-T1 跳到 **14**。**T1 接線顯著生效**（呼應 T1 動機「06-29 prod narrative 具名數字 0 個」）。

### 07-08 narrative 具名數字（全部有源）
台股重挫 1,077 點 / 跌幅 2.31% / 收 45,479 點、三大法人淨賣超 938 億元、費半 -4.65% / 台積電 ADR -4.25%、OpenRouter 中國 AI 模型流量占比 >30%、早盤反彈逾 350 點、融資餘額 +390 億元 / +6.83% / 至 6,109 億元、美債 10Y 4.48% / 2Y 4.13% / 利差 0.35%、WTI 70.44 美元。來源＝market snapshot（T3/T5 序列）+ 新聞內文。

### 缺數字/模糊處的可撈性（高門檻檢查）
| 模糊處 | 可撈性 |
|--------|--------|
| 南韓兩倍槓桿 ETF「每日再平衡強制賣出」的資金流規模 | **低**：南韓特定 ETF 資金流、無現成 FRED/TWSE/TAIFEX 序列、obscure |
| 中國低價 AI 模型「API 價格優勢」的具體價格 | **低**：非結構化、無穩定可查源 |
| 三大法人 / 融資 / 殖利率等 | 已由 snapshot 補齊（非缺口） |

### 判準套用（高門檻＝反覆 + 具體 + 可撈才 GO）
具體度缺口已被 T1（接 marketSnapshot）大幅補齊；殘留模糊處零星、且不屬「反覆 + 具體 + 可從現成來源撈到」的類別。**高門檻不滿足 → NO-GO retrieval spike。**

### 樣本限制（誠實標註）
- post-T1 僅 **07-08 一份**（prod 一週無新 brief）；但 pre-T1 六份一致 ~0、對比 robust、0→14 的訊號不因單樣本而動搖。
- **confound 誠實標註**：07-08 是台股崩跌千點的異常高數字日、number density 天然偏高、故 0→14 的**量級**部分受市場波動 confound（平常日未必到 14）。但 ③ 的 NO-GO 主要立在「殘留缺口不可撈」而非 T1 的因果量級、故此 confound 對結論影響低。
- **post-T5 brief = 0 份**（TAIFEX/SBL/融券 07-09~13 merged、之後 prod 無任何產出）。故 T5 新序列對讀者面具體度的增量**尚無 prod 樣本可觀察**。
- **觸發條件（未來重評）**：prod 恢復每日產出、累積數份 post-T1/T5 brief 後，可用同法（具名數字統計 + 缺口可撈性）再確認一次；若屆時仍見反覆可撈缺口再開 retrieval spike。

---

## 附帶發現與後續

1. **prod daily pipeline 自 2026-07-08 斷產**（今 07-15）。近期 T5–T10 開發多走本機 regen（見 memory），prod 每日產出可能被暫停。**建議**：確認 prod cron/pipeline 是否需恢復（關聯 backlog「輕量監控：今日 brief 已產 signal」維運小項）。這也是 ③ 未來重評的前置。
2. **Zeabur exec ops 教訓**：`service exec` 對 **postgres 容器** 跑 psql 一致 524（gateway timeout）；改走 **api 容器 node + postgres.js**（`require('/src/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres')`、DATABASE_URL、base64 傳腳本避開多層引號）成功。下次查 prod DB 直接走這條。
3. **SP-A 空殼線**：4/9 storyline 在窗內 0 updates（建立為 theme 未累積 update）——輕微資料衛生議題、未來可評估清理或收斂 storyline 建立門檻。

## 本 task 驗收對照（spec §7）

1. ✅ 3 子量測皆有明確結論 + 支撐數據（storyline 查詢輸出、具名數字統計表、carry-forward 對照）。
2. ✅ 兩 go/no-go 對應 spec §3 判準、推理可追。
3. （待）backlog §T4 標完成 + 結論寫回（本報告產出後隨即更新）。
4. ✅ 數據可回溯（brief 日期經 prod API、storyline 數字經 prod DB node 查詢實跑輸出）。
