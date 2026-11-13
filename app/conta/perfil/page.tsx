import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { Card, Grid, PageHead, Pill, dash } from '@/app/dash/parts'
import { ROLE_LABEL } from '@/app/dash/ClientShell'

export const metadata: Metadata = { title: 'Perfil e segurança', robots: { index: false } }
export const dynamic = 'force-dynamic'

/** The account itself (moved from /conta, which became the overview in slice 50). */
export default async function Perfil({
  searchParams,
}: { searchParams: Promise<{ atualizado?: string }> }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/conta/perfil')
  const { atualizado } = await searchParams

  return (
    <>
      <PageHead title="Perfil e segurança" sub="Os seus dados, a palavra-passe e a verificação em dois passos." />

      {atualizado ? <p className={`${dash.alert} ${dash.alertOk}`} role="status">Palavra-passe actualizada.</p> : null}

      <Grid kind="halves">
        <Card title="Dados">
          <ul className={dash.rows}>
            <li className={dash.row}><span className={dash.rowMain}><span className={dash.rowMeta}>Nome</span><span className={dash.rowTitle}>{profile.fullName ?? '—'}</span></span></li>
            <li className={dash.row}><span className={dash.rowMain}><span className={dash.rowMeta}>Email</span><span className={dash.rowTitle}>{profile.email}</span></span></li>
            <li className={dash.row}>
              <span className={dash.rowMain}><span className={dash.rowMeta}>Tipo de conta</span></span>
              <Pill tone="info">{ROLE_LABEL[profile.role] ?? profile.role}</Pill>
            </li>
            <li className={dash.row}>
              <span className={dash.rowMain}><span className={dash.rowMeta}>Email confirmado</span></span>
              {profile.emailVerified ? <Pill tone="good">Sim</Pill> : <Pill tone="warn">Por confirmar</Pill>}
            </li>
          </ul>
        </Card>

        <Card title="Segurança" note="Pode alterar a palavra-passe a qualquer momento.">
          <div className={dash.headActions}>
            <a className={`${dash.btn} ${dash.btnGhost}`} href="/recuperar">Alterar palavra-passe</a>
            <a className={`${dash.btn} ${dash.btnGhost}`} href="/conta/seguranca">Verificação em dois passos</a>
          </div>
          {/* POST, so no page or image can sign someone out by linking here. */}
          <form action="/sair" method="post" style={{ marginTop: 18 }}>
            <button className={`${dash.btn} ${dash.btnDanger}`} type="submit">Terminar sessão</button>
          </form>
        </Card>
      </Grid>
    </>
  )
}
