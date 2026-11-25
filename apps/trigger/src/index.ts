interface Env {
  GITHUB_DISPATCH_TOKEN: string
}

interface ScheduledController {
  cron: string
  scheduledTime: number
}

interface WorkflowRun {
  status: string
  conclusion: string | null
}

const WORKFLOW_URL = 'https://api.github.com/repos/FatJohn/suanomics/actions/workflows/daily.yml'
// 與 wrangler.toml 的第二個 crons 一致。GitHub 的 schedule 實測延到開盤後，開盤前的備援只能靠這裡（#107）。
const BACKUP_CRON = '40 21 * * *'
// 回推到 05:00 主觸發之前，查得到主觸發建立的 run。
const LOOKBACK_MS = 45 * 60 * 1000
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 30 * 1000

function githubHeaders(env: Env): Record<string, string> {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
    // GitHub API 會拒絕沒有 User-Agent 的請求，Workers 的 fetch 不會自動帶。
    'User-Agent': 'suanomics-trigger',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function dispatch(env: Env): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await fetch(`${WORKFLOW_URL}/dispatches`, {
        method: 'POST',
        headers: githubHeaders(env),
        body: JSON.stringify({ ref: 'main' }),
      })
    }
    catch (error) {
      if (attempt >= MAX_ATTEMPTS)
        throw error
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
      continue
    }
    if (response.ok)
      return
    if (response.status < 500 || attempt >= MAX_ATTEMPTS)
      throw new Error(`workflow_dispatch 失敗：${response.status} ${await response.text()}`)
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
  }
}

async function hasLiveOrSucceededRun(env: Env, since: Date): Promise<boolean> {
  const query = new URLSearchParams({ created: `>=${since.toISOString()}`, per_page: '100' })
  try {
    const response = await fetch(`${WORKFLOW_URL}/runs?${query}`, { method: 'GET', headers: githubHeaders(env) })
    if (!response.ok)
      return false
    const body = await response.json() as { workflow_runs: WorkflowRun[] }
    return body.workflow_runs.some(run => run.status !== 'completed' || run.conclusion === 'success')
  }
  catch {
    return false
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === BACKUP_CRON) {
      // 查詢失敗也 dispatch：多跑一次會在 pipeline 的 already-exists 結束，漏掉則開盤前沒有報告。
      if (await hasLiveOrSucceededRun(env, new Date(controller.scheduledTime - LOOKBACK_MS)))
        return
    }
    await dispatch(env)
  },
}
