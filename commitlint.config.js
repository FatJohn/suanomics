/**
 * commitlint config — 強制 conventional commit + [STRUCTURAL] | [BEHAVIORAL] tag
 */
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'must-have-structural-or-behavioral-tag': ({ raw }) => {
          const hasTag = /\[(?:STRUCTURAL|BEHAVIORAL)\]/.test(raw)
          return [
            hasTag,
            'Commit message must contain [STRUCTURAL] or [BEHAVIORAL] tag in subject or body',
          ]
        },
      },
    },
  ],
  rules: {
    'header-max-length': [2, 'always', 72],
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'build', 'ci'],
    ],
    'subject-case': [0],
    'must-have-structural-or-behavioral-tag': [2, 'always'],
  },
}
