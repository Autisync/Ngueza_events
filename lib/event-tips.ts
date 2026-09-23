/**
 * Planning tips and helpers, per category (§6). A lookup by category
 * *slug* with a supplier-type fallback — not a TypeScript union or a
 * database enum standing in for the category itself. Categories stay
 * rows an administrator can add to at runtime; a category this table
 * has never heard of still gets sensible tips from its supplier_type,
 * never a blank section or a crash.
 */

export interface EventTips {
  /** Specific to this category, or its supplier type if the category
   *  itself isn't in the table below. */
  specific: string[]
  /** True regardless of what is being booked. */
  general: string[]
}

const BY_CATEGORY_SLUG: Record<string, string[]> = {
  'saloes-de-festas': [
    'Confirme a capacidade máxima do salão e compare com o número real de convidados.',
    'Pergunte se o preço inclui mesas, cadeiras e limpeza, ou se são à parte.',
    'Verifique se há gerador ou luz de emergência — cortes de energia acontecem.',
    'Veja o espaço pessoalmente antes de confirmar, se possível — fotografias nem sempre mostram tudo.',
  ],
  'casas-de-festas': [
    'Pergunte sobre estacionamento — é frequentemente o maior problema no dia.',
    'Confirme até que horas o espaço pode estar ocupado, incluindo desmontagem.',
    'Verifique se há gerador ou luz de emergência — cortes de energia acontecem.',
  ],
  'casas-de-praia': [
    'A maré e o vento mudam o dia — pergunte ao fornecedor qual a melhor faixa horária.',
    'Tenha sempre um plano B coberto, mesmo fora da época chuvosa.',
    'Confirme o acesso para carros e para entrega de material, especialmente em maré cheia.',
  ],
  'salas-de-conferencia': [
    'Confirme a capacidade de internet e o número de tomadas disponíveis.',
    'Pergunte sobre projector, som e microfones — nem todos os espaços os incluem no preço.',
    'Verifique se há gerador — uma falha de energia a meio de um evento corporativo custa caro.',
  ],
  'salas-de-workshop': [
    'Confirme a disposição das mesas/cadeiras que o espaço permite para o seu formato.',
    'Pergunte sobre internet e tomadas se os participantes vão usar computadores.',
  ],
  djs: [
    'Combine a lista de músicas e os momentos-chave (entrada, bolo, etc.) com antecedência.',
    'Confirme se o DJ traz o próprio equipamento de som ou se depende do espaço.',
    'Pergunte quanto tempo de montagem precisa antes do evento começar.',
  ],
  maquilhagem: [
    'Marque um teste antes do dia, especialmente para casamentos.',
    'Confirme se a maquilhadora se desloca ao local ou se é preciso ir até ela.',
    'Pergunte quanto tempo demora, e reserve esse tempo com folga na agenda do dia.',
  ],
  decoracao: [
    'Partilhe fotografias de referência — «bonito» significa coisas diferentes para pessoas diferentes.',
    'Pergunte a que horas a decoração é montada e desmontada, e se isso está incluído.',
    'Combine quem fica responsável por transportar e devolver peças alugadas.',
  ],
  buffet: [
    'Confirme o número de convidados com uma margem — é mais fácil sobrar do que faltar.',
    'Pergunte sobre opções vegetarianas ou restrições alimentares.',
    'Verifique se o preço inclui serviço de mesa, ou apenas a comida.',
  ],
  fotografia: [
    'Combine a lista de momentos que não podem faltar (entrada, discursos, bolo).',
    'Pergunte quando recebe as fotografias finais, e em que formato.',
    'Se o evento for ao ar livre, combine um plano para luz fraca ou chuva.',
  ],
  video: [
    'Combine a lista de momentos que não podem faltar (entrada, discursos, bolo).',
    'Pergunte quando recebe o vídeo final, e se há revisões incluídas.',
  ],
  som: [
    'Confirme a potência do sistema para o tamanho real do espaço e do público.',
    'Pergunte quanto tempo de montagem precisa antes do evento começar.',
    'Verifique se há microfone extra para discursos, se for preciso.',
  ],
  iluminacao: [
    'Partilhe fotografias de referência do ambiente que procura.',
    'Pergunte a que horas a iluminação é montada, e se depende de luz natural para o efeito.',
  ],
}

const BY_SUPPLIER_TYPE_FALLBACK: Record<'venue' | 'service', string[]> = {
  venue: [
    'Confirme a capacidade máxima do espaço e compare com o número real de convidados.',
    'Verifique se há gerador ou luz de emergência — cortes de energia acontecem.',
    'Veja o espaço pessoalmente antes de confirmar, se possível.',
  ],
  service: [
    'Combine por escrito exactamente o que está incluído no preço.',
    'Pergunte quanto tempo de montagem o fornecedor precisa antes do evento começar.',
  ],
}

const GENERAL_TIPS = [
  'Peça sempre o preço final por escrito antes de confirmar, incluindo o que está e não está incluído.',
  'Guarde o contacto directo do fornecedor (telefone ou WhatsApp) para o dia do evento.',
  'Confirme os detalhes com o fornecedor 2 a 3 dias antes da data.',
]

export function eventTips(categorySlug: string, supplierType: 'venue' | 'service'): EventTips {
  return {
    specific: BY_CATEGORY_SLUG[categorySlug] ?? BY_SUPPLIER_TYPE_FALLBACK[supplierType],
    general: GENERAL_TIPS,
  }
}
