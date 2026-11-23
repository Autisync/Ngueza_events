import type { CategoryOption } from '@/lib/categories'
import { groupByRoot } from '@/lib/categories'

/**
 * The `<option>`s of a category `<select>`, one `<optgroup>` per vertical
 * (slice 52). A server component: no JavaScript reaches the browser.
 *
 * Every option passed is rendered. A root in `options` (a vertical that is
 * itself pickable, or a heading a search page offers) is the first option
 * of its group, labelled "Tudo em <vertical>" when `wholeVertical` says so.
 *
 * `current` keeps a value that is not among the options (its category was
 * retired, or is a heading) selectable and selected. Without it the
 * browser silently selects the first option, and saving an unrelated
 * field would move the listing or service to another category.
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
  const stale = current && !options.some((o) => o.id === current.id)
  return (
    <>
      {stale ? (
        <optgroup label={currentLabel}>
          <option value={current.id}>{current.name}</option>
        </optgroup>
      ) : null}
      {groups.map((g) => (
        <optgroup key={g.rootId} label={g.rootName}>
          {g.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id === g.rootId
                ? (wholeVertical?.(g.rootId) ? `Tudo em ${g.rootName}` : g.rootName)
                : o.depth > 1 ? ` ${o.name}` : o.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}
