import antfu from '@antfu/eslint-config'
import importX from 'eslint-plugin-import-x'

// monorepo root path、用於 import-x/no-restricted-paths 的 basePath。
// 當 lint 從 subdir 跑（例：pnpm --filter <ws> lint）、process.cwd() 會
// 落在 workspace dir 而非 repo root、zone target 解析就會錯位。
const REPO_ROOT = import.meta.dirname

export default antfu(
  {
    vue: true,
    typescript: true,
    formatters: true,
    stylistic: {
      semi: false,
      quotes: 'single',
    },
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.md',
      'docs/**',
      'apps/server/drizzle/**',
      '**/drizzle/meta/**',
      '**/migrations/meta/**',
      '**/__fixtures__/**/*.html',
      // prompt-research CLI 的本機生成 dump（gitignored、非 source）、不 lint
      '**/.prompt-research-out/**',
      // brief:quality / brief:canary 的本機生成 pairwise 明細（gitignored、非 source）
      '**/.eval-out/**',
      // 自備的真實 canary fixtures（非 source、內含網頁全形/nbsp 等不規則空白）
      '**/eval/fixtures/canary/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,vue}'],
    plugins: {
      'import-x': importX,
    },
    // 走 TypeScript resolver、否則 `from './foo.js'`（TS ESM 慣例、實際檔
    // 是 .ts）會解析失敗、no-restricted-paths 無法判斷 zone 就 silently
    // 跳過、@/* 等 tsconfig path alias 也讀不到。alwaysTryTypes 讓
    // @suanomics/* workspace package 的 .d.ts → .ts source mapping 也能跑、
    // project glob 涵蓋全 workspace tsconfig 讓 alias 解析正常。
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          // monorepo workspace 都有自己的 tsconfig（含 @/* alias）、project
          // 用 glob 全 cover；noWarnOnMultipleProjects 抑制 resolver 對「多
          // tsconfig」的 advisory warning（已知設計、不是 misconfig）。
          project: [
            './tsconfig.json',
            './apps/*/tsconfig.json',
            './packages/*/tsconfig.json',
          ],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      'ts/no-explicit-any': 'error',
      'ts/no-non-null-assertion': 'error',
      'ts/consistent-type-imports': 'error',
      'import-x/extensions': ['error', 'ignorePackages', {
        ts: 'never',
        tsx: 'never',
        mts: 'never',
        cts: 'never',
        vue: 'always',
        js: 'always',
        mjs: 'always',
        cjs: 'always',
        jsx: 'always',
      }],
      // workspace 邊界紀律機械化：
      // - apps/* 互不能直接 import（要共用就抽到 packages/<shared>）
      // - packages/* 不能 import apps/*（leaf 不依賴上層）
      // 走 @suanomics/* workspace package 是允許 path、rule 解析後對應到
      // packages/<pkg>/src/...、不會誤觸發。
      // basePath 鎖到 REPO_ROOT、避免 `pnpm --filter <ws> lint` 從 subdir
      // 跑時 process.cwd() 落在 workspace dir 導致 zone target 錯位。
      'import-x/no-restricted-paths': ['error', {
        basePath: REPO_ROOT,
        zones: [
          { target: './apps/server', from: './apps/web' },
          { target: './apps/web', from: './apps/server' },
          { target: './packages', from: './apps' },
        ],
      }],
    },
  },
  {
    rules: {
      'no-console': 'warn',
      'no-debugger': 'error',
      'prefer-template': 'error',
      'pnpm/yaml-enforce-settings': 'off',
    },
  },
  {
    // 把專案的「檔 < 300、函式 < 50」guideline 機械化把關。
    // 只套 source code（ts/tsx/vue/js）、不套 CSS / JSON / Markdown
    // （Design System CSS / drizzle snapshot 等 generated artifact 屬合理大）。
    // max-lines 設 error、超過必須拆檔 / 抽 module / 或 inline disable + 註解 why。
    // max-lines-per-function 設 warn（80 是務實閾值、50 太嚴）、容忍 prompt
    // builder 等 string concat 較長的 helper、IDE highlight 提醒重構即可。
    files: ['**/*.{ts,tsx,vue,js,mjs,cjs}'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Test files：一個 SUT 對應多個 test case、單檔行數常突破 300、屬合理 cohesion、
    // 機械 enforce 反而促成「為了縮行而拆 fixture」、與「測試易讀」目標衝突。
    files: ['**/*.{test,spec}.{ts,tsx,js,vue}'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
)
