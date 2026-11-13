import type { Metadata } from 'next'
import { adminProfile } from '../guard'
import { queueCounts } from '@/lib/admin'
import { allEventTypes, planningOptions } from '@/lib/event-plans'
import { bpToPercent } from '@/lib/event-plan-math'
import { Card, Grid, Pill, dash } from '@/app/dash/parts'
import { Chrome } from '../Chrome'
import { doSaveEventType, doSaveEventTypeNeed } from '../event-type-actions'
import styles from '../admin.module.css'

export const metadata: Metadata = { title: 'Tipos de evento', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  dados: 'Verifique os dados: o nome precisa de pelo menos 2 letras.',
  necessidade: 'Verifique a necessidade: nome, parte do orçamento (0 a 100) e semanas (0 a 104).',
  repetido: 'Já existe um tipo ou uma necessidade com esse nome.',
}

/**
 * The event planner's lists (slice 50): what kinds of event clients can
 * plan, and what each one usually needs, with its share of the budget and
 * how many weeks ahead to book it. Rows, like categories (CLAUDE.md).
 */
export default async function TiposDeEvento({
  searchParams,
}: { searchParams: Promise<{ guardado?: string; erro?: string }> }) {
  const profile = await adminProfile()
  const [counts, types, { categories }, flags] = await Promise.all([
    queueCounts(profile.id), allEventTypes(profile.id), planningOptions(), searchParams,
  ])

  return (
    <main>
      <Chrome title="Tipos de evento" active="tipos" counts={counts} />
      <div className={styles.wrap}>
        {flags.guardado ? <p className={`${dash.alert} ${dash.alertOk}`} role="status">Guardado.</p> : null}
        {flags.erro ? <p className={dash.alert} role="alert">{ERRORS[flags.erro] ?? ERRORS.dados}</p> : null}

        <p className={dash.note} style={{ margin: '0 0 18px', maxWidth: '75ch' }}>
          Quando um cliente planeia um evento, recebe a lista de necessidades do tipo que escolheu, com
          uma estimativa de custo (o orçamento × a parte) e a data até à qual deve reservar (a data do
          evento menos as semanas). As partes de cada tipo devem somar 100 %, contando os imprevistos.
          Alterações aqui valem para os planos novos; os já criados não mudam.
        </p>

        {types.map((t) => {
          const total = t.needs.filter((n) => n.isActive).reduce((s, n) => s + n.budgetShareBp, 0)
          return (
            <Grid kind="one" key={t.id}>
              <Card id={`tipo-${t.id}`} title={<>{t.name} {t.isActive ? null : <Pill>Retirado</Pill>}</>}>
                <form action={doSaveEventType} className={dash.rowForm} style={{ borderTop: 0 }}>
                  <input type="hidden" name="id" value={t.id} />
                  <label className={`${dash.field} ${dash.wide}`}>
                    <span className={dash.label}>Nome</span>
                    <input className={dash.input} name="nome" defaultValue={t.name} maxLength={60} required />
                  </label>
                  <label className={`${dash.field} ${dash.wide}`}>
                    <span className={dash.label}>Descrição</span>
                    <input className={dash.input} name="descricao" defaultValue={t.description ?? ''} maxLength={200} />
                  </label>
                  <span />
                  <span />
                  <label className={dash.field}>
                    <span className={dash.label}>Ordem</span>
                    <input className={dash.input} name="ordem" inputMode="numeric" defaultValue={t.sortOrder} />
                  </label>
                  <label className={dash.check}><input type="checkbox" name="activo" defaultChecked={t.isActive} />Activo</label>
                  <button className={`${dash.btn} ${dash.btnGhost} ${dash.btnSm}`} type="submit">Guardar tipo</button>
                </form>

                <h3 style={{ fontSize: '0.95rem', margin: '18px 0 2px' }}>
                  Necessidades{' '}
                  <span className={total === 10_000 ? dash.sumOk : dash.sumOff}>
                    · as partes somam {bpToPercent(total)} %{total === 10_000 ? '' : ' (deviam somar 100 %)'}
                  </span>
                </h3>
                {t.needs.map((n) => (
                  <form action={doSaveEventTypeNeed} className={dash.rowForm} key={n.id}>
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="tipo" value={t.id} />
                    <label className={`${dash.field} ${dash.wide}`}>
                      <span className={dash.label}>Necessidade</span>
                      <input className={dash.input} name="nome" defaultValue={n.name} maxLength={80} required />
                    </label>
                    <label className={`${dash.field} ${dash.wide}`}>
                      <span className={dash.label}>Categoria na NGUEZA</span>
                      <select className={dash.input} name="categoria" defaultValue={n.categoryId ?? ''}>
                        <option value="">Nenhuma</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label className={dash.field}>
                      <span className={dash.label}>Parte (%)</span>
                      <input className={dash.input} name="parte" inputMode="decimal" defaultValue={bpToPercent(n.budgetShareBp)} />
                    </label>
                    <label className={dash.field}>
                      <span className={dash.label}>Semanas</span>
                      <input className={dash.input} name="semanas" inputMode="numeric" defaultValue={n.weeksBefore} />
                    </label>
                    <label className={dash.field}>
                      <span className={dash.label}>Ordem</span>
                      <input className={dash.input} name="ordem" inputMode="numeric" defaultValue={n.sortOrder} />
                    </label>
                    <label className={dash.check}><input type="checkbox" name="activo" defaultChecked={n.isActive} />Activa</label>
                    <button className={`${dash.btn} ${dash.btnGhost} ${dash.btnSm}`} type="submit">Guardar</button>
                  </form>
                ))}

                <form action={doSaveEventTypeNeed} className={dash.rowForm}>
                  <input type="hidden" name="tipo" value={t.id} />
                  <label className={`${dash.field} ${dash.wide}`}>
                    <span className={dash.label}>Nova necessidade</span>
                    <input className={dash.input} name="nome" maxLength={80} required placeholder="Por exemplo: Transporte" />
                  </label>
                  <label className={`${dash.field} ${dash.wide}`}>
                    <span className={dash.label}>Categoria na NGUEZA</span>
                    <select className={dash.input} name="categoria" defaultValue="">
                      <option value="">Nenhuma</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className={dash.field}>
                    <span className={dash.label}>Parte (%)</span>
                    <input className={dash.input} name="parte" inputMode="decimal" placeholder="5" />
                  </label>
                  <label className={dash.field}>
                    <span className={dash.label}>Semanas</span>
                    <input className={dash.input} name="semanas" inputMode="numeric" placeholder="4" />
                  </label>
                  <label className={dash.field}>
                    <span className={dash.label}>Ordem</span>
                    <input className={dash.input} name="ordem" inputMode="numeric" placeholder="500" />
                  </label>
                  <span />
                  <button className={`${dash.btn} ${dash.btnPrimary} ${dash.btnSm}`} type="submit">Acrescentar</button>
                </form>
              </Card>
            </Grid>
          )
        })}

        <Grid kind="one">
          <Card title="Novo tipo de evento" note="Depois de criado, acrescente-lhe as necessidades.">
            <form action={doSaveEventType} className={dash.form}>
              <div className={dash.fields}>
                <label className={dash.field}>
                  <span className={dash.label}>Nome</span>
                  <input className={dash.input} name="nome" maxLength={60} required placeholder="Festa de finalistas" />
                </label>
                <label className={dash.field}>
                  <span className={dash.label}>Ordem</span>
                  <input className={dash.input} name="ordem" inputMode="numeric" placeholder="80" />
                </label>
                <label className={`${dash.field} ${dash.fieldWide}`}>
                  <span className={dash.label}>Descrição</span>
                  <input className={dash.input} name="descricao" maxLength={200} />
                </label>
              </div>
              <div className={dash.headActions}>
                <button className={`${dash.btn} ${dash.btnPrimary} ${dash.btnSm}`} type="submit">Criar tipo</button>
              </div>
            </form>
          </Card>
        </Grid>
      </div>
    </main>
  )
}
