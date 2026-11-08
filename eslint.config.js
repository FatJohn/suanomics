import antfu from '@antfu/eslint-config'
import importX from 'eslint-plugin-import-x'

// monorepo root path、用於 import-x/no-restricted-paths 的 basePath。
// 從 subdir 跑 eslint 時 process.cwd() 會落在 workspace dir，zone target 會錯位。
const REPO_ROOT = import.meta.dirname

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
    files: ['**/*.{test,spec}.{ts,tsx,js}'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
)
