import type { Locale } from '@jecks/shared';

/**
 * Why a promotion code was refused, in the shopper's language.
 *
 * The API names a reason (`details.reason`) and also sends a sentence, but the sentence is in
 * English: on a French or Arabic page it would be the one foreign line in the form. The
 * reason is stable, so the wording lives here. A reason this table does not know falls back
 * to the server's sentence rather than to nothing.
 */
const MESSAGES: Record<string, Record<Locale, string>> = {
  NOT_FOUND: {
    fr: 'Ce code n’existe pas',
    ar: 'هذا الرمز غير موجود',
    en: 'This code does not exist',
  },
  INACTIVE: {
    fr: 'Ce code n’est plus actif',
    ar: 'هذا الرمز لم يعد فعالا',
    en: 'This code is no longer active',
  },
  NOT_STARTED: {
    fr: 'Ce code n’est pas encore valable',
    ar: 'هذا الرمز غير صالح بعد',
    en: 'This code is not valid yet',
  },
  EXPIRED: {
    fr: 'Ce code a expiré',
    ar: 'انتهت صلاحية هذا الرمز',
    en: 'This code has expired',
  },
  USAGE_LIMIT_REACHED: {
    fr: 'Ce code a atteint sa limite d’utilisation',
    ar: 'بلغ هذا الرمز حد الاستخدام',
    en: 'This code has reached its usage limit',
  },
  CUSTOMER_LIMIT_REACHED: {
    fr: 'Vous avez déjà utilisé ce code',
    ar: 'لقد استخدمت هذا الرمز من قبل',
    en: 'You have already used this code',
  },
  MIN_SUBTOTAL: {
    fr: 'Votre commande n’atteint pas le montant minimum de ce code',
    ar: 'طلبك لم يبلغ الحد الأدنى لهذا الرمز',
    en: 'Your order has not reached the minimum amount for this code',
  },
  MIN_QUANTITY: {
    fr: 'Ajoutez des articles pour utiliser ce code',
    ar: 'أضف المزيد من المنتجات لاستخدام هذا الرمز',
    en: 'Add more items to use this code',
  },
  NOT_ELIGIBLE: {
    fr: 'Ce code ne s’applique pas à cet article',
    ar: 'هذا الرمز لا ينطبق على هذا المنتج',
    en: 'This code does not apply to this item',
  },
  WILAYA_NOT_ELIGIBLE: {
    fr: 'Ce code n’est pas disponible dans votre wilaya',
    ar: 'هذا الرمز غير متاح في ولايتك',
    en: 'This code is not available in your wilaya',
  },
  FIRST_ORDER_ONLY: {
    fr: 'Ce code est réservé à une première commande',
    ar: 'هذا الرمز مخصص للطلب الأول فقط',
    en: 'This code is for first orders only',
  },
  NOT_STACKABLE: {
    fr: 'Ce code ne peut pas être cumulé avec la remise déjà appliquée',
    ar: 'لا يمكن الجمع بين هذا الرمز والتخفيض المطبق',
    en: 'This code cannot be combined with the discount already applied',
  },
};

/** The sentence to show, from an API error's details; undefined when there is no known reason. */
export function promoRefusal(details: unknown, locale: Locale): string | undefined {
  const reason =
    typeof details === 'object' && details !== null && 'reason' in details
      ? String((details as { reason: unknown }).reason)
      : '';
  return MESSAGES[reason]?.[locale];
}
