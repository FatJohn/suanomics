import { describe, expect, it } from 'vitest'
import { checkStartupConfig, formatStartupConfigReport } from './startup-config.js'

// 「線上真的長這樣」的基準 env，用來當反向對照：設定齊全時不得誤叫。
// 值取自 2026-08-22 對線上兩個 service 的唯讀盤點（只看有沒有、不看內容），
// 2026-09-04 兩個 service 併成一個 process 之後合成一份聯集。
const PROD_SERVER_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://x',
  ANTHROPIC_API_KEY: 'a',
  FRED_API_KEY: 'f',
  PODCAST_TTS_PROVIDER: 'azure',
  AZURE_SPEECH_KEY: 'k',
  AZURE_SPEECH_REGION: 'australiaeast',
  PODCAST_STORAGE_KIND: 's3',
  PODCAST_S3_ENDPOINT: 'https://r2',
  PODCAST_S3_BUCKET: 'b',
  PODCAST_S3_ACCESS_KEY_ID: 'a',
  PODCAST_S3_SECRET_ACCESS_KEY: 's',
  PODCAST_S3_PUBLIC_BASE_URL: 'https://audio.example',
} satisfies Record<string, string>

function keys(issues: { key: string }[]): string[] {
  return issues.map(i => i.key).sort()
}

describe('checkStartupConfig：反向對照（設定齊全時不得叫）', () => {
  it('線上 server 的實際設定不產生任何 issue', () => {
    const r = checkStartupConfig('server', PROD_SERVER_ENV)
    expect(r.issues).toEqual([])
    expect(r.ok).toBe(true)
  })

  // 合併前 api 與 worker 是兩個 service、清單刻意分開：api 的四把 R2 憑證是空的
  // （它只呼叫 urlFor、不寫也不查存在），那不是故障。合併成單一 process 之後同一份
  // env 兩條路徑都要走得通，所以寫入用的憑證也進了必查清單——這是刻意的收緊，
  // 不是把舊的 api-only 判定搬過來忘了刪。
  it('s3 模式下讀寫兩側的 R2 設定都要查', () => {
    const { PODCAST_S3_ACCESS_KEY_ID: _a, ...env } = PROD_SERVER_ENV
    const r = checkStartupConfig('server', env)
    expect(keys(r.degraded)).toEqual(['PODCAST_S3_ACCESS_KEY_ID'])
  })
})

describe('checkStartupConfig：主線缺就是 fatal', () => {
  it('缺 DATABASE_URL', () => {
    const { DATABASE_URL: _d, ...env } = PROD_SERVER_ENV
    const r = checkStartupConfig('server', env)
    expect(keys(r.fatal)).toEqual(['DATABASE_URL'])
    expect(r.ok).toBe(false)
  })

  it('缺 ANTHROPIC_API_KEY（v1 所有 agent 都走 Anthropic）', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, ANTHROPIC_API_KEY: '' })
    expect(keys(r.fatal)).toEqual(['ANTHROPIC_API_KEY'])
  })

  it('aGENT_MODELS 用 v1 的 anthropic/claude-* 格式時也要有 ANTHROPIC_API_KEY', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, ANTHROPIC_API_KEY: '', AGENT_MODELS: 'editor:anthropic/claude-sonnet-5-5' })
    expect(keys(r.fatal)).toEqual(['ANTHROPIC_API_KEY'])
  })

  // v1 全部走 Anthropic，沒有任何 agent 或 TTS 路徑需要 Gemini。
  it('沒有 GEMINI_API_KEY 不叫', () => {
    const r = checkStartupConfig('server', PROD_SERVER_ENV)
    expect(keys(r.issues)).not.toContain('GEMINI_API_KEY')
  })

  it('空字串與只有空白都算缺', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, DATABASE_URL: '   ' })
    expect(keys(r.fatal)).toEqual(['DATABASE_URL'])
  })

  // v1 沒有 HTTP 服務（批次 pipeline＋靜態站），v0 的 HTTP 欄位不再檢查。
  it('prod 沒有 INGEST_TRIGGER_SECRET、WEB_ORIGIN 也不叫', () => {
    expect(checkStartupConfig('server', PROD_SERVER_ENV).issues).toEqual([])
  })
})

