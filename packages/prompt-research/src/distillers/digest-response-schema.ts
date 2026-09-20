// 這份 schema 現在是純資料、不依賴任何 SDK：`type` 用標準 JSON Schema 的小寫字串字面值
// （'object'／'string'／'array'）取代 `@google/genai` 的 `Type.OBJECT` 等 enum。可行的依據：
// `apps/server/src/agents/` 底下主 pipeline 的 agent schema 本來就是小寫 `type: 'object'`，
// 原樣穿過 `apps/server/src/agents/providers/gemini.ts` 的 `responseSchema` 餵給真 Gemini、
// 在部署環境每日執行過（例：`apps/server/src/agents/analyst-tier1.ts`）。
// ★ 過去式是刻意的：這個 repo 目前沒有 prod（見 `docs/operations/deploy.md`），
//   所以這條依據是「歷史上真的跑過」，不是「現在正在跑」。
//
// `nullable: true`（下面 4 處）刻意保留、沒有改寫成標準 JSON Schema 的
// `type: ['string', 'null']`：`nullable` 是 Gemini／OpenAPI 3.0 的寫法，但「Gemini 收不收
// 聯集型別」目前沒有證據——這個 session 刻意不打 AI API（`GEMINI_API_KEY` 故意失效），
// 驗不了就不動。這是本檔目前唯一剩下的非標準欄位。
//
// Mirrors DigestSchema (Zod) for Gemini native responseSchema.
export const digestResponseSchema = {
  type: 'object',
  properties: {
    sourceSlug: { type: 'string' },
    sourceKind: { type: 'string', enum: ['yt-transcript', 'skill-markdown', 'custom-text', 'podcast-rss'] },
    generatedAt: { type: 'string' },
    analystFrames: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          whenToApply: { type: 'string' },
          questions: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'description', 'whenToApply', 'questions'],
      },
    },
    analysisChecks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          purpose: { type: 'string' },
          inputsNeeded: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'purpose', 'inputsNeeded'],
      },
    },
    vocabulary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          preferred: { type: 'string' },
          avoid: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['preferred', 'avoid', 'reason'],
      },
    },
    compliance: {
      type: 'object',
      properties: {
        redFlags: { type: 'array', items: { type: 'string' } },
        suggestedDisclaimer: { type: 'string', nullable: true },
      },
      required: ['redFlags'],
    },
    rawSourceRef: {
      type: 'object',
      properties: {
        url: { type: 'string', nullable: true },
        localPath: { type: 'string', nullable: true },
        commitSha: { type: 'string', nullable: true },
      },
    },
  },
  required: ['sourceSlug', 'sourceKind', 'generatedAt', 'analystFrames', 'rawSourceRef'],
} as const
