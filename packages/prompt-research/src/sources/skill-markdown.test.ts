import { describe, expect, it, vi } from 'vitest'
import { buildRawGithubUrl, fetchSkillMarkdown } from './skill-markdown.js'

describe('buildRawGithubUrl', () => {
  it('composes raw.githubusercontent.com URL', () => {
    const url = buildRawGithubUrl({
      repoOwner: 'alirezarezvani',
      repoName: 'claude-skills',
      skillPath: 'finance/financial-analyst/SKILL.md',
      ref: 'main',
    })
    expect(url).toBe(
      'https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/finance/financial-analyst/SKILL.md',
    )
  })

  it('uRL-encodes spaces in path', () => {
    const url = buildRawGithubUrl({
      repoOwner: 'a',
      repoName: 'b',
      skillPath: 'with space/SKILL.md',
      ref: 'main',
    })
    expect(url).toContain('with%20space/SKILL.md')
  })
})

describe('fetchSkillMarkdown', () => {
  it('returns content from fetch response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# Hi',
    }) as unknown as typeof fetch
    const result = await fetchSkillMarkdown(
      { repoOwner: 'a', repoName: 'b', skillPath: 'c.md', ref: 'main' },
      { fetchImpl: fakeFetch },
    )
    expect(result.content).toBe('# Hi')
    expect(result.url).toContain('raw.githubusercontent.com')
  })

  it('throws on non-2xx', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    }) as unknown as typeof fetch
    await expect(fetchSkillMarkdown(
      { repoOwner: 'a', repoName: 'b', skillPath: 'c.md', ref: 'main' },
      { fetchImpl: fakeFetch },
    )).rejects.toThrow(/404/)
  })
})
