import { CallOutcome, OrderStatus, PaymentStatus, type RiskFlag } from '@jecks/shared';

/**
 * The vocabulary the order screens render.
 *
 * Kept apart from the components because the same labels appear in the list, the
 * detail, the timeline and the bulk bar, and a status spelled two ways is a status an
 * operator has to think about.
 */

export const ORDER_STATUS_LABELS: Record<string, string> = {
  [OrderStatus.PENDING]: 'À confirmer',
  [OrderStatus.CONFIRMED]: 'Confirmée',
  [OrderStatus.PACKED]: 'Préparée',
  [OrderStatus.SHIPPED]: 'Expédiée',
  [OrderStatus.OUT_FOR_DELIVERY]: 'En livraison',
  [OrderStatus.DELIVERED]: 'Livrée',
  [OrderStatus.FAILED]: 'Échec de livraison',
  [OrderStatus.RETURN_REQUESTED]: 'Retour demandé',
  [OrderStatus.RETURNED]: 'Retournée',
  [OrderStatus.CANCELLED]: 'Annulée',
  [OrderStatus.REFUNDED]: 'Remboursée',
};

/** The verb on the button, which is not the same word as the resulting state. */
export const TRANSITION_LABELS: Record<string, string> = {
  [OrderStatus.CONFIRMED]: 'Confirmer',
  [OrderStatus.PACKED]: 'Marquer préparée',
  [OrderStatus.SHIPPED]: 'Marquer expédiée',
  [OrderStatus.OUT_FOR_DELIVERY]: 'Mettre en livraison',
  [OrderStatus.DELIVERED]: 'Marquer livrée',
  [OrderStatus.FAILED]: 'Signaler un échec',
  [OrderStatus.RETURN_REQUESTED]: 'Demander un retour',
  [OrderStatus.RETURNED]: 'Marquer retournée',
  [OrderStatus.CANCELLED]: 'Annuler',
  [OrderStatus.REFUNDED]: 'Marquer remboursée',
};

export const ORDER_STATUS_TONES: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'brass'> = {
  [OrderStatus.PENDING]: 'warning',
  [OrderStatus.CONFIRMED]: 'info',
  [OrderStatus.PACKED]: 'info',
  [OrderStatus.SHIPPED]: 'brass',
  [OrderStatus.OUT_FOR_DELIVERY]: 'brass',
  [OrderStatus.DELIVERED]: 'success',
  [OrderStatus.FAILED]: 'danger',
  [OrderStatus.RETURN_REQUESTED]: 'warning',
  [OrderStatus.RETURNED]: 'neutral',
  [OrderStatus.CANCELLED]: 'neutral',
  [OrderStatus.REFUNDED]: 'neutral',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  [PaymentStatus.UNPAID]: 'Non payée',
  [PaymentStatus.AUTHORIZED]: 'Autorisée',
  [PaymentStatus.PAID]: 'Payée',
  [PaymentStatus.PARTIALLY_REFUNDED]: 'Partiellement réglée',
  [PaymentStatus.REFUNDED]: 'Remboursée',
};

export const CALL_OUTCOME_LABELS: Record<string, string> = {
  [CallOutcome.CONFIRMED]: 'Commande confirmée',
  [CallOutcome.NO_ANSWER]: 'Pas de réponse',
  [CallOutcome.WRONG_NUMBER]: 'Mauvais numéro',
  [CallOutcome.CALL_BACK]: 'À rappeler',
  [CallOutcome.CANCELLED]: 'Client annule',
};

/**
 * Why an order was flagged, in a sentence an agent can act on. A raw enum on a screen
 * is a question rather than an answer.
 */
export const RISK_FLAG_LABELS: Record<RiskFlag, string> = {
  BLACKLISTED: 'Client en liste noire',
  FAILED_HISTORY: 'Livraisons échouées par le passé',
  MANY_CANCELLATIONS: 'Annule souvent',
  DUPLICATE_ORDER: 'Commande identique récente',
  ORDER_FLOOD: 'Trop de commandes depuis ce numéro',
  IP_FLOOD: 'Trop de commandes depuis cette adresse IP',
  UNUSUALLY_LARGE: 'Montant inhabituel pour un premier achat',
  PHONE_UNVERIFIED: 'Téléphone non vérifié',
  VAGUE_ADDRESS: 'Adresse imprécise',
  FIRST_ORDER: 'Première commande',
};

export const SOURCE_LABELS: Record<string, string> = {
  WEB: 'Site',
  PHONE: 'Téléphone',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  WHATSAPP: 'WhatsApp',
  ADMIN: 'Back-office',
};

export const DELIVERY_TYPE_LABELS: Record<string, string> = {
  HOME: 'À domicile',
  STOP_DESK: 'Point de retrait',
};

/** Turns a risk score into a word, because 62 means nothing on its own. */
export function riskTone(score: number): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (score >= 70) return { label: 'Risque élevé', tone: 'danger' };
  if (score >= 40) return { label: 'À vérifier', tone: 'warning' };
  return { label: 'Risque faible', tone: 'success' };
}