describe('checkStartupConfig：LLM provider 的靜默 fallback', () => {
  it('總開關開到 anthropic、有 agent 指向 claude* 但沒金鑰是 fatal（會靜默換 provider）', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, ANTHROPIC_API_KEY: '', AI_PROVIDER: 'anthropic', AGENT_MODELS: 'synthesizer:claude-sonnet-4-6' })
    expect(keys(r.fatal)).toEqual(['ANTHROPIC_API_KEY'])
  })

  it('總開關開到 anthropic、有 agent 指向 claude* 且金鑰在就不叫', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, AI_PROVIDER: 'anthropic', AGENT_MODELS: 'synthesizer:claude-sonnet-4-6', ANTHROPIC_API_KEY: 'a' })
    expect(r.issues).toEqual([])
  })

  // 這條是 2026-08-22 的獨立複查抓到的誤叫：總開關開著、但沒有任何 agent
  // 指向 claude* 時，resolveAgentModel 的 fallback 分支根本走不到，那個組態原本跑得
  // 好好的。判成 fatal 會擋掉一個可用的設定——誤叫正是讓檢查失去信任的東西。
  it('總開關開到 anthropic 但沒有任何 agent 指向 claude* 時不得擋啟動', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, AI_PROVIDER: 'anthropic' })
    expect(r.fatal).toEqual([])
    expect(keys(r.degraded)).toEqual(['AI_PROVIDER'])
    expect(r.degraded[0]?.kind).toBe('contradiction')
  })

  // .env.example 明寫這是刻意的「零 Claude 花費」測試安全設計，所以不是 fatal，
  // 但它確實會讓那些 agent 靜默跑在別的 model 上，要出聲。完整脈絡見
  // docs/architecture/configuration.md「LLM provider 與 model 路由」。
  it('用 AGENT_MODELS 指定 claude* 但總開關沒開只是 degraded', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, AGENT_MODELS: 'analyst-tier1:claude-sonnet-4-6' })
    expect(r.fatal).toEqual([])
    expect(keys(r.degraded)).toEqual(['AI_PROVIDER'])
    expect(r.degraded[0]?.kind).toBe('contradiction')
  })

  it('用 AGENT_MODELS 只指定 gemini model 不叫', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, AGENT_MODELS: 'editor:gemini-3.1-pro-preview' })
    expect(r.issues).toEqual([])
  })

  // 2026-09-10 修正：LLM_PROVIDER=anthropic（全域覆蓋，非 AGENT_MODELS 顯式 claude* 名）
  // 但 AI_PROVIDER 總開關沒開——resolveAgentModel 會把所有沒有顯式 provider 前綴的 agent
  // 靜默 fallback 回 Gemini（不需要 model 名是 claude*），pipeline 跑得動、只要有
  // 舊版把這個組態誤判成「保底」fatal（LLM_PROVIDER missing），這裡是
  // 獨立複查抓到的那個誤叫，改成 contradiction、不擋啟動。
  it('用 LLM_PROVIDER=anthropic 但總開關沒開 → 不得擋啟動（controller 驗收場景 4）', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'anthropic' })
    expect(r.fatal).toEqual([])
    expect(keys(r.degraded)).toEqual(['LLM_PROVIDER'])
    expect(r.degraded[0]?.kind).toBe('contradiction')
  })

  // 反例：LLM_PROVIDER=anthropic 且三條件 gate 真的開啟（AI_PROVIDER=anthropic +
  // ANTHROPIC_API_KEY 存在）時，agent 真的會打 Anthropic、不會 fallback 回 Gemini，
  // 不該有任何 contradiction。
  it('反例：LLM_PROVIDER=anthropic 且總開關真的開啟（有 ANTHROPIC_API_KEY）→ 不叫', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'anthropic', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'a' })
    expect(r.issues).toEqual([])
  })

  // LLM_PROVIDER=anthropic + AI_PROVIDER=anthropic（半開）但沒有 ANTHROPIC_API_KEY：
  // 使用者以為在用 Claude 其實沒有金鑰，要擋。
  it('用 LLM_PROVIDER=anthropic + AI_PROVIDER=anthropic 但缺 ANTHROPIC_API_KEY → fatal', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, ANTHROPIC_API_KEY: '', LLM_PROVIDER: 'anthropic', AI_PROVIDER: 'anthropic' })
    expect(keys(r.fatal)).toEqual(['ANTHROPIC_API_KEY'])
  })
})

