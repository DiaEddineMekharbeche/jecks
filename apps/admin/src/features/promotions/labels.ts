import { PromotionScope, PromotionType, type PromoRejectionCode } from '@jecks/shared';

/** The vocabulary the promotion screens render. */

export const PROMOTION_TYPE_LABELS: Record<string, string> = {
  [PromotionType.PERCENTAGE]: 'Pourcentage',
  [PromotionType.FIXED_AMOUNT]: 'Montant fixe',
  [PromotionType.FREE_SHIPPING]: 'Livraison offerte',
  [PromotionType.BUY_X_GET_Y]: 'X achetés, Y offerts',
  [PromotionType.BUNDLE_PRICE]: 'Prix de lot',
  [PromotionType.TIERED]: 'Par paliers',
};

export const PROMOTION_TYPE_HINTS: Record<string, string> = {
  [PromotionType.PERCENTAGE]: 'Un pourcentage retiré des articles concernés.',
  [PromotionType.FIXED_AMOUNT]: 'Un montant réparti au prorata sur les lignes concernées.',
  [PromotionType.FREE_SHIPPING]: 'Annule les frais de livraison sans toucher aux articles.',
  [PromotionType.BUY_X_GET_Y]: 'Les unités offertes sont les moins chères du panier.',
  [PromotionType.BUNDLE_PRICE]: 'Les articles ensemble à un prix fixe.',
  [PromotionType.TIERED]: 'Plus le panier est gros, plus la remise l’est.',
};

export const PROMOTION_SCOPE_LABELS: Record<string, string> = {
  [PromotionScope.ORDER]: 'Toute la commande',
  [PromotionScope.PRODUCT]: 'Produits choisis',
  [PromotionScope.VARIANT]: 'Variantes choisies',
  [PromotionScope.COLLECTION]: 'Collections choisies',
  [PromotionScope.CATEGORY]: 'Catégories choisies',
  [PromotionScope.SHIPPING]: 'Livraison',
};

export const PROMOTION_STATE_LABELS: Record<string, string> = {
  active: 'En cours',
  scheduled: 'Programmée',
  expired: 'Terminée',
  draft: 'Inactive',
  exhausted: 'Épuisée',
};

export const PROMOTION_STATE_TONES: Record<string, 'success' | 'info' | 'neutral' | 'warning'> = {
  active: 'success',
  scheduled: 'info',
  expired: 'neutral',
  draft: 'neutral',
  exhausted: 'warning',
};

/**
 * Why a code was refused, in French.
 *
 * The API's own messages are already shopper-facing sentences, but the simulator shows
 * them to an owner who needs the shorter label beside the reason.
 */
export const REJECTION_LABELS: Record<PromoRejectionCode, string> = {
  NOT_FOUND: 'Code inconnu',
  INACTIVE: 'Promotion inactive',
  NOT_STARTED: 'Pas encore commencée',
  EXPIRED: 'Terminée',
  USAGE_LIMIT_REACHED: 'Limite d’utilisation atteinte',
  CUSTOMER_LIMIT_REACHED: 'Déjà utilisée par ce client',
  MIN_SUBTOTAL: 'Montant minimum non atteint',
  MIN_QUANTITY: 'Quantité minimum non atteinte',
  NOT_ELIGIBLE: 'Ne s’applique pas à ce panier',
  WILAYA_NOT_ELIGIBLE: 'Wilaya non couverte',
  FIRST_ORDER_ONLY: 'Réservée à une première commande',
  NOT_STACKABLE: 'Non cumulable avec la remise déjà appliquée',
};
