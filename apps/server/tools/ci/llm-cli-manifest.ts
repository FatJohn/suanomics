// `tools/cli/*` 每個入口都要被明確分類過，不能靠「看起來像什麼」猜。
// shape 的判準（見 llm-cli-manifest.test.ts 的窮舉測試，逐檔核對過 2026-09-14）：
//   - 'batch'：跑一次會在單一 process 內迴圈打好幾輪 LLM（`--replicates`、多個
//     canary 日期、多則新聞……），才是這條規則要擋的形狀。
//   - 'single'：即使 import 了 agent 函式，一次執行只打固定、跟輸入量無關的次數
//     （pairwise judge 一次比較固定兩通、single-news 分析固定幾通），不會因為
//     使用者多下幾個參數就線性膨脹。
//   - 'no-llm'：完全不經過任何 agent／provider 呼叫（純 DB 操作、純資料轉換、
//     外部非 LLM API）。
// gated 是否為 true 由 llm-cli-manifest.test.ts 對檔案內容機械核對
// （剝掉註解後是否含 `enforceLlmRunBudget(`），不是這裡手動宣告就算數。
//
// ★ 不是每支 tools/cli/ 底下的檔都會列在下面的陣列——有些不進這個 repo 的版控
//   （例如只在自己環境用的對照工具），這份清單只登記 repo 內真的存在的檔案，
//   避免指向一個讀者拿到手上根本找不到的路徑。那些不進版控的 CLI 改在**自己的檔頭**用
//   一行機械可解析的註解自我宣告分類：
//
//     // llm-cli-manifest: private <shape>
//
//   `<shape>` 是 LlmCliShape 三選一。llm-cli-manifest.test.ts 的窮舉測試接受「登記在
//   這份陣列」或「檔頭有這個宣告」兩者恰好一種；gated 一致性（batch 必須真的呼叫
//   enforceLlmRunBudget(、其餘不可以）對兩邊套同一條規則。
export type LlmCliShape = 'batch' | 'single' | 'no-llm'

export interface LlmCliManifestEntry {
  file: string
  shape: LlmCliShape
  gated: boolean
  reason: string
}

