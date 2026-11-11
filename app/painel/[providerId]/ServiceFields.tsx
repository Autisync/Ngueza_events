import type { OwnedService } from '@/lib/painel'
import { majorInput } from '@/lib/money'
import styles from '../painel.module.css'

/**
 * The fields of a service, shared by "Adicionar serviço" and each
 * service's own "Editar" form so the two can never drift apart. A server
 * component: plain inputs inside the caller's <form>, no JavaScript.
 */

const amount = (minor: bigint | undefined) => (minor === undefined ? '' : majorInput(minor))

export function ServiceFields({
  categories, defaultCategoryId, service, idPrefix,
}: {
  categories: Array<{ id: string; name: string }>
  defaultCategoryId: string
  service?: OwnedService
  /** Unique per form, so labels and ids never collide across many forms on one page. */
  idPrefix: string
}) {
  const price = service?.price
  const priceMinor = price && price.mode !== 'on_request' ? price.minor : undefined
  const priceMax = price?.mode === 'range' ? price.maxMinor : undefined

  return (
    <>
      <div className={styles.two}>
        <label className={styles.field}>
          <span className={styles.label}>Nome do serviço</span>
          <input className={styles.input} name="name" required minLength={3} maxLength={120}
                 defaultValue={service?.name} placeholder="Aluguer do salão (dia inteiro)" />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Categoria</span>
          <select className={styles.select} name="categoryId" required
                  defaultValue={service?.categoryId ?? defaultCategoryId}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>O que inclui</span>
        <textarea className={styles.area} name="description" maxLength={1000}
                  id={`${idPrefix}-description`}
                  defaultValue={service?.description ?? ''}
                  placeholder="Ex.: mesas e cadeiras para 250 pessoas, ar condicionado, segurança, limpeza no fim. Não inclui decoração." />
        <span className={styles.hint}>
          Aparece na sua página por baixo do preço. Dizer o que está e o que não está incluído
          evita perguntas e mal-entendidos.
        </span>
      </label>
      <div className={styles.two}>
        <label className={styles.field}>
          <span className={styles.label}>Como cobra</span>
          <select className={styles.select} name="priceMode" defaultValue={price?.mode ?? 'exact'}>
            <option value="exact">Preço fixo</option>
            <option value="from">A partir de</option>
            <option value="range">Intervalo</option>
            <option value="on_request">Sob consulta</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Unidade</span>
          <select className={styles.select} name="priceUnit" defaultValue={service?.priceUnit ?? 'event'}>
            <option value="event">Por evento</option>
            <option value="day">Por dia</option>
            <option value="hour">Por hora</option>
            <option value="person">Por pessoa</option>
          </select>
        </label>
      </div>
      <div className={styles.two}>
        <label className={styles.field}>
          <span className={styles.label}>Preço (Kz)</span>
          <input className={styles.input} name="price" inputMode="decimal"
                 defaultValue={amount(priceMinor)} placeholder="180.000" />
          <span className={styles.hint}>Deixe vazio se for sob consulta.</span>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Preço máximo (Kz)</span>
          <input className={styles.input} name="priceMax" inputMode="decimal"
                 defaultValue={amount(priceMax)} placeholder="620.000" />
          <span className={styles.hint}>Só para intervalo.</span>
        </label>
      </div>
      <div className={styles.two}>
        <label className={styles.field}>
          <span className={styles.label}>Capacidade mínima</span>
          <input className={styles.input} name="minCapacity" type="number" min={1} max={100000}
                 defaultValue={service?.minCapacity ?? ''} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Capacidade máxima</span>
          <input className={styles.input} name="maxCapacity" type="number" min={1} max={100000}
                 defaultValue={service?.maxCapacity ?? ''} />
        </label>
      </div>
    </>
  )
}
