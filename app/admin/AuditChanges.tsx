/**
 * One audit row's change, as text. Most rows are an update (`before` and
 * `after` hold the columns that changed). Since slice 52 a row can also
 * record a creation (`after.created`) or a removal, such as a category
 * cross-listing taken away (`after` empty), so both sides are read.
 */
export function AuditChanges({
  before, after,
}: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const b = before ?? {}
  const a = after ?? {}
  if (a.created === true) {
    const fields = Object.entries(a).filter(([k]) => k !== 'created')
    return <span>criado: {fields.map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ')} </span>
  }
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
  return (
    <>
      {keys.map((k) => (
        <span key={k}>
          {k}: {k in b ? JSON.stringify(b[k]) : '—'} → {k in a ? JSON.stringify(a[k]) : 'removido'}{' '}
        </span>
      ))}
    </>
  )
}
