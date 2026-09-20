# apps/server/src/prompts

每個 LLM agent 送給模型的文字集中放在這個目錄，與 `apps/server/src/agents/` 底下的 agent runner 邏輯分開。
分兩種檔：

- `*.prompt.ts`：system prompt（與少數配套的 schema／輔助函式）。
- `*.user-content.ts`：每次呼叫組給模型的 user content 文字——段落標題、指示句、重試時的 feedback，
  以及語言相關的後處理資料（例如合規改寫詞對表）。runner 只保留排序、截斷、分支與組裝順序，
  字面值一律引用這裡的常數。

## 對照表

| Prompt 檔 | 對應 Agent（`apps/server/src/agents/`） | Export |
|---|---|---|
| `analyst-tier1.prompt.ts` | `analyst-tier1.ts` | `ANALYST_TIER1_SYSTEM_PROMPT` |
| `analyst-tier2.prompt.ts` | `analyst-tier2.ts` | `ANALYST_TIER2_SYSTEM_PROMPT` |
| `chain-grouper.prompt.ts` | `chain-grouper.ts` | `CHAIN_GROUPER_SYSTEM_PROMPT` |
| `decomposer.prompt.ts` | `decomposer.ts` | `DECOMPOSER_SYSTEM_PROMPT` |
| `editor.prompt.ts` | `editor.ts` | `EDITOR_SYSTEM_PROMPT` |
| `narrative-writer.prompt.ts` | `narrative-writer.ts` | `NARRATIVE_WRITER_SYSTEM_PROMPT`、`NARRATIVE_WRITER_WEEKEND_SYSTEM_PROMPT`、`NARRATIVE_CLAIM_LEDGER_INSTRUCTION`、`NARRATIVE_GEMINI_SCHEMA` |
| `news-categorizer.prompt.ts` | `news-categorizer.ts` | `NEWS_CATEGORIZER_SYSTEM_PROMPT` |
| `news-tagger.prompt.ts` | `news-tagger.ts` | `NEWS_TAGGER_SYSTEM_PROMPT` |
| `podcast-writer.prompt.ts` | `podcast-writer.ts` | `PODCAST_WRITER_SYSTEM_PROMPT` |
| `synthesizer.prompt.ts` | `synthesizer.ts` | `SYNTHESIZER_SYSTEM_PROMPT` |
| `viewpoints-debate.prompt.ts` | `viewpoints-debate.ts` | `SUPPORT_PROMPT`、`RISK_PROMPT`、`NET_READ_PROMPT`、`buildDebateMaterial()`、`POINTS_GEMINI_SCHEMA`、`NET_READ_GEMINI_SCHEMA` |

`macro-frames.ts` 也在這個目錄：它是手寫的總經數據解讀框架，由 `analyst-tier1.prompt.ts` 用
`renderMacroFramesSection()` 接在 system prompt 尾端，換場景時要一起換。

`apps/server/tools/eval/*.prompt.ts`（`continuity-judge.prompt.ts`、`quality-judge.prompt.ts`）不在這裡：
那是評測用的 judge prompt、屬於量測工具，不是 production pipeline 的一部分。

## 換語言／市場

要把這套 pipeline 換去別的語言或市場，**要整份替換的就是這個目錄**：每支 `*.prompt.ts` 都是繁體中文、
針對台灣總經與台股場景寫死的 system prompt（外加 `macro-frames.ts`）。換的時候保持既有的 export 名稱與
函式簽章不變，import 它們的 agent runner 就不必為了「接得上」而改。

`*.user-content.ts` 同理：每個檔 export 一個 `<NAME>_USER_TEXT` 物件（靜態字串，以及只收 primitive 或 primitive 陣列參數的
小函式），換語言時保持屬性名稱與函式簽章不變即可。對應關係是一個 runner 一個檔
（`agents/<name>.ts` ↔ `prompts/<name>.user-content.ts`），這些檔不 import `agents/` 的任何東西。

刻意**沒有**搬進來的：模板裡不含中文的英文欄位標籤（`Title:`、`Primary impact:`、`- industry:` 這類），
它們對應的是輸出 schema 的欄位名，換語言時不需要動；以及給維運者看的 log 與錯誤訊息。

## 已知限制（不是只有 prompt 是台灣特化）

以下這些地方也是繁中／台灣特化，不在本目錄範圍內，換語言／市場時仍要另外處理：

- **`agents/` 以外、同樣會進到模型輸入的中文區塊**：`apps/server/src/market-data/snapshot.ts`（市場數據快照）、
  `apps/server/src/market-data/calendar.ts`（行事曆區塊）、`apps/server/src/brief/official-announcements.ts`
  （官方公告區塊）產生的標題與說明文字寫在各自的資料格式化程式裡，沒有抽到這個目錄。
- `packages/db/src/news-categories.ts` 的 `ITEM_CATEGORY_LABEL`（新聞類別的中文標籤）會出現在 editor 的輸入裡；
  它同時被資料層與前端共用，所以留在 `packages/db`。
- `packages/shared/src/compliance.ts` 的 `FORBIDDEN_PHRASES`（投信投顧法禁用語，例如「建議買」
  「建議賣」）是中文字串，硬式攔截在合規檢查裡。
- `apps/server/src/market-data/` 有台灣專屬資料源（`twse-client.ts`、`taifex-client.ts`），
  與美股/總經資料源（`fred-client.ts`、`nasdaq-client.ts`）並存。
- `apps/server/data/entity-aliases.yml`、`apps/server/data/topic-aliases.yml` 是中英文
  entity／topic 別名對照表，內容綁定台灣與美國總經場景的具體名稱（如台積電／TSMC、Fed／聯準會）。
