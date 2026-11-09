interface Env {
  GITHUB_DISPATCH_TOKEN: string
}

const DISPATCH_URL = 'https://api.github.com/repos/FatJohn/suanomics/actions/workflows/daily.yml/dispatches'

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const response = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        // GitHub API 會拒絕沒有 User-Agent 的請求，Workers 的 fetch 不會自動帶。
        'User-Agent': 'suanomics-trigger',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'rewrite' }),
    })
    if (!response.ok)
      throw new Error(`workflow_dispatch 失敗：${response.status} ${await response.text()}`)
  },
}
