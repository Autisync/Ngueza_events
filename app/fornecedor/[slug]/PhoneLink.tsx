'use client'

/**
 * A `tel:` link cannot be routed through a server redirect reliably, so the
 * click is beaconed instead. Roughly 600 bytes of JavaScript.
 *
 * Consequence worth knowing when reading the numbers: phone reveals are a
 * LOWER BOUND — a visitor with JavaScript disabled still gets a working
 * link, and is not counted. WhatsApp reveals go through a server redirect
 * and are exact.
 */
export function PhoneLink({
  providerId,
  phone,
  className,
  children,
}: {
  providerId: string
  phone: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <a
      className={className}
      href={`tel:${phone}`}
      onClick={() => {
        try {
          navigator.sendBeacon(`/api/contacto/${providerId}?canal=phone`)
        } catch {
          // Never let analytics get between a client and a phone call.
        }
      }}
    >
      {children}
    </a>
  )
}
