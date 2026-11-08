import antfu from '@antfu/eslint-config'
import importX from 'eslint-plugin-import-x'

// monorepo root path、用於 import-x/no-restricted-paths 的 basePath。
// 從 subdir 跑 eslint 時 process.cwd() 會落在 workspace dir，zone target 會錯位。
const REPO_ROOT = import.meta.dirname

// LLM 只經 ai 套件與 @ai-sdk/*（ADR 0004）。ESLint 同名規則後者整條覆蓋前者，
// 所以 apps/web 的設定要帶上這兩份清單，不能只寫差異。
const BANNED_LLM_SDK_PATHS = [
  { name: '@anthropic-ai/sdk', message: 'LLM 呼叫走 ai 套件（ADR 0004）。' },
  { name: '@google/genai', message: 'LLM 呼叫走 ai 套件（ADR 0004）。' },
  { name: 'openai', message: 'LLM 呼叫走 ai 套件（ADR 0004）。' },
]
const BANNED_LLM_SDK_PATTERNS = [
  { group: ['@anthropic-ai/sdk/*', '@google/genai/*', 'openai/*'], message: 'LLM 呼叫走 ai 套件（ADR 0004）。' },
]

export default antfu(
  {
    typescript: true,
    astro: true,
    // astro 不交給 formatter：formatter 會把 .astro 的 parser 換成 parser-plain，
    // astro-eslint-parser 被蓋掉後 import 邊界規則就檢查不到 .astro 的 frontmatter。
    formatters: {
      astro: false,
      css: true,
      html: true,
    },
    stylistic: {
      semi: false,
      quotes: 'single',
    },
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/node_modules/**',
      '**/*.md',
      'docs/**',
      'spikes/**',
      '**/migrations/meta/**',
      // 上游回應的原樣樣本（parser 測試的輸入），不套 formatter
      '**/__fixtures__/**/*.html',
    ],
  },
  {
    files: ['**/*.{ts,tsx,astro}'],
    plugins: {
      'import-x': importX,
    },
    // 走 TypeScript resolver，否則 `from './foo.js'`（實際檔是 .ts）解析失敗，
    // no-restricted-paths 無法判斷 zone 就會靜默跳過。
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: [
            './apps/*/tsconfig.json',
            './packages/*/tsconfig.json',
          ],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      // workspace 邊界（design-basis「Workspace 與依賴方向」）：
      // - apps/web 不得 import apps/pipeline
      // - packages/* 不得 import apps/*
      'import-x/no-restricted-paths': ['error', {
        basePath: REPO_ROOT,
        zones: [
          { target: './apps/web', from: './apps/pipeline' },
          { target: './packages', from: './apps' },
        ],
      }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'ts/no-explicit-any': 'error',
      'ts/no-non-null-assertion': 'error',
      'ts/consistent-type-imports': 'error',
    },
  },
  {
    rules: {
      'no-console': 'warn',
      'no-debugger': 'error',
      'prefer-template': 'error',
      'pnpm/yaml-enforce-settings': 'off',
      'antfu/reasonable-newline': 'off',
    },
  },
  {
    // 「檔 < 300、函式 < 80」機械化把關，只套 source code。
    files: ['**/*.{ts,tsx,astro,js,mjs,cjs}'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/*.{ts,mts,cts,tsx,astro,js,mjs,cjs,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          ...BANNED_LLM_SDK_PATHS,
          { name: 'ai', importNames: ['generateObject'], message: 'generateObject 已 deprecated，用 generateText 加 Output.object。' },
        ],
        patterns: BANNED_LLM_SDK_PATTERNS,
      }],
    },
  },
  {
    // 網站是靜態產生，LLM 呼叫只在 pipeline。
    files: ['apps/web/**/*.{ts,mts,cts,tsx,astro,js,mjs,cjs,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          ...BANNED_LLM_SDK_PATHS,
          { name: 'ai', message: 'apps/web 不呼叫 LLM，只讀 pipeline 寫進 Postgres 的結果。' },
        ],
        patterns: [
          ...BANNED_LLM_SDK_PATTERNS,
          { group: ['ai/*', '@ai-sdk/*'], message: 'apps/web 不呼叫 LLM，只讀 pipeline 寫進 Postgres 的結果。' },
        ],
      }],
    },
  },
  {
    files: ['**/*.astro'],
    rules: {
      'ts/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx,js}'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
)
