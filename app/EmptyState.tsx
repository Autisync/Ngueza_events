import type { ReactNode } from 'react'
import styles from './empty-state.module.css'

/**
 * One visual language for "nothing here yet" across the app — the
 * homepage's no-featured-suppliers notice and /procurar's no-results
 * notice both mean the same thing (this zona/categoria isn't covered
 * yet), so they get the same mark: a map pin with two staggered
 * expanding rings, not a second, unrelated illustration per surface.
 *
 * Pure CSS/SVG, so it costs nothing extra over the network regardless
 * of connection speed, and the global prefers-reduced-motion freeze in
 * globals.css already covers it — no separate guard needed here.
 */
export function EmptyState({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.icon} aria-hidden="true">
        <span className={styles.ping} />
        <span className={styles.ping} />
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z" />
          <circle cx="12" cy="9.5" r="2.5" />
        </svg>
      </div>
      {title ? <h2 className={styles.title}>{title}</h2> : null}
      <div className={styles.body}>{children}</div>
    </div>
  )
}
