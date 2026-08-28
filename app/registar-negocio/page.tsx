import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { formOptions } from '@/lib/painel'
import { doRegisterBusiness } from '../painel/actions'
import styles from '../painel/painel.module.css'

export const metadata: Metadata = { title: 'Registar o meu negócio', robots: { index: false } }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  name: 'O nome precisa de pelo menos 3 caracteres.',
  nome: 'Já existe um negócio com um nome muito parecido. Experimente outro.',
  categoryId: 'Escolha uma categoria.',
  locationId: 'Escolha o município.',
  website: 'O endereço do site não parece válido.',
  dados: 'Verifique os dados introduzidos.',
}

export default async function Registar({
  searchParams,
}: { searchParams: Promise<{ erro?: string }> }) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/registar-negocio')

  const [{ categories, locations }, { erro }] = await Promise.all([formOptions(), searchParams])

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/painel">← NGUEZA</a>
          <h1 className={styles.title}>Registar o meu negócio</h1>
          <p className={styles.sub}>
            Depois de registar, envia os documentos e a nossa equipa verifica antes de o perfil
            ficar visível.
          </p>
        </div>
      </section>

      <div className={styles.wrap}>
        {erro ? <p className={styles.alert} role="alert">{ERRORS[erro] ?? ERRORS.dados}</p> : null}

        <form action={doRegisterBusiness} method="post">
          <div className={styles.card}>
            <h2>O negócio</h2>
            <p className={styles.note}>Como os clientes o vão encontrar.</p>

            <label className={styles.field}>
              <span className={styles.label}>Nome</span>
              <input className={styles.input} name="name" required minLength={3} maxLength={120}
                     placeholder="Salão Horizonte" />
            </label>

            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Categoria</span>
                <select className={styles.select} name="categoryId" required defaultValue="">
                  <option value="" disabled>Escolha…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span className={styles.hint}>
                  Define como funciona a sua agenda: um espaço fica reservado o dia todo, um
                  serviço pode atender vários clientes no mesmo dia.
                </span>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Município</span>
                <select className={styles.select} name="locationId" required defaultValue="">
                  <option value="" disabled>Escolha…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className={styles.field}>
              <span className={styles.label}>Descrição</span>
              <textarea className={styles.area} name="description" maxLength={2000}
                        placeholder="O que torna o seu espaço diferente? Capacidade, estacionamento, cozinha…" />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Morada</span>
              <input className={styles.input} name="addressLine" maxLength={200}
                     placeholder="Via S8, Talatona" />
            </label>
          </div>

          <div className={styles.card}>
            <h2>Contactos</h2>
            <p className={styles.note}>
              Ficam visíveis no perfil para os clientes o poderem contactar.
            </p>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Telefone</span>
                <input className={styles.input} name="phone" type="tel" maxLength={40}
                       placeholder="+244 923 000 000" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>WhatsApp</span>
                <input className={styles.input} name="whatsapp" type="tel" maxLength={40}
                       placeholder="+244 923 000 000" />
              </label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>
                <span className={styles.label}>Site <span className={styles.hint}>(opcional)</span></span>
                <input className={styles.input} name="website" type="url" maxLength={200}
                       placeholder="https://…" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Anos de actividade <span className={styles.hint}>(opcional)</span></span>
                <input className={styles.input} name="yearsActiveDeclared" type="number" min={0} max={120} />
                <span className={styles.hint}>
                  Aparece no perfil como informação declarada por si, não verificada.
                </span>
              </label>
            </div>
          </div>

          <button className={styles.submit} type="submit">Registar negócio</button>
        </form>
      </div>
    </main>
  )
}
