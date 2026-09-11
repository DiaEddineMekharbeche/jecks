import { CustomerSegment } from '@jecks/shared';

/** The vocabulary the customer screens render — PRD F-AD-40. */

export const SEGMENT_LABELS: Record<string, string> = {
  [CustomerSegment.NEW]: 'Nouveaux',
  [CustomerSegment.RETURNING]: 'Fidèles',
  [CustomerSegment.VIP]: 'VIP',
  [CustomerSegment.AT_RISK]: 'À relancer',
  [CustomerSegment.BLACKLISTED]: 'Bloqués',
};

export const SEGMENT_TONES: Record<
  string,
  'neutral' | 'info' | 'brass' | 'success' | 'warning' | 'danger'
> = {
  [CustomerSegment.NEW]: 'info',
  [CustomerSegment.RETURNING]: 'success',
  [CustomerSegment.VIP]: 'brass',
  [CustomerSegment.AT_RISK]: 'warning',
  [CustomerSegment.BLACKLISTED]: 'danger',
};

/** What each segment means, so a label is never just a colour. */
export const SEGMENT_HINTS: Record<string, string> = {
  [CustomerSegment.NEW]: 'Aucune commande livrée, ou une seule.',
  [CustomerSegment.RETURNING]: 'Au moins deux commandes reçues.',
  [CustomerSegment.VIP]: 'Trois commandes et plus, pour une valeur élevée.',
  [CustomerSegment.AT_RISK]: 'Plus rien commandé depuis trois mois.',
  [CustomerSegment.BLACKLISTED]: 'Bloqué : ses commandes sont refusées.',
};

export const LOYALTY_KIND_LABELS: Record<string, string> = {
  earn: 'Gagnés',
  redeem: 'Utilisés',
  adjust: 'Ajustement',
  expire: 'Expirés',
};
