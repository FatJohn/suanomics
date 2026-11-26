# 目標 prompt 規格

讀者：調整 agent prompt 的開發者、baguanomics 的使用者
型別：參考

`agents/` 底下每個 agent 一份規格檔，是本 repo 給 prompt 研究工具 baguanomics 的介面，baguanomics 的 `--specs` 指向這個子目錄。規格檔由 `apps/pipeline/src/prompts/prompt-specs.test.ts` 從程式常數產生，不手改。

## 一致性怎麼維持

| 規格檔內容 | 來源 |
|---|---|
| 現行 prompt 全文、條件附加段 | `apps/pipeline/src/prompts/` 與 `apps/pipeline/tools/eval/` 的 prompt 常數 |
| 輸出 schema | 各 agent 傳給模型的 Zod schema，以 `z.toJSONSchema` 轉成 JSON Schema |
| 禁用語 | `packages/shared` 的 `FORBIDDEN_PHRASES`，每份規格檔都帶完整清單 |
| 抽象評價贅詞 | 測試檔內的 `PODCAST_GARNISH_TERMS`，只有 podcast-writer 帶 |
| agent 清單 | `apps/pipeline/src/agents/models.ts` 的 `AGENT_NAMES`，每個 agent 一份 |

測試用 vitest 的 file snapshot 比對規格檔與程式常數，不符時 `pnpm -r test` 失敗，CI 因此擋下 prompt 改了、規格檔沒重產的 PR。改了 prompt 或禁用語後，執行下列指令重產，規格檔的 diff 與程式改動放同一個 PR：

```bash
pnpm --filter @suanomics/pipeline exec vitest run src/prompts/prompt-specs.test.ts -u
```

## 格式

baguanomics 的規格檔解析器只認下列結構：

| 段落 | 格式 |
|---|---|
| 基本資料 | `- agent:` 與 `- frame-style:` 兩行，值放反引號內 |
| `## 現行 prompt` | 每個 prompt 一個 `### ` 加反引號 export 名稱的標題，接一個至少五個反引號的 `text` fence |
| `## 條件附加段` | 只在特定條件接到 prompt 後面的段落，baguanomics 不對它產候選 |
| `## 輸出 schema` | 每個 schema 一個 JSON fence |
| `### 禁用語`、`### 抽象評價贅詞` | `- ` 條列 |

frame-style 決定 baguanomics 怎麼排研究素材：

| frame-style | agent |
|---|---|
| `decomposer` | decomposer |
| `analyst` | analyst-tier1、analyst-tier2 |
| `synthesizer` | synthesizer |
| `none` | 其餘 agent，不產候選 |
