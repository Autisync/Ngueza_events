'use client'

import { useFormStatus } from 'react-dom'
import styles from './page.module.css'

/**
 * A small, genuinely progressive enhancement: shows a pending state while
 * the server action runs. The form still submits and redirects correctly
 * with JavaScript disabled — useFormStatus simply has nothing to report
 * then, so the button just says "Avisem-me" the whole time, same as before
 * this component existed.
 */
export function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button className={styles.submit} type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          A enviar…
        </>
      ) : (
        'Avisem-me'
      )}
    </button>
  )
}
