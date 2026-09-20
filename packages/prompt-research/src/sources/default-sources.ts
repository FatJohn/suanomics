import type { SourceSpec } from '../types.js'

export const DEFAULT_SOURCES: SourceSpec[] = [
  {
    kind: 'skill-markdown',
    slug: 'skill-financial-analyst',
    displayName: 'Claude Finance Plugin – Financial Analyst',
    pipeline: 'light',
    config: {
      repoOwner: 'alirezarezvani',
      repoName: 'claude-skills',
      skillPath: 'finance/financial-analyst/SKILL.md',
      ref: 'main',
    },
  },
  {
    kind: 'skill-markdown',
    slug: 'skill-business-investment-advisor',
    displayName: 'Claude Finance Plugin – Business Investment Advisor',
    pipeline: 'light',
    config: {
      repoOwner: 'alirezarezvani',
      repoName: 'claude-skills',
      skillPath: 'finance/business-investment-advisor/SKILL.md',
      ref: 'main',
    },
  },
  {
    kind: 'skill-markdown',
    slug: 'skill-saas-metrics-coach',
    displayName: 'Claude Finance Plugin – SaaS Metrics Coach',
    pipeline: 'light',
    config: {
      repoOwner: 'alirezarezvani',
      repoName: 'claude-skills',
      skillPath: 'finance/saas-metrics-coach/SKILL.md',
      ref: 'main',
    },
  },
]
