# 2026-05-10 Cascade-only Refactor

## 背景

兩週 demo 已於 2026-04-30 結束（`v0.demo-final` tag）。User 決定把 repo 從「三產品 demo」收斂成「Cascade 主打 + 獨立 transcript 工具」、目標是再認真做、進到 PoC 階段（不是 production）。同時要把 repo 內混在一起的東西拆乾淨、用語去 demo 化。

## 範圍

### In Scope

1. **砍 Lv1（假訊息查核器）**：移除 `/check`、`/factcheck`、`/result` 路由、相關 view / component / store、後端 `routes/factcheck.ts` + 對應 lib（`authorities.ts`、`prompt.ts`、`llm.ts`、`data/authorities.json`）
2. **砍 Lv3-B（ETF 心理教練）**：移除 `/coach` 路由、相關 view / component / store、後端 `routes/chat.ts` + 對應 lib（`coach-prompt.ts`、`etf-history.ts`、`forbidden-filter.ts`、`data/etf-history.json`）+ 前端 `data/etf-history.ts` + `lib/historyCards.ts` + `components/common/DisclaimerBanner.vue`
3. **重做 LandingView**：Cascade 主打 single-product hero、加入 YouTube transcript 工具當 secondary 入口
4. **建立獨立 YouTube/Podcast transcript 工具骨架**：新增 `/transcript` 路由 + `TranscriptView.vue` placeholder、後端 `routes/transcript.ts` 接 `lib/youtube.ts`（已存在）、設計上預留 Podcast feed 擴張位
5. **去 demo 化**：全 repo sweep「demo / 兩週 demo / 14 天 / 16 天 / demo day」字眼、改成 PoC / 開發階段、看 context
6. **Zeabur 新 project**：建新 project 部署 api + web、舊 project 暫不動（user 說之後再拆）

### Out of Scope（這波不做、列在 memory 待辦）

- LLM provider 分層（analyst / synthesizer / podcast-writer 換 Claude）— 等架構穩定再做
- Podcast feed 抓取實作（皓哥 + 其他人）— 先預留設計、實作下波
- 後端架構大重整（lib/ 階層拆乾淨）— 等這波 砍完看剩下骨架再規劃

## 邊界釐清（已 grep 驗證）

| 模組 | 砍 / 留 | 理由 |
|---|---|---|
| `apps/web/src/composables/useAnalyzeJob.ts` | **留** | Cascade（brief/analyze）的 job poller |
| `apps/web/src/lib/detect-youtube.ts` | **留** | 之後 transcript 工具 view 用 |
| `apps/web/src/lib/auto-open.ts` | 砍 | factcheck 專用 |
| `apps/web/src/lib/historyCards.ts` | 砍 | coach 專用 |
| `apps/web/src/components/common/DisclaimerBanner.vue` | 砍 | 只 coach 用 |
| `apps/api/src/lib/youtube.ts` | **留** | 之後 transcript 工具 route 用 |
| `apps/api/src/lib/llm.ts`（factcheck/chat 用 wrapper）| 砍 | brief 用的是 `lib/brief/agents/llm-wrapper.ts`、不衝突 |
| `apps/api/src/lib/forbidden-filter.ts` | 砍 | 只 chat 用 |
| `apps/api/src/lib/coach-prompt.ts` | 砍 | re-export `FORBIDDEN_PHRASES` 但 brief / corpus 改 import 自 `@lab/shared` |
| `packages/shared/src/compliance.ts`（FORBIDDEN_PHRASES）| **留** | brief / corpus / podcast prompt 都還在用 |
| `packages/shared/src/{authority,chat,etf-history,insight,share*}.ts` | **第一波留**、第二波清 | 為了控制 risk、第一波只清 apps/、shared 裡 dead code 之後再掃 |

## 實作步驟（依序）

1. **去 demo 化文字 sweep**（純文字、低風險、先做暖機）
2. **前端砍除**：刪 file → 改 router → 改 LandingView → tsc 驗
3. **後端砍除**：刪 file → 改 `index.ts` mount → tsc 驗
4. **Transcript 工具骨架**：新 route + view、僅串通管線、不做完整 UI（PoC placeholder）
5. **跑 `pnpm test` 驗證沒 regression**
6. **Commit**：structural（檔案搬 / 重命名 / 刪除）與 behavioral（LandingView 重做、新 transcript 路由）分開
7. **Zeabur 新 project**：建 project、設 env、推 api + web

## 風險

- **Test fixture 連鎖**：刪 `coach-prompt.ts` re-export 後、若還有檔案 import 自 coach-prompt 而非 shared、tsc 會炸。已 grep 確認 brief / corpus 都 import 自 `@lab/shared`、安全。
- **Zeabur Dockerfile**：repo 的 `Dockerfile.api` / `Dockerfile.web` 是 canonical、新 project 設定時要把內容貼進 service 設定檔編輯器（CLAUDE.md 註記）。
- **舊 project 不拆**：user 明確指示「之後再拆」、這波只新建、不動舊的。

## 不做的決策

- **Backend 不轉 C#**：99% 時間在等 LLM API、語言 runtime 差異被 I/O 吃掉、TS LLM 生態系統明顯領先、`@lab/shared` schema 共用會斷。User 同意。
- **Spec 不走完整 brainstorming → plan → subagent dispatch 流程**：scope 主要是 deletion、TDD 價值低、auto mode 直接做。
