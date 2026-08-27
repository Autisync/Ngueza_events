import next from 'eslint-config-next'

export default [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**'] },
  ...next(),
  {
    rules: {
      // CLAUDE.md forbidden list, where a linter can see it.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Number'], CallExpression[callee.name='parseFloat']",
          message: 'Money is bigint cêntimos. Use lib/money.ts, never float parsing.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/db'],
              importNames: ['asSystem'],
              message:
                'asSystem bypasses RLS. Use it only in webhooks and scheduled jobs, never in a browser path.',
            },
          ],
        },
      ],
    },
  },
  {
    // Server-side modules legitimately need the service role.
    files: ['lib/**', 'app/api/**', 'scripts/**', 'tests/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
]