describe('checkStartupConfig：顯式 LLM provider（開源自架／OpenRouter）', () => {
  // 這組沒有帶 AGENT_MODELS，所以踩到 globalProviderModelMismatch 那條 footgun
  // 檢查（見下面「provider／model 沒對齊」describe block）。
  it('只設 LLM_PROVIDER=openai + OPENAI_API_KEY → 不 fatal', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })
    expect(r.fatal).toEqual([])
    expect(keys(r.degraded)).toEqual(['LLM_PROVIDER'])
  })

  it('設 LLM_PROVIDER=openai 但 OPENAI_API_KEY 與 LLM_API_KEY 都沒設 → fatal', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'openai' })
    expect(keys(r.fatal)).toEqual(['OPENAI_API_KEY'])
  })

  it('設 LLM_PROVIDER=openai + LLM_API_KEY（不是 OPENAI_API_KEY）也算有 key → 不 fatal', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'openai', LLM_API_KEY: 'k' })
    expect(r.fatal).toEqual([])
  })

  it('用 AGENT_MODELS 顯式 openai/ 前綴（無 LLM_PROVIDER）也視為用到 openai、缺 openai key 一併 fatal', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, AGENT_MODELS: 'decomposer:openai/llama-3.3-70b' })
    expect(keys(r.fatal)).toEqual(['OPENAI_API_KEY'])
  })
})

describe('checkStartupConfig：只換 provider 沒換 model 的 footgun', () => {
  it('設 LLM_PROVIDER=openai 且 AGENT_MODELS 完全沒設 → 報 contradiction', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })
    expect(keys(r.degraded)).toContain('LLM_PROVIDER')
    const issue = r.degraded.find(i => i.key === 'LLM_PROVIDER')
    expect(issue?.kind).toBe('contradiction')
  })

  it('設 AGENT_MODELS 為只有逗號與空白（trim 後仍空）也算沒設 → 報 contradiction', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k', AGENT_MODELS: ' , ,' })
    expect(keys(r.degraded)).toContain('LLM_PROVIDER')
  })

  // 反例一：LLM_PROVIDER=gemini 配預設值是完全正常的組合（model 名與端點對得上），
  // 不能因為「沒有 AGENT_MODELS」就誤叫。
  it('反例：LLM_PROVIDER=gemini 且 AGENT_MODELS 沒設 → 不報', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'gemini' })
    expect(keys(r.degraded)).not.toContain('LLM_PROVIDER')
  })

  // 反例二：LLM_PROVIDER=openai 但 AGENT_MODELS 已經換了 model，視為使用者已經處理過。
  it('反例：LLM_PROVIDER=openai 且 AGENT_MODELS 有指定 model → 不報', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k', AGENT_MODELS: 'decomposer:gpt-4o-mini' })
    expect(keys(r.degraded)).not.toContain('LLM_PROVIDER')
  })

  it('反例：未設 LLM_PROVIDER（沿用 legacy 啟發式）→ 不報', () => {
    const r = checkStartupConfig('server', PROD_SERVER_ENV)
    expect(keys(r.degraded)).not.toContain('LLM_PROVIDER')
  })
})

