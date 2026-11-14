import { Icon } from '@/app/SiteHeader'
import { dateTile } from '@/lib/booking-labels'
import styles from './dash.module.css'

/**
 * The pieces every dashboard page is built from (slice 50). Server
 * components only; no client JavaScript.
 *
 * Charts follow the dataviz rules: one hue (blue) for magnitude, a meter
 * for one ratio against a limit, bars at most 24 px with a 4 px rounded
 * data end, a hairline grid, text in text colours and never in the series
 * colour, a native SVG <title> per mark and a hidden table with the same
 * numbers for screen readers.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function PageHead({
  title, sub, crumb, actions,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  crumb?: { href: string; label: string }
  actions?: React.ReactNode
}) {
  return (
    <div className={styles.head}>
      <div className={styles.headText}>
        {crumb ? <a className={styles.crumb} href={crumb.href}>← {crumb.label}</a> : null}
        <h1 className={styles.title}>{title}</h1>
        {sub ? <p className={styles.sub}>{sub}</p> : null}
      </div>
      {actions ? <div className={styles.headActions}>{actions}</div> : null}
    </div>
  )
}

export function Grid({ kind, children }: { kind: 'stats' | 'stats5' | 'wideNarrow' | 'halves' | 'thirds' | 'one'; children: React.ReactNode }) {
  return <div className={cx(styles.grid, kind !== 'one' && styles[kind])}>{children}</div>
}

export function Card({
  title, count, action, note, id, className, children,
}: {
  title?: React.ReactNode
  count?: number
  action?: { href: string; label: string }
  note?: React.ReactNode
  id?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cx(styles.card, className)} id={id} aria-labelledby={id && title ? `${id}-titulo` : undefined}>
      {title || action ? (
        <div className={styles.cardHead}>
          {title ? (
            <h2 className={styles.cardTitle} id={id ? `${id}-titulo` : undefined}>
              {title}
              {count !== undefined ? <span className={styles.cardTag}>{count}</span> : null}
            </h2>
          ) : <span />}
          {action ? <a className={styles.seeAll} href={action.href}>{action.label}</a> : null}
        </div>
      ) : null}
      {note ? <p className={styles.note}>{note}</p> : null}
      {children}
    </section>
  )
}

/** A headline number with its icon. `hot` when something waits on the reader. */
export function Stat({
  icon, label, value, note, hot, href,
}: {
  icon: string
  label: string
  value: React.ReactNode
  note?: React.ReactNode
  hot?: boolean
  href?: string
}) {
  const body = (
    <>
      <span className={styles.statIcon}><Icon name={icon} size={22} /></span>
      <span className={styles.statBody}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statValue}>{value}</span>
        {note ? <span className={styles.statNote}>{note}</span> : null}
      </span>
    </>
  )
  const cls = cx(styles.card, styles.stat, hot && styles.statHot)
  return href ? <a className={cls} href={href}>{body}</a> : <div className={cls}>{body}</div>
}

/**
 * One ratio against its limit. The fill carries severity: blue normally,
 * warning past `warnAt`, danger past 100 %. The caller always prints the
 * figures beside it, so the state never relies on colour alone.
 */
export function Meter({
  pct, label, warnAt = 90, thin,
}: {
  pct: number | null
  label: string
  warnAt?: number
  thin?: boolean
}) {
  const value = pct ?? 0
  const tone = value > 100 ? styles.meterBad : value >= warnAt ? styles.meterWarn : null
  return (
    <span className={cx(styles.meter, tone, thin && styles.meterThin)} role="meter"
          aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(value, 100)}
          aria-valuetext={pct === null ? 'sem limite definido' : `${value}%`}>
      <span className={styles.meterFill} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </span>
  )
}

