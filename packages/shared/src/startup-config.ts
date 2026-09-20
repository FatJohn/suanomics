// 啟動時的設定檢查：缺金鑰要在啟動當下就叫，而不是等到某次呼叫靜靜地回空。
//
// 本檔刻意是純函式（吃一份 env 快照、回一份判定），process.exit 與 console 都留在
// entrypoint。這樣清單的每一項可以在同一個 diff 裡被 review，
// 而判定本身可以離線測。
//
// 兩件設計上的事實，抄清單之前先讀：
//   1. 2026-09-04 起 HTTP 與 job 消費跑在同一個 process（原本是 api、worker 兩個
//      service、env 各一份），所以清單是兩者的聯集、不再分 service。R2 的四把寫入
//      憑證因此從「只有 worker 要」變成一律要查：同一份 env 現在兩條路徑都要走得通。
//   2. 一半的金鑰是「條件式必填」——PODCAST_STORAGE_KIND=s3 才需要 R2 那幾把、
//      PODCAST_TTS_PROVIDER=azure 才需要 Azure 兩把、AI_PROVIDER=anthropic 才需要
//      ANTHROPIC_API_KEY。所以判定要看當下設定的模式，不能無條件要求。
//
// 只做「缺」那半。「金鑰無效」（啟動時真的打一次外部 API）刻意不做：那會讓
// 「對方暫時掛掉」變成「我們起不來」，而且擋不住真正的問題形狀——firecrawl 那次的
// 金鑰是有效的，壞的是它讀錯了回應欄位。

export type StartupService = 'server'
export type ConfigSeverity = 'required' | 'optional'

/** missing = 該有的值不在；contradiction = 值在但互相矛盾，程式會靜默降級 */
export type ConfigIssueKind = 'missing' | 'contradiction'

export interface ConfigIssue {
  key: string
  severity: ConfigSeverity
  kind: ConfigIssueKind
  /** 缺了會發生什麼事，直接進 log 與 /api/ops/config-health */
  impact: string
}

export interface StartupConfigResult {
  service: StartupService
  issues: ConfigIssue[]
  /** severity === 'required'：這個 process 起來也做不了事 */
  fatal: ConfigIssue[]
  /** severity === 'optional'：服務照跑，但某條路徑是壞的 */
  degraded: ConfigIssue[]
  ok: boolean
}

export interface StartupConfigLogLine {
  level: 'error' | 'info'
  message: string
}

type EnvSnapshot = Record<string, string | undefined>

function present(env: EnvSnapshot, key: string): boolean {
  return (env[key] ?? '').trim().length > 0
}

// AGENT_MODELS 是 'agent:model' 逗號分隔。只看 model 那半有沒有 claude*，
// agent 名字剛好含 claude 不算。
function requestsClaudeModel(raw: string | undefined): boolean {
  return (raw ?? '')
    .split(',')
    .map(pair => pair.slice(pair.indexOf(':') + 1).trim().toLowerCase())
    .some(model => model.startsWith('claude'))
}

// gemini／openai 兩個「有沒有被顯式指定」的 provider 前綴，判斷邏輯獨立於
// apps/server/src/agents/providers/resolve.ts 的 parseModelSpec——packages/shared
// 不能依賴 apps/server，這裡是同一條規則的獨立實作：只有 `provider/model` 的
// provider 半剛好是已知名字才算，裸 model（例如 `gemini-3.7-flash`）不算。
type NonClaudeProvider = 'gemini' | 'openai'
const KNOWN_NON_CLAUDE_PROVIDERS: readonly NonClaudeProvider[] = ['gemini', 'openai']

function explicitProviderPrefix(rawModel: string): NonClaudeProvider | undefined {
  const idx = rawModel.indexOf('/')
  if (idx <= 0)
    return undefined
  const maybe = rawModel.slice(0, idx)
  return (KNOWN_NON_CLAUDE_PROVIDERS as readonly string[]).includes(maybe) ? maybe as NonClaudeProvider : undefined
}