export const LLM_CLI_MANIFEST: LlmCliManifestEntry[] = [
  // ── batch，本次上閘門（6 支） ──
  { file: 'apps/server/tools/cli/brief-rerun.ts', shape: 'batch', gated: true, reason: '--replicates 迴圈重跑整份 brief，每份受 MAX_LLM_CALLS_PER_JOB 硬上限保護' },
  { file: 'apps/server/tools/cli/brief-canary.ts', shape: 'batch', gated: true, reason: '迴圈跑所有 canary 日期，每天固定兩通 quality-judge 呼叫' },
  { file: 'apps/server/tools/cli/model-ab.ts', shape: 'batch', gated: true, reason: '迴圈跑多個臂 × 樣本／日期；--analyze／--probe 不打真 LLM、不受閘門影響' },
  { file: 'apps/server/tools/cli/narrative-ledger-ab.ts', shape: 'batch', gated: true, reason: '迴圈跑多個日期、每天三臂各自呼叫 decomposer/analyst/synthesizer/narrative-writer' },
  { file: 'apps/server/tools/cli/claim-yield-smoke.ts', shape: 'batch', gated: true, reason: '迴圈跑多個日期的新聞、每則兩臂各呼叫 analyst-tier1' },
  { file: 'apps/server/tools/cli/viewpoints-smoke.ts', shape: 'batch', gated: true, reason: '兩臂 × runs 次 runViewpointsDebate，runs 由使用者傳入、無上限' },

  // ── batch，稍後補上閘門的兩支（原本核可範圍只到上面六支） ──
  {
    file: 'apps/server/tools/cli/news-backfill-tags.ts',
    shape: 'batch',
    gated: true,
    reason: '經 tagAndStore 間接呼叫 news-tagger，批次量隨未標記新聞數而動，已接上 enforceLlmRunBudget',
  },
  {
    file: 'apps/server/tools/cli/prompt-research-distill.ts',
    shape: 'batch',
    gated: true,
    reason: '經 @suanomics/prompt-research 直接呼叫它自己的 Gemini client（不經 apps/server 的 callAgentLLM），'
      + 'yt-transcript／podcast-rss 的 count 是開跑前已知的上界，已用該上界估算並接上 enforceLlmRunBudget',
  },

  // ── single：固定次數、不隨輸入量線性膨脹 ──
  { file: 'apps/server/tools/cli/brief-quality.ts', shape: 'single', gated: false, reason: '單一 pairwise content-ablation，固定兩通 quality-judge 呼叫' },
  { file: 'apps/server/tools/cli/brief-continuity.ts', shape: 'single', gated: false, reason: '單一 pairwise continuity-judge 呼叫，固定次數' },
  { file: 'apps/server/tools/cli/storyline-continuity-ab.ts', shape: 'single', gated: false, reason: '固定跑兩版（stateless/storyline）各一次 synthesizer+narrative-writer，不隨參數膨脹' },
  { file: 'apps/server/tools/cli/narrative-smoke.ts', shape: 'single', gated: false, reason: '單一輸入跑一次 narrative-writer' },
  { file: 'apps/server/tools/cli/cross-signal-smoke.ts', shape: 'single', gated: false, reason: '單則新聞跑一次 analyst-tier1 + viewpoints-debate' },
  { file: 'apps/server/tools/cli/_brief-local-smoke.ts', shape: 'single', gated: false, reason: '本機單次 smoke，走既有 pipeline 單次呼叫量' },
  { file: 'apps/server/tools/cli/_force-brief-and-podcast.ts', shape: 'single', gated: false, reason: '單日強制重生，走既有 pipeline 單次呼叫量（受 MAX_LLM_CALLS_PER_JOB 保護）' },
  { file: 'apps/server/tools/cli/_podcast-local-smoke.ts', shape: 'single', gated: false, reason: '本機單次 podcast smoke，固定次數' },
  { file: 'apps/server/tools/cli/brief-generate.ts', shape: 'single', gated: false, reason: '單日產一份 brief，走既有 pipeline 單次呼叫量（受 MAX_LLM_CALLS_PER_JOB 保護）' },
  { file: 'apps/server/tools/cli/podcast-generate.ts', shape: 'single', gated: false, reason: '單日產一份 podcast 文稿，固定次數' },
  { file: 'apps/server/tools/cli/podcast-tts.ts', shape: 'single', gated: false, reason: 'TTS 不經 callAgentLLM（PODCAST_TTS_PROVIDER），不是這道閘門管的範圍' },
  { file: 'apps/server/tools/cli/news-refresh.ts', shape: 'single', gated: false, reason: '單次新聞抓取＋分類/標籤，走既有 pipeline 並行上限（fanout-concurrency.ts）' },
  { file: 'apps/server/tools/cli/corpus-refresh.ts', shape: 'single', gated: false, reason: '單次 corpus 抓取＋entity-summary，走既有 pipeline 並行上限' },
  { file: 'apps/server/tools/cli/prompt-refresh.ts', shape: 'single', gated: false, reason: '單次 prompt 素材更新，固定流程' },
  { file: 'apps/server/tools/cli/prompt-research-compile.ts', shape: 'single', gated: false, reason: '單次編譯既有素材，不重新呼叫 LLM' },

  // ── 不打 LLM ──
  { file: 'apps/server/tools/cli/market-data-refresh.ts', shape: 'no-llm', gated: false, reason: '純市場資料源抓取（refreshMarketData），完全不 import 任何 agent／provider 模組' },
  { file: 'apps/server/tools/cli/_db-state.ts', shape: 'no-llm', gated: false, reason: '純 DB 查詢' },
  { file: 'apps/server/tools/cli/_delete-brief.ts', shape: 'no-llm', gated: false, reason: '純 DB 刪除' },
  { file: 'apps/server/tools/cli/_list-briefs.ts', shape: 'no-llm', gated: false, reason: '純 DB 查詢' },
  { file: 'apps/server/tools/cli/canary-ticker-check.ts', shape: 'no-llm', gated: false, reason: '純資料檢查（ticker 存在性），不打 LLM' },
  { file: 'apps/server/tools/cli/demo-seed.ts', shape: 'no-llm', gated: false, reason: '純 DB seed' },
  { file: 'apps/server/tools/cli/nasdaq-overlay-smoke.ts', shape: 'no-llm', gated: false, reason: '純市場資料疊圖檢查，不打 LLM' },
  { file: 'apps/server/tools/cli/news-health.ts', shape: 'no-llm', gated: false, reason: '純健康檢查（外部 feed 可用性），不打 LLM' },
  { file: 'apps/server/tools/cli/prod-ledger-metrics.ts', shape: 'no-llm', gated: false, reason: '純 DB 統計，不打 LLM' },
  { file: 'apps/server/tools/cli/transcript.ts', shape: 'no-llm', gated: false, reason: 'YouTube/Podcast 逐字稿擷取，不打 LLM（Transcript Tool 本體）' },
]
