import type { Metadata } from 'next'
import { currentProfile } from '@/lib/auth'
import { TOPICS } from '@/lib/support'
import { doAskForHelp } from '@/app/actions'
import styles from './ajuda.module.css'

export const metadata: Metadata = {
  title: 'Ajuda',
  description: 'Como funcionam as reservas na NGUEZA, como pagar com segurança, o que quer dizer «Verificado», e como pedir ajuda.',
}
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  email: 'Escreva um endereço de email válido, para lhe podermos responder.',
  message: 'Conte-nos um pouco mais — pelo menos uma frase.',
  bookingRef: 'A referência da reserva tem 8 caracteres, como 81A0F3C2. Pode deixar em branco.',
  limite: 'Recebemos muitos pedidos deste endereço. Tente novamente daqui a uma hora.',
  dados: 'Verifique os dados introduzidos.',
}

export default async function Ajuda({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; enviado?: string; assunto?: string; ref?: string }>
}) {
  const [profile, flags] = await Promise.all([currentProfile(), searchParams])
  const topic = flags.assunto && flags.assunto in TOPICS ? flags.assunto : 'reserva'

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href="/">← NGUEZA</a>
          <h1 className={styles.title}>Ajuda</h1>
          <p className={styles.sub}>Como funciona, como pagar com segurança, e como falar connosco.</p>
        </div>
      </section>

      <div className={styles.wrap}>
        <ul className={styles.toc}>
          <li><a href="#como-funciona">Como funciona</a></li>
          <li><a href="#pagar">Pagar com segurança</a></li>
          <li><a href="#verificado">«Verificado»</a></li>
          <li><a href="#cancelar">Cancelar</a></li>
          <li><a href="#problemas">Algo correu mal</a></li>
          <li><a href="#contacto">Pedir ajuda</a></li>
        </ul>

        <section className={styles.sec} id="como-funciona">
          <h2>Como funciona uma reserva</h2>
          <ol>
            <li><strong>Pede</strong> a data na página do fornecedor. Ainda não fica reservada.</li>
            <li>O fornecedor tem <strong>48 horas</strong> para aceitar. Num espaço (salão, quinta…), se outro
              cliente reservar a mesma data antes, o seu pedido é encerrado e avisamos — sem nada a pagar.</li>
            <li>Depois de aceitar, o fornecedor <strong>pede o pagamento</strong>: o total, o sinal e como pagar.
              Recebe tudo por email e na página da reserva.</li>
            <li>Paga <strong>directamente ao fornecedor</strong> e envia o comprovativo na página da reserva.
              A data fica guardada enquanto o fornecedor confirma.</li>
            <li>O fornecedor confirma que recebeu: a reserva fica <strong>Confirmada</strong>.</li>
          </ol>
          <p>Em cada passo, a página da reserva diz o que falta fazer e até quando.</p>
        </section>

        <section className={`${styles.sec} ${styles.warn}`} id="pagar">
          <h2>Pagar com segurança</h2>
          <ul>
            <li>A NGUEZA <strong>nunca recebe o seu dinheiro</strong> e nunca lhe pede para pagar a uma conta
              diferente da que o fornecedor indicou na página da reserva.</li>
            <li>Se alguém — mesmo dizendo-se da NGUEZA ou do fornecedor — lhe pedir para pagar para outra conta,
              com pressa, ou por uma mensagem fora da reserva, <strong>não pague</strong> e
              {' '}<a href="/ajuda?assunto=fraude#contacto">avise-nos</a>.</li>
            <li>Indique a referência da reserva no pagamento, e guarde o comprovativo.</li>
            <li>«<strong>Comprovativo verificado</strong>» quer dizer que a nossa equipa achou o documento
              legível e plausível. Não quer dizer que o dinheiro chegou — isso só o fornecedor confirma.</li>
          </ul>
        </section>

        <section className={styles.sec} id="verificado">
          <h2>O que quer dizer «Verificado»</h2>
          <p>
            Antes de um fornecedor aparecer nas procuras, a nossa equipa confere os documentos que nos enviou
            — identificação do responsável e, quando se aplica, o NIF e a certidão comercial — e confirma que
            correspondem ao negócio registado.
          </p>
          <p>
            «Verificado» diz quem é o fornecedor. Não é uma avaliação da qualidade do serviço: para isso, leia as
            avaliações — as que têm o selo de verificada vêm de clientes com uma reserva concluída.
          </p>
        </section>

        <section className={styles.sec} id="cancelar">
          <h2>Cancelar</h2>
          <p>
            Cada fornecedor tem uma política de cancelamento, que aparece na página dele antes de pedir, e com
            datas concretas na página da reserva. A política que conta é a que estava em vigor quando pediu —
            não muda depois.
          </p>
          <p>
            O reembolso é combinado directamente com o fornecedor, como o pagamento. Se o fornecedor cancelar,
            ou se não chegarem a acordo, <a href="/ajuda?assunto=reserva#contacto">fale connosco</a>.
          </p>
        </section>

        <section className={styles.sec} id="problemas">
          <h2>Algo correu mal</h2>
          <ul>
            <li><strong>O fornecedor não responde:</strong> sem resposta em 48 horas, o pedido expira sozinho.
              Pode pedir a outro fornecedor, ou <a href="/pedir-orcamento">pedir orçamento</a> a vários de uma vez.</li>
            <li><strong>Pagou e o fornecedor não confirma:</strong> use os contactos na página da reserva. Se não
              conseguir resolver, envie-nos a referência da reserva.</li>
            <li><strong>Não consegue entrar na conta:</strong> <a href="/recuperar">recupere a palavra-passe</a>,
              ou escreva-nos abaixo — não precisa de ter sessão iniciada.</li>
          </ul>
        </section>

        <section className={styles.sec} id="contacto">
          <h2>Pedir ajuda</h2>
          {flags.enviado ? (
            <p className={`${styles.alert} ${styles.ok}`} role="status">
              Recebemos o seu pedido. A nossa equipa responde por email.
            </p>
          ) : null}
          {flags.erro ? (
            <p className={styles.alert} role="alert">{ERRORS[flags.erro] ?? ERRORS.dados}</p>
          ) : null}
          <form action={doAskForHelp}>
            {profile ? (
              <p className={styles.hint} style={{ marginTop: 0, marginBottom: 14 }}>
                Respondemos para {profile.email}.
              </p>
            ) : (
              <label className={styles.field}>
                <span className={styles.label}>O seu email</span>
                <input className={styles.input} type="email" name="email" required maxLength={254}
                       autoComplete="email" />
              </label>
            )}
            <label className={styles.field}>
              <span className={styles.label}>Sobre</span>
              <select className={styles.input} name="topic" defaultValue={topic}>
                {Object.entries(TOPICS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                Referência da reserva <span style={{ fontWeight: 400, color: 'var(--tinta-3)' }}>(se houver)</span>
              </span>
              <input className={styles.input} name="bookingRef" maxLength={8} defaultValue={flags.ref ?? ''}
                     placeholder="81A0F3C2" autoCapitalize="characters" />
              <span className={styles.hint}>Está na página da reserva, em «Referência».</span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>O que aconteceu</span>
              <textarea className={`${styles.input} ${styles.area}`} name="message" required
                        minLength={10} maxLength={4000} />
            </label>
            <button className={styles.submit} type="submit">Enviar</button>
          </form>
        </section>
      </div>
    </main>
  )
}