describe('checkStartupConfig：次要依賴只 degraded', () => {
  it('缺 FRED_API_KEY', () => {
    const { FRED_API_KEY: _f, ...env } = PROD_SERVER_ENV
    const r = checkStartupConfig('server', env)
    expect(r.fatal).toEqual([])
    expect(keys(r.degraded)).toEqual(['FRED_API_KEY'])
  })

  it('azure 模式缺 AZURE_SPEECH_KEY / REGION', () => {
    const { AZURE_SPEECH_KEY: _k, AZURE_SPEECH_REGION: _r, ...env } = PROD_SERVER_ENV
    const r = checkStartupConfig('server', env)
    expect(r.fatal).toEqual([])
    expect(keys(r.degraded)).toEqual(['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'])
  })

  it('gemini 模式不要求 Azure 金鑰', () => {
    const { AZURE_SPEECH_KEY: _k, AZURE_SPEECH_REGION: _r, ...env } = PROD_SERVER_ENV
    expect(checkStartupConfig('server', { ...env, PODCAST_TTS_PROVIDER: 'gemini' }).issues).toEqual([])
  })

  it('s3 模式下缺任何一把 R2 憑證都要叫', () => {
    const { PODCAST_S3_SECRET_ACCESS_KEY: _s, ...env } = PROD_SERVER_ENV
    const r = checkStartupConfig('server', env)
    expect(keys(r.degraded)).toEqual(['PODCAST_S3_SECRET_ACCESS_KEY'])
  })

  it('local 模式不要求任何 R2 設定', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, PODCAST_STORAGE_KIND: 'local', PODCAST_S3_ENDPOINT: '', PODCAST_S3_BUCKET: '', PODCAST_S3_ACCESS_KEY_ID: '', PODCAST_S3_SECRET_ACCESS_KEY: '', PODCAST_S3_PUBLIC_BASE_URL: '' })
    expect(r.issues).toEqual([])
  })

  it('未設 PODCAST_STORAGE_KIND 時視為 local', () => {
    const {
      PODCAST_STORAGE_KIND: _k,
      PODCAST_S3_ENDPOINT: _e,
      PODCAST_S3_BUCKET: _b,
      PODCAST_S3_ACCESS_KEY_ID: _a,
      PODCAST_S3_SECRET_ACCESS_KEY: _s,
      PODCAST_S3_PUBLIC_BASE_URL: _u,
      ...env
    } = PROD_SERVER_ENV
    expect(checkStartupConfig('server', env).issues).toEqual([])
  })
})

describe('checkStartupConfig：打錯字的模式值會靜默降級，要抓出來', () => {
  it('把 PODCAST_STORAGE_KIND 拼錯會被 getPodcastStorage 靜默當成 local', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, PODCAST_STORAGE_KIND: 'S3' })
    expect(keys(r.degraded)).toEqual(['PODCAST_STORAGE_KIND'])
    expect(r.degraded[0]?.kind).toBe('contradiction')
  })

  it('把 PODCAST_TTS_PROVIDER 拼錯會被 tts.ts 靜默當成 gemini', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, PODCAST_TTS_PROVIDER: 'Azure' })
    expect(keys(r.degraded)).toEqual(['PODCAST_TTS_PROVIDER'])
    expect(r.degraded[0]?.kind).toBe('contradiction')
  })
})

describe('formatStartupConfigReport', () => {
  it('齊全時回一行 info', () => {
    const lines = formatStartupConfigReport(checkStartupConfig('server', PROD_SERVER_ENV))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.level).toBe('info')
  })

  it('fatal 與 degraded 都用 error level，訊息帶得出 key 與影響', () => {
    const { DATABASE_URL: _d, FRED_API_KEY: _f, ...env } = PROD_SERVER_ENV
    const lines = formatStartupConfigReport(checkStartupConfig('server', env))
    expect(lines.every(l => l.level === 'error')).toBe(true)
    const joined = lines.map(l => l.message).join('\n')
    expect(joined).toContain('FATAL')
    expect(joined).toContain('DATABASE_URL')
    expect(joined).toContain('DEGRADED')
    expect(joined).toContain('FRED_API_KEY')
  })

  it('訊息裡不含任何設定值', () => {
    const lines = formatStartupConfigReport(checkStartupConfig('server', { ...PROD_SERVER_ENV, PODCAST_STORAGE_KIND: 'sekrit-typo' }))
    expect(lines.map(l => l.message).join('\n')).not.toContain('sekrit-typo')
  })
})

describe('checkStartupConfig：只走 openai 時不要求 Anthropic', () => {
  it('lLM_PROVIDER=openai 且有 OPENAI_API_KEY → 不要 ANTHROPIC_API_KEY', () => {
    const r = checkStartupConfig('server', { ...PROD_SERVER_ENV, ANTHROPIC_API_KEY: '', LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k', AGENT_MODELS: 'editor:openai/x' })
    expect(r.fatal).toEqual([])
  })
})