function explicitProvidersInAgentModels(raw: string | undefined): Set<NonClaudeProvider> {
  const result = new Set<NonClaudeProvider>()
  for (const pair of (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf(':')
    if (idx <= 0)
      continue
    const model = pair.slice(idx + 1).trim()
    const p = explicitProviderPrefix(model)
    if (p)
      result.add(p)
  }
  return result
}

function globalProviderFromEnv(env: EnvSnapshot): NonClaudeProvider | 'anthropic' | undefined {
  const raw = (env.LLM_PROVIDER ?? '').trim().toLowerCase()
  if (raw === 'gemini' || raw === 'openai' || raw === 'anthropic')
    return raw
  return undefined
}

function agentModelsIsEmpty(raw: string | undefined): boolean {
  return !(raw ?? '').split(',').some(s => s.trim().length > 0)
}

// footgun：只換全域 provider、沒有用 AGENT_MODELS 換掉任何 agent 的 model。
// AGENT_MODEL_DEFAULTS（apps/server/src/agents/providers/resolve.ts）目前全部是
// gemini-* model 名，LLM_PROVIDER=gemini 配預設值完全正常（model 名與端點對得上），
// 但 LLM_PROVIDER=openai 配預設值會把那些 gemini-* model 名原樣送去 OpenAI 相容端點，
// 要等到第一次呼叫才因 model not found 失敗。anthropic 不在這裡判斷：它已經有自己的
// 三條件 gate（AI_PROVIDER=anthropic + ANTHROPIC_API_KEY + AGENT_MODELS 指向 claude*），
// 缺任一條就整批 fallback 回 gemini，不會把 gemini model 名送去 Anthropic 端點。
//
// 只要 AGENT_MODELS 有任何一筆（即使只覆寫了一個 agent），就當作使用者已經知道要換
// model、不重複提醒——這裡刻意照字面條件走，不去猜「換的那個 agent
// 夠不夠」。
function globalProviderModelMismatch(env: EnvSnapshot): boolean {
  return globalProviderFromEnv(env) === 'openai' && agentModelsIsEmpty(env.AGENT_MODELS)
}

// 這個組態實際會用到哪些非 anthropic provider（anthropic 走既有三條件邏輯、不重複判斷）。
//
// ★ 前提同上面 checkStartupConfig 裡「AGENT_MODELS 代表有沒有 agent 指向 claude*」那則星號
//   註解：AGENT_MODEL_DEFAULTS（apps/server/src/agents/providers/resolve.ts）目前全部是
//   gemini-* model，所以沒被 AGENT_MODELS 顯式指定 provider、也沒有全域 LLM_PROVIDER 覆蓋的
//   agent，一律解析成 gemini。哪天預設表加進非 gemini 的 model，這裡要一起改。
//
// 2026-09-10 更正：LLM_PROVIDER=anthropic 時，defaultProviderFromEnv() 會讓所有沒有顯式
// provider 前綴的 agent 一律解析成 provider==='anthropic'（不需要 model 名是 claude*，見
// resolve.ts 92-107、137-142）。這裡曾經整段跳過、當作「那些 agent 交給 anthropic 處理」
// 不查任何 key，但這只在 anthropic 三條件 gate 真的開啟時才成立——gate 沒開（AI_PROVIDER
// 不是 anthropic，或缺 ANTHROPIC_API_KEY）時 resolve.ts 137-160 會把這些 agent 全部靜默
// fallback 回 Gemini。獨立複查抓到：舊版因此對「LLM_PROVIDER=anthropic +
// gate 未開 + 有 GEMINI_API_KEY」這個能跑的組態誤判 fatal。這裡不再無條件跳過，改由呼叫端
// （checkStartupConfig）依 gate 是否真的開啟，決定要不要把 gemini 加進來。
function requestedNonClaudeProviders(env: EnvSnapshot, anthropicGateFullyOn: boolean): Set<NonClaudeProvider> {
  const result = new Set<NonClaudeProvider>(explicitProvidersInAgentModels(env.AGENT_MODELS))
  const global = globalProviderFromEnv(env)
  if (global === 'gemini' || global === 'openai')
    result.add(global)
  else if (global === undefined)
    result.add('gemini')
  else if (global === 'anthropic' && !anthropicGateFullyOn)
    result.add('gemini')
  return result
}

export function checkStartupConfig(service: StartupService, env: EnvSnapshot): StartupConfigResult {
  const issues: ConfigIssue[] = []
  const requireKey = (key: string, severity: ConfigSeverity, impact: string): void => {
    if (!present(env, key))
      issues.push({ key, severity, kind: 'missing', impact })
  }
  const contradiction = (key: string, impact: string): void => {
    issues.push({ key, severity: 'optional', kind: 'contradiction', impact })
  }

  // ── 主線：缺了整個 process 都做不了事 ──
  requireKey('DATABASE_URL', 'required', '所有資料存取都經過它；缺了每次 query 都會 throw DATABASE_URL not set')

  // route 層在 NODE_ENV=development 時本來就跳過 bearer check（internal.ts），這裡跟著跳過。
  if ((env.NODE_ENV ?? '').trim() !== 'development') {
    requireKey('INGEST_TRIGGER_SECRET', 'required', '/internal/* 會一律回 403，每日 pipeline 的排程觸發全部打不進來')
    // 不是金鑰，但形狀一樣：缺了 CORS 白名單只剩 localhost、瀏覽器端全部被擋，
    // 而 HTTP 自己完全正常。判 optional 是因為每日 pipeline 不經過瀏覽器、照跑。
    requireKey('WEB_ORIGIN', 'optional', 'CORS 白名單只剩 localhost，正式網域的瀏覽器請求全部被擋；HTTP 端點與每日 pipeline 不受影響')
  }

  // anthropic 三條件 gate 是否「真的」開啟（AI_PROVIDER=anthropic 且 ANTHROPIC_API_KEY
  // 存在）——要先算出來才知道 LLM_PROVIDER=anthropic 這個全域選擇有沒有真的生效，還是
  // 會被 resolve.ts 137-160 靜默 fallback 回 Gemini。wantsClaude／globalWantsAnthropic
  // 分別對應「AGENT_MODELS 顯式指到 claude*」與「LLM_PROVIDER=anthropic 全域覆蓋」兩條
  // 各自會讓某些 agent 解析成 provider==='anthropic' 的路徑（見 resolve.ts 125-136）。
  const anthropicGateOn = (env.AI_PROVIDER ?? '').trim().toLowerCase() === 'anthropic'
  const wantsClaude = requestsClaudeModel(env.AGENT_MODELS)
  const globalWantsAnthropic = globalProviderFromEnv(env) === 'anthropic'
  const anthropicGateFullyOn = anthropicGateOn && present(env, 'ANTHROPIC_API_KEY')
  // 只要 wantsClaude 或 globalWantsAnthropic 任一成立，就有 agent 會在 resolve.ts 解析出
  // provider==='anthropic'，因此需要三條件 gate 真的開啟才不會被靜默 fallback。
  const anthropicRouteRequested = wantsClaude || globalWantsAnthropic

  // GEMINI_API_KEY 兩條獨立用途拆開看：agent 推理（跟著這個組態實際會不會解析到
  // gemini model）與 podcast TTS（非 azure 分支才吃、只影響當天有沒有音檔）。
  // 開源後很可能有使用者只走 openai/自架、agent 那側完全不碰 gemini，這時這把 key
  // 不該擋整個 process 起不來。
  const requestedProviders = requestedNonClaudeProviders(env, anthropicGateFullyOn)
  const usesGeminiForAgents = requestedProviders.has('gemini')
  requireKey(
    'GEMINI_API_KEY',
    usesGeminiForAgents ? 'required' : 'optional',
    usesGeminiForAgents
      ? 'Cascade 有 agent 解析到 gemini model；缺了會等到第一次呼叫才 throw'
      : '目前組態沒有 agent 解析到 gemini model；podcast-tts 若非 azure 仍會用它，缺了只影響當天有沒有音檔',
  )

  // openai（自架／OpenRouter）：OPENAI_API_KEY 或 LLM_API_KEY 至少一把，缺兩把才算 required。
  if (requestedProviders.has('openai') && !present(env, 'OPENAI_API_KEY') && !present(env, 'LLM_API_KEY')) {
    issues.push({
      key: 'OPENAI_API_KEY',
      severity: 'required',
      kind: 'missing',
      impact: '目前組態有 agent 解析到 openai model，但 OPENAI_API_KEY 與 LLM_API_KEY 都沒設（設其中一把即可）；缺了會等到第一次呼叫才 throw',
    })
  }

  // 只換 provider 沒換 model 的 footgun（見 globalProviderModelMismatch 註解）。
  if (globalProviderModelMismatch(env)) {
    contradiction('LLM_PROVIDER', 'AGENT_MODEL_DEFAULTS 全部是 gemini-* model 名，只設 LLM_PROVIDER=openai 卻沒有用 AGENT_MODELS 換掉任何 agent 的 model：那些 gemini model 名會被原樣送去 OpenAI 相容端點，要等到第一次呼叫才會因 model not found 失敗')
  }

  // Anthropic 這條要三個條件一起看，只看總開關會誤叫：resolveAgentModel 的 fallback
  // 分支唯有「某個 agent 真的解析到 anthropic provider」時才會走到——這條路有兩種走法
  // （wantsClaude：AGENT_MODELS 顯式指到 claude*；globalWantsAnthropic：LLM_PROVIDER=
  // anthropic 全域覆蓋，即使 model 名不是 claude* 也會被解析成 anthropic，見 resolve.ts
  // 92-107）。總開關開著但兩者都不成立的組態，其實一個 Claude 呼叫都不會發生、原本就
  // 跑得好好的。
  //
  // ★ 這裡用 AGENT_MODELS 代表「有沒有 agent 指向 claude*」，前提是
  //   AGENT_MODEL_DEFAULTS 全是 gemini。那個前提由 resolve.test.ts 的
  //   「★ 每個 agent 待在它現在的 model 都要有理由（換之前先回答為什麼）」守著；
  //   哪天預設表加進 claude* model，這裡要一起改。
  //
  // ★ 2026-09-10 更正：舊版只看 wantsClaude，漏了 globalWantsAnthropic 這條路——
  //   LLM_PROVIDER=anthropic + gate 未開的組態，舊版誤判成「保底」fatal（見下面已移除
  //   的 requestedProviders.size===0 分支），但 resolveAgentModel 實際上會把所有 agent
  //   靜默 fallback 回 Gemini、pipeline 跑得動，真正需要的是 GEMINI_API_KEY（已經在上面
  //   requestedNonClaudeProviders 反映），這裡只需要用 contradiction（不擋啟動）出聲，
  //   不該再額外 fatal 掉 LLM_PROVIDER 本身。
  if (anthropicGateOn && anthropicRouteRequested) {
    // 這個組合下 resolveAgentModel 會靜默 fallback 回 Gemini、只留一行 log。
    // 帳單與品質都變了而沒有人會知道，所以在啟動時擋下來。
    requireKey('ANTHROPIC_API_KEY', 'required', 'AI_PROVIDER=anthropic 且有 agent 會解析到 anthropic（AGENT_MODELS 指向 claude*，或 LLM_PROVIDER=anthropic 全域覆蓋），卻沒有金鑰：resolveAgentModel 會靜默 fallback 回 Gemini，換了 provider 而沒有人會知道')
  }
  else if (anthropicGateOn) {
    contradiction('AI_PROVIDER', '總開關開到 anthropic，但沒有任何 agent 會解析到 anthropic model（沒有 claude* 覆寫、LLM_PROVIDER 也不是 anthropic）：實際上一個 Claude 呼叫都不會發生')
  }
  else if (wantsClaude) {
    // 這是 .env.example 明寫的「零 Claude 花費」測試安全設計，不是錯誤，
    // 但它確實讓那些 agent 跑在別的 model 上，值得出聲。完整脈絡見
    // docs/architecture/configuration.md「LLM provider 與 model 路由」。
    contradiction('AI_PROVIDER', 'AGENT_MODELS 指定了 claude* model，但總開關沒開到 anthropic：那些 agent 會靜默 fallback 回 Gemini')
  }
  else if (globalWantsAnthropic) {
    // 同上一支的鏡像：LLM_PROVIDER=anthropic 但總開關沒開，不是「整個 pipeline 跑不了」
    // （已由上面 requestedNonClaudeProviders 把 gemini 標成需要的 key），只是使用者要的
    // anthropic 沒有真的生效，值得出聲但不擋啟動。
    contradiction('LLM_PROVIDER', 'LLM_PROVIDER=anthropic，但總開關 AI_PROVIDER 未開到 anthropic（或缺 ANTHROPIC_API_KEY）：resolveAgentModel 會把所有沒有顯式 provider 前綴的 agent 靜默 fallback 回 Gemini，並非整個 pipeline 都跑不動')
  }

  requireKey('FRED_API_KEY', 'optional', 'FRED 序列（CPI、實質利率等）會全部拿不到，market-data 的 TWSE 那半照跑')

  const ttsProvider = (env.PODCAST_TTS_PROVIDER ?? '').trim()
  if (ttsProvider === 'azure') {
    requireKey('AZURE_SPEECH_KEY', 'optional', 'podcast-tts 會在呼叫當下 throw，當天沒有音檔')
    requireKey('AZURE_SPEECH_REGION', 'optional', 'podcast-tts 會在呼叫當下 throw，當天沒有音檔')
  }
  else if (ttsProvider !== '' && ttsProvider !== 'gemini') {
    contradiction('PODCAST_TTS_PROVIDER', '值既不是 azure 也不是 gemini，tts.ts 會靜默走 Gemini（大小寫也算，它是嚴格比對）')
  }

  // ── 音檔儲存：讀（/audio 的 urlFor）與寫（podcast-tts 的 PUT）現在同一個 process ──
  // 分成兩個 service 的年代，線上 api 那四把寫入憑證是空的、那不是故障；合併之後
  // 同一份 env 要同時支撐兩條路徑，所以五把一起查。REGION 不查（storage 層預設 'auto'）。
  const storageKind = (env.PODCAST_STORAGE_KIND ?? 'local').trim()
  if (storageKind === 's3') {
    requireKey('PODCAST_S3_PUBLIC_BASE_URL', 'optional', 'getPodcastStorage 會 throw，/audio 每一次請求都 500、podcast-tts 也存不了音檔')
    for (const key of ['PODCAST_S3_ENDPOINT', 'PODCAST_S3_BUCKET', 'PODCAST_S3_ACCESS_KEY_ID', 'PODCAST_S3_SECRET_ACCESS_KEY']) {
      requireKey(key, 'optional', '讀成空字串後仍會照常送出簽名請求，R2 端才拒絕；音檔上不去')
    }
  }
  else if (storageKind !== 'local') {
    contradiction('PODCAST_STORAGE_KIND', '值既不是 s3 也不是 local，getPodcastStorage 會靜默退回本地磁碟；容器重啟或 redeploy 就整批消失')
  }

  const fatal = issues.filter(i => i.severity === 'required')
  const degraded = issues.filter(i => i.severity === 'optional')
  return { service, issues, fatal, degraded, ok: issues.length === 0 }
}

// 刻意只印 key 名與影響、不印任何設定值：這些行會落在容器 log 與 /api/ops/config-health，
// 兩個地方都不該出現金鑰內容。
export function formatStartupConfigReport(result: StartupConfigResult): StartupConfigLogLine[] {
  if (result.ok)
    return [{ level: 'info', message: `[startup-config] ${result.service} 設定檢查通過` }]

  const label = (issue: ConfigIssue): string => {
    const tier = issue.severity === 'required' ? 'FATAL' : 'DEGRADED'
    const what = issue.kind === 'missing' ? '缺少設定' : '設定互相矛盾'
    return `${tier} ${what}`
  }
  return result.issues.map(issue => ({
    level: 'error' as const,
    message: `[startup-config] ${label(issue)} ${result.service}.${issue.key}：${issue.impact}`,
  }))
}
