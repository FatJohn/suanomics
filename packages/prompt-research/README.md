# @suanomics/prompt-research — Prompt research pipeline

Prompt 蒸餾 / 編譯 pipeline runtime。從 YouTube transcript / skill markdown / custom text 等 source 拉素材、LLM 蒸餾成 digest、合併、編譯成各 agent 的 candidate prompt（frames / vocab / redFlags 全量直通）、寫入 `packages/prompts/_candidates/<runId>/`。frame-level 取捨由人在 promote 時做（diff candidate vs production prompt、手動貼上）。

2026-05-20 從 `apps/server/src/lib/prompt-research/` 抽出為獨立 workspace、可獨立演進。全圖見 [模組地圖](../../docs/architecture/module-map.md)。

## 目錄

```
src/
├── index.ts                  # 主 subpath：pipeline runtime 公開 surface
├── types.ts                  # SourceSpec / Digest 等
├── gemini-client.ts          # Gemini SDK 包裝（與 server 那份是分開的）
├── merger.ts                 # digest 合併
├── compiler/                 # candidate prompt 編譯
│   ├── compiler.ts           # 主入口（runCompile）
│   ├── cli-compile.ts        # CLI 進入點
│   ├── prune-candidates.ts   # 舊 candidate 清除
│   ├── analyst-prompt.ts
│   ├── decomposer-prompt.ts
│   └── shared-preamble.ts
├── distillers/               # 各 source → digest 的蒸餾器
├── sources/                  # source 實作
│   ├── index.ts
│   ├── dispatch.ts           # dispatchSource()：根據 kind 派工
│   ├── default-sources.ts    # DEFAULT_SOURCES 清單
│   ├── custom-text.ts
│   ├── skill-markdown.ts
│   └── yt-transcript/        # YouTube 字幕 source（多檔模組）
└── __fixtures__/             # 測試 fixtures
```

## Entry & exports

單一 subpath：

| Subpath | 用途 |
|---------|------|
| `.` | runtime：`runCompile` / `pruneOldCandidates` / `mergeDigests` / `DEFAULT_SOURCES` / `dispatchSource` / `Digest` / `SourceSpec` |

## 常用命令

```bash
pnpm --filter @suanomics/prompt-research build
pnpm --filter @suanomics/prompt-research test
pnpm --filter @suanomics/prompt-research type-check
```

> CLI 進入點在 server：`pnpm --filter server prompt:distill` / `prompt:compile` / `prompt:refresh`（後者走 queue）。
> compile 產 candidate 後人工 promote（無自動 curate 階段）。

## 依賴

| 來源 | 用途 |
|------|------|
| `@suanomics/jobs` | `SourceSpec` 型別來源 |
| `@suanomics/shared` | compliance / brief 契約 |
| `@google/genai` | Gemini SDK |
| `fastest-levenshtein` | digest dedup |
| `youtube-transcript-plus` | YouTube transcript source |

## 被誰用

只給 `apps/server` 用（runtime 經 `prompt-refresh-worker` + `runPromptRefresh`、CLI 經 `scripts/prompt-research-*.ts`）。**`apps/web` 不依**。

## 約束

- 禁依 `apps/*`。
- public-API surface 透過 `package.json` 的 `exports` field 與 [knip.json](../../knip.json) entry 宣告、其他 export 用 internal 處理（移 `export` keyword）。
- candidate 寫到 `packages/prompts/_candidates/<runId>/`、不直接覆蓋 production prompt（人工 review + 拷貝進 `apps/server/src/prompts/<name>.prompt.ts`）。
- runtime dependencies 改動要審慎：server 已從 `package.json` 把 `fastest-levenshtein` / `youtube-transcript-plus` 移到這裡、不要又 leak 回去。
