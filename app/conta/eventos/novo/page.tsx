import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { activeEventTypes, planningOptions } from '@/lib/event-plans'
import { Card, PageHead, dash } from '@/app/dash/parts'
import { doCreatePlan } from '../actions'

export const metadata: Metadata = { title: 'Planear evento', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  tipo: 'Escolha o tipo de evento.',
  titulo: 'Dê um nome ao evento (pelo menos 2 letras).',
  data: 'A data não parece válida.',
  convidados: 'Indique o número de convidados (de 1 a 100 000).',
  orcamento: 'O orçamento não parece válido. Escreva, por exemplo, 2.500.000',
  zona: 'Escolha um município da lista.',
  limite: 'Já tem 30 eventos activos. Arquive um que já passou para planear outro.',
  dados: 'Não foi possível guardar. Verifique os dados.',
}

/** A new plan (slice 50): the type is the only thing it needs. */
export default async function NovoEvento({
  searchParams,
}: { searchParams: Promise<{ tipo?: string; erro?: string }> }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/conta/eventos/novo')
  const [{ tipo, erro }, types, { municipalities }] = await Promise.all([
    searchParams, activeEventTypes(), planningOptions(),
  ])
  const chosen = types.find((t) => t.slug === tipo)?.id ?? null

  return (
    <>
      <PageHead
        crumb={{ href: '/conta/eventos', label: 'Os meus eventos' }}
        title="Planear um evento"
        sub="Escolha o tipo e preparamos a lista do que é preciso. Tudo o resto é opcional e pode ser alterado depois."
      />

      {erro ? <p className={dash.alert} role="alert">{ERRORS[erro] ?? ERRORS.dados}</p> : null}

      <form action={doCreatePlan} className={dash.form}>
        <Card title="Que evento vai organizar?">
          <fieldset className={dash.types}>
            <legend className={dash.srOnly}>Tipo de evento</legend>
            {types.map((t) => (
              <label className={dash.typeOption} key={t.id}>
                <input type="radio" name="tipo" value={t.id} required defaultChecked={t.id === chosen} />
                <span className={dash.typeName}>{t.name}</span>
                {t.description ? <span className={dash.typeDesc}>{t.description}</span> : null}
                <span className={dash.typeNeeds}>
                  {t.needs.length} {t.needs.length === 1 ? 'item' : 'itens'}: {t.needs.slice(0, 4).map((n) => n.name.toLowerCase()).join(', ')}
                  {t.needs.length > 4 ? '…' : ''}
                </span>
              </label>
            ))}
          </fieldset>
        </Card>

        <Card title="Os detalhes" note="Pode deixar em branco o que ainda não sabe.">
          <div className={dash.fields}>
            <label className={`${dash.field} ${dash.fieldWide}`}>
              <span className={dash.label}>Nome do evento</span>
              <input className={dash.input} name="titulo" maxLength={120} placeholder="Por exemplo: Casamento da Ana e do Rui" />
              <span className={dash.hint}>Se deixar em branco, usamos o tipo de evento.</span>
            </label>
            <label className={dash.field}>
              <span className={dash.label}>Data</span>
              <input className={dash.input} type="date" name="data" />
              <span className={dash.hint}>Com a data, dizemos até quando reservar cada coisa.</span>
            </label>
            <label className={dash.field}>
              <span className={dash.label}>Convidados</span>
              <input className={dash.input} name="convidados" inputMode="numeric" pattern="[0-9 .]*" placeholder="150" />
            </label>
            <label className={dash.field}>
              <span className={dash.label}>Município</span>
              <select className={dash.input} name="zona" defaultValue="">
                <option value="">Ainda não sei</option>
                {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className={dash.field}>
              <span className={dash.label}>Orçamento total (Kz)</span>
              <input className={dash.input} name="orcamento" inputMode="decimal" placeholder="2.500.000" />
              <span className={dash.hint}>Com o orçamento, sugerimos quanto reservar para cada coisa.</span>
            </label>
          </div>
        </Card>

        <div className={dash.headActions}>
          <button className={`${dash.btn} ${dash.btnPrimary}`} type="submit">Criar o plano</button>
          <a className={`${dash.btn} ${dash.btnGhost}`} href="/conta/eventos">Cancelar</a>
        </div>
      </form>
    </>
  )
}
