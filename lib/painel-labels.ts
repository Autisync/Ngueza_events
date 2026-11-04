/**
 * Supplier-facing labels for a listing's verification state. One map,
 * used by the painel list and each business page — the business page
 * used to hand-roll a ternary that showed a suspended listing as
 * "Por submeter".
 */
export const VERIFICATION_STATUS: Record<string, { label: string; cls: 'pillOff' | 'pillWait' | 'pillOk' | 'pillBad' }> = {
  unverified: { label: 'Por submeter', cls: 'pillOff' },
  pending: { label: 'Em análise', cls: 'pillWait' },
  verified: { label: 'Verificado', cls: 'pillOk' },
  rejected: { label: 'Rejeitado — pode corrigir e voltar a submeter', cls: 'pillBad' },
  suspended: { label: 'Suspenso', cls: 'pillBad' },
}

export const verificationLabel = (status: string) =>
  VERIFICATION_STATUS[status] ?? VERIFICATION_STATUS.unverified!