/** A progress ring: one ratio, the reference dashboards' "90 %" disc. */
export function Ring({ pct, label, size = 132 }: { pct: number; label: string; size?: number }) {
  const stroke = 12
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(Math.max(pct, 0), 100)
  return (
    <div className={styles.ring} style={{ width: size, height: size }} role="img" aria-label={`${label}: ${clamped}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className={styles.ringTrack} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        {clamped > 0 ? (
          <circle className={styles.ringFill} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
                  strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)} />
        ) : null}
      </svg>
      <span className={styles.ringText} aria-hidden="true">
        <span className={styles.ringPct}>{clamped}%</span>
        <span className={styles.ringLabel}>{label}</span>
      </span>
    </div>
  )
}

export type PillTone = 'neutral' | 'info' | 'good' | 'warn' | 'bad'
export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: React.ReactNode }) {
  const t = { neutral: null, info: styles.pillInfo, good: styles.pillGood, warn: styles.pillWarn, bad: styles.pillBad }[tone]
  return <span className={cx(styles.pill, t)}>{children}</span>
}

export function DateTile({ at }: { at: string | Date }) {
  const t = dateTile(at)
  return <span className={styles.dateTile} aria-hidden="true"><b>{t.day}</b><span>{t.month}</span></span>
}

export function Empty({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}><Icon name={icon} size={22} /></span>
      {children}
    </div>
  )
}

// ---- charts ----------------------------------------------------------------

/** A clean top for the y axis: 1, 2 or 5 × a power of ten, at least 4. */
export function niceMax(max: number): number {
  if (max <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 5, 10]) if (m * pow >= max) return m * pow
  return 10 * pow
}

/** A bar path with a 4 px rounded data end and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export interface Column {
  /** Under the bar ("jun"). */
  label: string
  /** In the tooltip and the table ("Junho de 2031"). */
  long: string
  value: number
  /** Drawn bold: "now". */
  current?: boolean
  /** Drawn in the lighter step: still to happen. */
  soft?: boolean
}

/**
 * Columns over time, one series. Labels: the axis carries the values, and
 * only the tallest column and the current one print theirs (never a number
 * on every bar). A hidden table carries all of them.
 */
export function Columns({
  data, caption, unit, legend,
}: {
  data: Column[]
  caption: string
  unit: (n: number) => string
  legend?: { solid: string; soft: string }
}) {
  const W = 640, H = 230, left = 34, bottom = 26, top = 18
  const plotW = W - left - 6
  const plotH = H - top - bottom
  const max = niceMax(Math.max(...data.map((d) => d.value), 0))
  const band = plotW / data.length
  const barW = Math.min(24, band * 0.56)
  const ticks = [0, max / 2, max]
  const tallest = Math.max(...data.map((d) => d.value))

  return (
    <figure style={{ margin: 0 }}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {ticks.map((t) => {
          const y = top + plotH - (t / max) * plotH
          return (
            <g key={t}>
              <line className={styles.chartGrid} x1={left} x2={W - 4} y1={y} y2={y} />
              <text className={styles.chartAxis} x={left - 8} y={y + 4} textAnchor="end">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * plotH
          const x = left + i * band + (band - barW) / 2
          const y = top + plotH - h
          const showValue = d.value > 0 && (d.current || d.value === tallest)
          return (
            <g key={d.long}>
              {h > 0 ? (
                <path className={d.soft ? styles.chartBarSoft : styles.chartBar} d={columnPath(x, y, barW, h)}>
                  <title>{`${d.long}: ${unit(d.value)}`}</title>
                </path>
              ) : null}
              {showValue ? (
                <text className={styles.chartValue} x={x + barW / 2} y={y - 6} textAnchor="middle">{d.value}</text>
              ) : null}
              <text className={`${styles.chartAxis} ${d.current ? styles.chartAxisNow : ''}`}
                    x={x + barW / 2} y={H - 8} textAnchor="middle">{d.label}</text>
            </g>
          )
        })}
      </svg>
      {legend ? (
        <ul className={styles.legend} aria-hidden="true">
          <li><span className={styles.swatch} />{legend.solid}</li>
          <li><span className={`${styles.swatch} ${styles.swatchSoft}`} />{legend.soft}</li>
        </ul>
      ) : null}
      <table className={styles.srOnly}>
        <caption>{caption}</caption>
        <tbody>
          {data.map((d) => <tr key={d.long}><th scope="row">{d.long}</th><td>{unit(d.value)}</td></tr>)}
        </tbody>
      </table>
    </figure>
  )
}

/**
 * Parts compared with each other: ranked horizontal bars, one hue,
 * largest first, the figure printed at the end of each row. HTML, so the
 * names and numbers are ordinary text for every reader.
 */
export function Ranked({ data, unit }: { data: { key: string; label: string; value: number }[]; unit: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <ul className={styles.ranked}>
      {data.map((d) => (
        <li className={styles.rankedRow} key={d.key}>
          <span className={styles.rankedName}>{d.label}</span>
          <span className={styles.rankedValue}>{unit(d.value)}</span>
          <span className={styles.rankedTrack} aria-hidden="true">
            {d.value > 0 ? <span className={styles.rankedBar} style={{ width: `${(d.value / max) * 100}%` }} /> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The shape of a dashboard page while its data loads (loading.tsx). */
export function DashSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className={styles.srOnly}>A carregar…</span>
      <span className={`${styles.skel} ${styles.skelTitle}`} />
      <span className={`${styles.skel} ${styles.skelLine}`} />
      <div className={`${styles.grid} ${styles.stats}`}>
        {[0, 1, 2, 3].map((i) => <div className={styles.card} key={i}><span className={`${styles.skel} ${styles.skelStat}`} /></div>)}
      </div>
      <div className={`${styles.grid} ${styles.wideNarrow}`}>
        <div className={styles.card}><span className={`${styles.skel} ${styles.skelCard}`} /></div>
        <div className={styles.card}><span className={`${styles.skel} ${styles.skelCard}`} /></div>
      </div>
    </div>
  )
}

export { styles as dash }
