import next from 'eslint-config-next'

// eslint-config-next 16 exports the flat config array directly — it used
// to export a function that returned one. Spreading `next()` throws
// "next is not a function" now; spread the array itself.
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**'] },
  ...next,
  {
    rules: {
      // CLAUDE.md forbidden list, where a linter can see it.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Number'], CallExpression[callee.name='parseFloat']",
          message: 'Money is bigint cêntimos. Use lib/money.ts, never float parsing.',
        },
        {
          // Number(totalMinor), Number(row.price_minor), Number(item.fee)…
          // The name says money; a JS number loses cêntimos past 2^53 and
          // invites `* qty` in floats. Counts read from SQL as ::int need
          // no Number() at all.
          selector:
            "CallExpression[callee.name='Number'] > Identifier.arguments[name=/minor|price|amount|fee|budget|deposit|shipping/i], " +
            "CallExpression[callee.name='Number'] > MemberExpression.arguments > Identifier.property[name=/minor|price|amount|fee|budget|deposit|shipping/i]",
          message:
            'This looks like money. Keep it bigint: BigInt(value), and sumMinor/multiplyMinor from lib/money.ts for arithmetic.',
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

export default config
