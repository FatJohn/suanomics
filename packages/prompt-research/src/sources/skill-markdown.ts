export interface SkillFetchConfig {
  repoOwner: string
  repoName: string
  skillPath: string
  ref: string
}

export interface SkillFetchResult {
  content: string
  url: string
}

export function buildRawGithubUrl(config: SkillFetchConfig): string {
  const path = config.skillPath.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${config.repoOwner}/${config.repoName}/${config.ref}/${path}`
}

export async function fetchSkillMarkdown(
  config: SkillFetchConfig,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<SkillFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = buildRawGithubUrl(config)
  const res = await fetchImpl(url, {
    headers: { 'user-agent': 'suanomics-prompt-research/1.0' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok)
    throw new Error(`skill fetch HTTP ${res.status}: ${await res.text()}`)
  const content = await res.text()
  return { content, url }
}
