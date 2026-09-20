// 哪些檔案直接 `import ... from
// '@google/genai'`、因此明確綁死 Gemini、換 provider 換不掉，是一份決定而不是意外。
// 守門測試在同目錄的 gemini-only-paths.test.ts。
//
// 為什麼不是「接進 apps/server/src/agents/providers/」讓它們 provider-neutral：
// - `apps/server/src/agents/providers/gemini.ts` 本身就是 adapter，不在清單裡。
// - `apps/server/tools/eval/model-ab/targets.ts` 的 `probeModelVersions` 讀的是 Gemini
//   回應專屬的 `modelVersion` 欄位，provider-neutral 的 `ProviderCallResult` 沒有、也不該
//   定義這個概念。
// - `packages/prompt-research`（Transcript Tool，第二個產品）**不能** import
//   `apps/server/src/agents/providers/`——依賴方向是 server → prompt-research，反過來會
//   成環。要接上抽象層等於把整個抽象搬進共用 package——那是一次架構重寫，而不是
//   讓既有的東西可攜。判準是「不重寫還能動的東西」，所以決定是明確標註，不是重構。
//
// 詳細理由見各檔案自己的 JSDoc；本檔只列清單、供守門測試窮舉比對。
export interface GeminiOnlyPathEntry {
  file: string
  reason: string
}

export const GEMINI_ONLY_PATHS: GeminiOnlyPathEntry[] = [
  {
    file: 'apps/server/src/agents/providers/gemini.ts',
    reason: 'Gemini adapter 本身；provider-neutral 抽象層的實作，不是需要標註的例外',
  },
  {
    file: 'apps/server/tools/eval/model-ab/targets.ts',
    reason: 'probeModelVersions 讀 Gemini 回應的 modelVersion 欄位，ProviderCallResult 沒有這個概念',
  },
  {
    file: 'packages/prompt-research/src/gemini-client.ts',
    reason: 'packages/prompt-research 不能 import apps/server 的 providers/（依賴方向會成環），明確標成 Gemini-only',
  },
  {
    file: 'packages/prompt-research/src/audio/gemini-stt.ts',
    reason: '依賴方向約束同上，且 STT + File API 上傳不在「OpenAI 相容 chat completions」的形狀裡',
  },
  {
    file: 'packages/prompt-research/src/sources/yt-transcript/segmenter.ts',
    reason: '依賴方向約束同 gemini-client.ts（packages/prompt-research 不能 import apps/server 的 providers/）',
  },
  {
    file: 'packages/prompt-research/src/sources/yt-transcript/lens-extractors.ts',
    reason: '依賴方向約束同 gemini-client.ts（packages/prompt-research 不能 import apps/server 的 providers/）',
  },
  {
    file: 'packages/prompt-research/src/sources/yt-transcript/consolidator.ts',
    reason: '依賴方向約束同 gemini-client.ts（packages/prompt-research 不能 import apps/server 的 providers/）',
  },
]
