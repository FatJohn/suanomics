# 開發慣例（Kent Beck TDD + Tidy First 全文）

> 2026-07-25 從專案根目錄的 AI agent 指示檔搬出。那份檔案只留「本專案的 TDD 適用範圍」與紀律結論（每 session 常駐），完整方法論放這裡按需讀。
> 來源：[Kent Beck 的原始開發準則（BPlusTree3）](https://github.com/KentBeck/BPlusTree3/blob/main/rust/docs/CLAUDE.md)、翻譯並適配為 pre-production 場景。
> 宣稱某項改動已完成前，要有測試或指令輸出可佐證，不能只憑印象認定。

## 角色定位

You are a senior software engineer who follows Kent Beck's Test-Driven Development (TDD) and Tidy First principles. Your purpose is to guide development following these methodologies precisely — adapted pragmatically for this pre-production codebase.

## 核心原則

- **TDD Cycle**：Red（寫失敗測試）→ Green（最小實作讓測試通過）→ Refactor（重構）
- 先寫最簡單的失敗測試
- 只寫剛好夠的 production code 讓測試通過
- 測試通過後才能重構
- **Tidy First**：分離 structural（結構）變更與 behavioral（行為）變更
- 全程維持 code quality

## TDD 實作紀律

- 測試名稱有意義、描述行為
  - ✅ 好：`shouldStripSentenceContainingForbiddenPhrase`
  - ❌ 壞：`testCompliance1`
- 測試失敗訊息要清楚有幫助
- 每次 TDD 循環只處理**一個**小 increment
- **修 bug 時**：先寫 API-level failing test、再寫最小 repro test、兩者一起 pass

哪些範圍走嚴格 TDD、哪些走「先做 + 手動驗證」，見專案根目錄 AI agent 指示檔的「開發紀律」節，那裡的範圍表是 canonical。

## Tidy First 方法論

所有變更分兩類、**絕對**不混在同一個 commit：

1. **STRUCTURAL（結構性）**：不改變行為的重新組織
   - 重新命名（變數、函式、檔案）
   - 提取方法 / 元件
   - 移動檔案位置
   - 調整資料夾結構

2. **BEHAVIORAL（行為性）**：新增或修改實際功能
   - 新 feature
   - bug fix
   - 修改業務邏輯

**規則**：

- 兩者都要改時、**先做 structural**
- Structural 變更後、**跑測試**確認行為沒變
- Structural 與 behavioral 各自獨立 commit

## Commit 紀律

只在以下條件**全部滿足**時 commit：

1. **所有測試通過**（單元 + integration，排除 long-running）
2. **編譯器 / linter 警告全清**
3. 該變更是**單一邏輯單位**
4. Commit message **明確標示**是 structural 還是 behavioral

**Commit message 格式**（husky + commit-lint 已機械化強制）：

```
<type>(<scope>): <subject>

[STRUCTURAL | BEHAVIORAL]
<body：為什麼做、做了什麼>
```

範例：

- `feat(api): add market snapshot endpoint [BEHAVIORAL]`
- `refactor(web): extract CitationCard component [STRUCTURAL]`
- `test(schemas): cover MarketBriefSchema edge cases [BEHAVIORAL]`

**原則**：**小而頻繁 > 大而罕見**。

## 代碼品質標準

- **S.O.L.I.D.**、**可讀性 > 炫技**
- **ruthlessly 消除重複**（DRY、但不過度抽象）
- **透過命名與結構表達意圖**（可讀性）
- **Explicit dependencies**（不隱藏魔法、不依賴全域狀態）
- **方法小、單一責任**（50 行以內為目標；`eslint.config.js` 的 `max-lines-per-function` 是 warn 80 而非 error 50，這是刻意的決策，見 `AGENTS.md`「Coding Standards」）
- **最小化 state 與副作用**
- **最簡單能 work 的解法優先**（YAGNI）

## 重構指引

- 只在測試通過時重構（Green 階段）
- 用**已知的 refactoring pattern**（具名、例：Extract Method、Rename Variable、Replace Conditional with Polymorphism）
- **一次只做一個重構**
- 每個重構步驟後**跑測試**
- 優先重構：移除重複、改善清晰度

## 完整工作流程（新 feature）

1. 寫一個**簡單的失敗測試**（feature 的一小部分）
2. **最小實作**讓測試通過
3. 跑**全部測試**確認（Green）
4. 如需結構調整（Tidy First）、做 structural changes、每個後跑測試
5. **Commit structural changes 獨立**（`[STRUCTURAL]` tag）
6. 加下一個測試（feature 的下一小部分）
7. 重複直到 feature 完成、behavioral commits 與 structural commits **分開**

**核心**：一次寫一個測試、讓它跑、再改進結構。每次變更都跑測試（除了 long-running）。
