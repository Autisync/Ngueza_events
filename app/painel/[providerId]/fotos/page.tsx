import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { currentProfile } from '@/lib/auth'
import { coverImageUrl } from '@/lib/media'
import { ownedProvider } from '@/lib/painel'
import { MAX_CAPTION, MAX_PHOTOS, ownedPhotos } from '@/lib/photos'
import { doMovePhoto, doRemovePhoto, doSetCover, doUpdateCaption } from '../../actions'
import { PhotoUpload } from './PhotoUpload'
import styles from '../../painel.module.css'

export const metadata: Metadata = { title: 'Fotografias', robots: { index: false } }
export const dynamic = 'force-dynamic'

const DONE: Record<string, string> = {
  capa: 'Capa alterada. É a primeira fotografia que os clientes vêem.',
  descricao: 'Descrição guardada.',
  removida: 'Fotografia removida.',
}

export default async function Fotografias({
  params, searchParams,
}: {
  params: Promise<{ providerId: string }>
  searchParams: Promise<{ feito?: string; erro?: string }>
}) {
  const profile = await currentProfile()
  if (!profile) redirect('/entrar?next=/painel')

  const { providerId } = await params
  const provider = await ownedProvider(profile.id, providerId)
  if (!provider) notFound()

  const [photos, flags] = await Promise.all([ownedPhotos(profile.id, providerId), searchParams])
  const remaining = MAX_PHOTOS - photos.length
  // The cover is always first; arrows move a photo among the rest.
  const lastIndex = photos.length - 1

  return (
    <main>
      <section className={styles.top}>
        <div className={styles.wrap}>
          <a className={styles.mark} href={`/painel/${providerId}`}>← {provider.name}</a>
          <h1 className={styles.title}>Fotografias</h1>
          <p className={styles.sub}>
            {photos.length === 0
              ? 'Os clientes escolhem primeiro com os olhos.'
              : `${photos.length} de ${MAX_PHOTOS}`}
          </p>
        </div>
      </section>

      <div className={styles.wrap}>
        {flags.feito && DONE[flags.feito] ? (
          <p className={`${styles.alert} ${styles.ok}`} role="status">{DONE[flags.feito]}</p>
        ) : null}
        {flags.erro ? (
          <p className={styles.alert} role="alert">
            Não foi possível fazer essa alteração. Actualize a página e tente novamente.
          </p>
        ) : null}

        <div className={styles.card}>
          <h2>Adicionar</h2>
          <p className={styles.note}>
            Mostre o espaço como o cliente o vai encontrar: a entrada, a sala montada para uma
            festa, a zona exterior, a casa de banho, o estacionamento. Fotografias com luz natural
            e na horizontal resultam melhor.
          </p>
          <PhotoUpload providerId={providerId} remaining={remaining} />
        </div>

        <div className={styles.card}>
          <h2>As suas fotografias</h2>
          <p className={styles.note}>
            A capa aparece nos resultados de procura e no topo da sua página. As restantes
            aparecem pela ordem abaixo.
          </p>

          {photos.length === 0 ? (
            <p className={styles.empty}>
              Ainda não tem fotografias. Sem elas, o seu perfil aparece com um ícone cinzento nos
              resultados de procura.
            </p>
          ) : (
            <ol className={styles.photos}>
              {photos.map((photo, i) => {
                const src = coverImageUrl(photo.externalId, 'card')
                return (
                  <li className={styles.photo} id={`foto-${photo.id}`} key={photo.id}>
                    <div className={styles.photoFrame}>
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a signed imgproxy URL, not a static asset next/image can optimise
                        <img src={src} alt={photo.altText ?? `Fotografia ${i + 1}`} loading={i < 4 ? 'eager' : 'lazy'} />
                      ) : (
                        <span>Pré-visualização indisponível</span>
                      )}
                      {photo.isCover ? <span className={styles.badge}>Capa</span> : null}
                      <span className={styles.position}>{i + 1}</span>
                    </div>

                    <div className={styles.photoBody}>
                      <form action={doUpdateCaption}>
                        <input type="hidden" name="providerId" value={providerId} />
                        <input type="hidden" name="mediaId" value={photo.id} />
                        <label className={styles.field}>
                          <span className={styles.label}>Descrição</span>
                          <input className={styles.input} name="altText" maxLength={MAX_CAPTION}
                                 defaultValue={photo.altText ?? ''}
                                 placeholder="Ex.: entrada principal à noite" />
                        </label>
                        <button className={styles.mini} type="submit">Guardar descrição</button>
                      </form>

                      <div className={styles.tools} style={{ marginTop: 10 }}>
                        {photo.isCover ? null : (
                          <>
                            <form action={doSetCover}>
                              <input type="hidden" name="providerId" value={providerId} />
                              <input type="hidden" name="mediaId" value={photo.id} />
                              <button className={styles.mini} type="submit">Tornar capa</button>
                            </form>
                            <form action={doMovePhoto}>
                              <input type="hidden" name="providerId" value={providerId} />
                              <input type="hidden" name="mediaId" value={photo.id} />
                              <input type="hidden" name="direction" value="up" />
                              {/* The photo right after the cover cannot pass it. */}
                              <button className={styles.mini} type="submit" disabled={i <= 1}
                                      aria-label={`Mover fotografia ${i + 1} para trás`}>
                                ← Antes
                              </button>
                            </form>
                            <form action={doMovePhoto}>
                              <input type="hidden" name="providerId" value={providerId} />
                              <input type="hidden" name="mediaId" value={photo.id} />
                              <input type="hidden" name="direction" value="down" />
                              <button className={styles.mini} type="submit" disabled={i === lastIndex}
                                      aria-label={`Mover fotografia ${i + 1} para a frente`}>
                                Depois →
                              </button>
                            </form>
                          </>
                        )}
                        {/* Removing is permanent, so it takes two taps — without JavaScript. */}
                        <details className={styles.confirm}>
                          <summary className={`${styles.mini} ${styles.danger}`}>Remover</summary>
                          <form action={doRemovePhoto}>
                            <input type="hidden" name="providerId" value={providerId} />
                            <input type="hidden" name="mediaId" value={photo.id} />
                            <button className={`${styles.mini} ${styles.danger}`} type="submit">
                              Confirmar: remover
                            </button>
                          </form>
                        </details>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </main>
  )
}
