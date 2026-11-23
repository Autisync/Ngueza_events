import type { CategoryOption } from '@/lib/categories'
import { groupByRoot } from '@/lib/categories'

/**
 * The `<option>`s of a category `<select>`, one `<optgroup>` per vertical
 * (slice 52). A server component: no JavaScript reaches the browser.
 *
 * `current` keeps a value that is no longer offered (its category was
 * retired, or is a heading) selectable and selected. Without it the
 * browser silently selects the first option, and saving an unrelated
 * field would move the listing or service to another category.
 *
 * `wholeVertical` adds a "Tudo em <vertical>" option whose value is the
 * root, for searches and requests that may name a whole vertical.
 */
export function CategoryOptions({
  options,
  current,
  currentLabel = 'Categoria actual (já não disponível)',
  wholeVertical,
}: {
  options: CategoryOption[]
  current?: { id: string; name: string } | null
  currentLabel?: string
  wholeVertical?: (rootId: string) => boolean
}) {
  const groups = groupByRoot(options)
  const offered = new Set(options.map((o) => o.id))
  const stale = current && !offered.has(current.id) && !groups.some((g) => g.rootId === current.id && wholeVertical?.(g.rootId))
  return (
    <>
      {stale ? (
        <optgroup label={currentLabel}>
          <option value={current.id}>{current.name}</option>
        </optgroup>
      ) : null}
      {groups.map((g) => (
        <optgroup key={g.rootId} label={g.rootName}>
          {wholeVertical?.(g.rootId) ? (
            <option value={g.rootId}>Tudo em {g.rootName}</option>
          ) : null}
          {g.options.filter((o) => o.id !== g.rootId).map((o) => (
            <option key={o.id} value={o.id}>{o.depth > 1 ? ` ${o.name}` : o.name}</option>
          ))}
          {/* A root with no children is itself the only thing to pick. */}
          {g.options.length === 1 && g.options[0]!.id === g.rootId && !wholeVertical?.(g.rootId) ? (
            <option value={g.rootId}>{g.rootName}</option>
          ) : null}
        </optgroup>
      ))}
    </>
  )
}
