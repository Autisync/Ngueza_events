import type { Metadata } from 'next'
import { safeNext } from '@/lib/safe'
import { GoogleCallback } from './GoogleCallback'
import styles from '../../auth.module.css'

export const metadata: Metadata = { title: 'A entrar…', robots: { index: false } }
export const dynamic = 'force-dynamic'

export default async function GoogleAuth({
  searchParams,
}: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const target = safeNext(next)

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>A entrar…</h1>

      <GoogleCallback next={target} />

      <p className={styles.alt}><a href="/entrar">Voltar a entrar</a></p>
    </main>
  )
}
