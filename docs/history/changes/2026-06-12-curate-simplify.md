# 2026-06-12：Prompt pipeline curate 簡化（路徑 B）

> Cascade quality review R1。distill + compile 之間斷掉的 curate 環節、選「砍自動化、改人工」而非「補自動化」。frames / vocab / redFlags 從 curation YAML 閘改為 draft 全量直通、frame-level 人工取捨集中到 promote。

## TL;DR

- **6 commit、`2135e1a..450b712`**、嚴格 STRUCTURAL（行為改動只在「frames/vocab/redFlags 全量進 candidate」這一層、不影響 production prompt 內容）
- **下架 curation 機械**：`curator/`（7 source + 7 test）、`compiler/effective-agents.ts`、`prompt:curate` CLI + 其 lib、curation YAML fixture、`js-yaml` dep（prompt-research workspace）
- **新工作流**：`prompt:distill`（蒸餾）→ `prompt:compile`（frames/vocab/redFlags 全量進 candidate）→ **人工 promote**（diff candidate vs production prompt、人工取捨後手動貼上）
- **淨刪約 1,690 行**（34 file changed、135 insertions、1690 deletions）

## 為什麼選路徑 B（砍自動化）不選路徑 A（補自動化）

背景見 spec [`docs/superpowers/specs/2026-06-12-cascade-quality-review.md`](../superpowers/specs/2026-06-12-cascade-quality-review.md) §2a。

當初 curate 環節斷掉、有兩條路：

- **路徑 A**：補一條 `prompt:curate-local` CLI、直接呼叫 `curateSource()` + `yml-merger.ts`、把 frame 寫進 `packages/prompts/curation/<slug>.yml`、跳過從未實作的 `/internal/curate/enqueue`。**保留** curation override 機制。
- **路徑 B（採用）**：直接放棄 curation YAML 機制、frames / vocab / redFlags 改 draft 全量直通 candidate、frame-level 人工取捨移到 promote。

選 B 的理由（spec §2a）：

- **思路萃取是低頻離線活動**（約一季一次）、不是 hot path。
- **總需求約 10-20 個 frames**、規模小。
- **merge / compile / candidate / promote 四階段自動化對一人專案是過度工程**：人工從 draft 挑 frame 的成本、低於維護 curator LLM + YAML merge + stale/override 標記 + 對應 test 的成本。
- distill（deep pipeline、抓字幕 / 蒸餾 digest）有真實價值、**保留**；自動 promote 那層機械才是過度工程、砍掉。

## 新語意表

| 維度 | 路徑 B 之前 | 路徑 B 之後 |
|------|------------|------------|
| frames / vocab / redFlags 進 candidate | 經 curation YAML 閘（`collectFramesForAgent` 過濾）| **draft 全量直通**、不過濾 |
| stale 標記 | curation YAML 標 source 已過期、compile 跳過 | **廢除**（無中介層、無此概念）|
| frame-level override | 在 `packages/prompts/curation/<slug>.yml` 人工標 keep/drop | **廢除**、取捨移到 promote |
| 人工取捨時點 | 編 curation YAML 時 | **promote 時**（貼 candidate → production prompt 前）|
| candidate `.system.ts` 內容 | 只有通過 curation 閘的 frames | draft 全部 frames / vocab / redFlags |

人工取捨沒消失、只是**從「編 YAML」搬到「promote 時 diff + 手貼」**——少一層中介資料格式、少一套要維護的機械。

## 刪除清單摘要

commit range `2135e1a..450b712`：

| 範圍 | 刪除內容 |
|------|---------|
| `packages/prompt-research/src/curator/` | 整個 dir：`curator.ts` / `curator-prompt.ts` / `yml-merger.ts` / `types.ts` / `index.ts` + 對應 4 個 test |
| `packages/prompt-research/src/compiler/` | `effective-agents.ts` + test、`__fixtures__/sample-curation.yml` |
| `apps/worker/src/scripts/` | `prompt-research-curate.ts`（`prompt:curate` CLI）+ `lib/prompt-research-cli-curate.ts` + test |
| deps | `js-yaml` 從 `packages/prompt-research` package.json 移除（curation YAML 解析用；worker 仍保 `js-yaml`、它另有 `entity-aliases.yml` 用途）|
| exports | `@lab/prompt-research` 的 `./curator` subpath 廢除（只剩 `.`）|
| compile 參數 | `runCompile` 不再吃 curation / curationDir 參數、只 `{ runId, outputsDir, promptsDir }` |

對應 commit：

```
86a548b feat(prompt-research): vocab bypasses curation gate [BEHAVIORAL]
5deba0c feat(prompt-research): frames bypass curation gate [BEHAVIORAL]
e2c65ff feat(prompt-research): redFlags bypass curation gate [BEHAVIORAL]
020a03e feat(prompt-research): header points to promote workflow [BEHAVIORAL]
4148b2e refactor(prompt-research): drop curation params on compile [STRUCTURAL]
450b712 refactor(prompt-research): remove curation machinery [STRUCTURAL]
```

## 已知殘留（低優先、留 backlog）

curate 下架後、兩處 schema / 型別殘留無 caller、但移除牽動 migration、留待下次 schema 變更順手清（[backlog](../backlog.md) P2「架構整理」剩餘工作）：

- **DB `background_jobs_kind_check`**（[packages/db/src/schema.ts:121](../../packages/db/src/schema.ts)）：enum 仍含 `'curate'` jobKind、無 producer / consumer。移除需新 migration 改 check constraint。
- **`llm-wrapper.ts` 的 `'curator'` AgentName**（[apps/worker/src/agents/llm-wrapper.ts](../../apps/worker/src/agents/llm-wrapper.ts)）：`AgentName` union 仍含 `'curator'`、其 timeout budget（60s）已無 caller。

**處理建議**：不單獨開 task。等下次有 migration 變更（例：加新 jobKind）時、把 `'curate'` enum 一併拿掉、同 PR 清 `llm-wrapper.ts` 的 `'curator'` AgentName 與 budget。兩處都是 dead enum value、留著不影響行為、只是噪音。

## 文件同步

- [docs/operations/prompt-pipeline.md](../operations/prompt-pipeline.md)：curate 章節改寫為 distill → compile → promote 三步、Compile 輸出與 Promote 流程更新為「全量直通 + promote 取捨」、「已知限制」刪 curate 斷鏈項
- [docs/backlog.md](../backlog.md)：原 P1 curate 缺口節改為已解決紀錄、新增 schema/型別殘留清理項
- `apps/worker/README.md` / `packages/prompt-research/README.md`：`prompt:curate` 與 effective-agents 描述同步
- `apps/worker/src/agents/{analyst-tier1,decomposer,synthesizer}.prompt.ts`：AUTO-GENERATED header 的 `curation/*.yml` 提示改為 `regenerate via prompt:compile; 人工取捨在 promote 時進行`（只改註解、prompt 內容未動）

## Spec

- Spec: [docs/superpowers/specs/2026-06-12-cascade-quality-review.md](../superpowers/specs/2026-06-12-cascade-quality-review.md) §2a
