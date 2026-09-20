import type { JobKind } from '@suanomics/jobs'

/**
 * 每個 kind 同時跑幾條。
 *
 * 抽成純資料的理由：concurrency 的環境變數名是只出現一次的字面字串——打錯不會有人
 * 發現，prod 只是靜默用預設值跑。表在這裡就能被測試掃過。
 *
 * 沒有 lock 或租約欄位：job 只在這個 process 的記憶體裡排隊，沒有第二個消費者會來
 * 搶同一筆，所以「多久沒續約就當它死了」這個問題不存在了。
 */
export interface JobSpec {
  kind: JobKind
  defaultConcurrency: number
}

/**
 * concurrency 的環境變數名由 kind 推導，不逐條寫死。
 *
 * 八個既有的名字全部符合這條規則（測試逐條釘住），所以寫死只是多八個打錯的機會。
 */
export function concurrencyEnvFor(kind: JobKind): string {
  return `${kind.toUpperCase().replace(/-/g, '_')}_CONCURRENCY`
}

export const JOB_SPECS: readonly JobSpec[] = [
  { kind: 'corpus-refresh', defaultConcurrency: 2 },
  { kind: 'analyze', defaultConcurrency: 1 },
  { kind: 'daily-brief', defaultConcurrency: 1 },
  { kind: 'podcast-generate', defaultConcurrency: 1 },
  { kind: 'podcast-tts', defaultConcurrency: 1 },
  // news-refresh 跑長：prod 實測 p50 632 秒、最長 2060 秒（2026-08-22，90 天樣本 n=49）。
  // 「跑多久算不正常」的門檻另有一張表（JOB_INFLIGHT_STALENESS_MS）。
  { kind: 'news-refresh', defaultConcurrency: 2 },
  // prompt-refresh 的 distill+compile 是多次 LLM call，可能 5-20 分鐘
  { kind: 'prompt-refresh', defaultConcurrency: 1 },
  // market-data-refresh：FRED/TWSE 抓取 + upsert，每日一次、不需延長 lock
  { kind: 'market-data-refresh', defaultConcurrency: 1 },
]

/** 讀環境變數的併發數；非正整數或缺值一律回退到 spec 的預設。 */
export function resolveConcurrency(
  spec: JobSpec,
  env: Record<string, string | undefined>,
): number {
  const raw = env[concurrencyEnvFor(spec.kind)]
  if (!raw)
    return spec.defaultConcurrency
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : spec.defaultConcurrency
}
