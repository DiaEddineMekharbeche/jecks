import { tr } from './util.js';

/**
 * Notification templates — PRD Section 6.1.
 *
 * Variables are camelCase and must match `TEMPLATE_VARIABLES` in
 * `packages/shared/src/schemas/system.ts` exactly. A name that does not match renders
 * as a literal `{{placeholder}}` in a real SMS, which is the failure mode this file
 * exists to avoid: one list, checked against the code.
 *
 * SMS bodies are deliberately accent-free where it costs nothing. Anything outside the
 * GSM alphabet drops the message from 160 characters to 70 and doubles the bill.
 */

export interface SeedTemplate {
  event: string;
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'TELEGRAM' | 'IN_APP';
  subject?: Record<string, string>;
  body: Record<string, string>;
}

export const NOTIFICATION_TEMPLATES: SeedTemplate[] = [
  // --- customer, by SMS -----------------------------------------------------
  {
    event: 'order.placed',
    channel: 'SMS',
    body: tr(
      "Jeck's: merci {{customerName}}! Commande {{orderNumber}} recue. Suivi: {{trackingUrl}}",
      'جيكس: شكرا {{customerName}}! تم استلام طلبك {{orderNumber}}. التتبع: {{trackingUrl}}',
      "Jeck's: thanks {{customerName}}! Order {{orderNumber}} received. Track: {{trackingUrl}}",
    ),
  },
  {
    event: 'order.confirmed',
    channel: 'SMS',
    body: tr(
      "Jeck's: commande {{orderNumber}} confirmee. Total {{total}}. Nous vous livrons bientot.",
      'جيكس: تم تأكيد الطلب {{orderNumber}}. المجموع {{total}}. سنوصله قريبا.',
      "Jeck's: order {{orderNumber}} confirmed. Total {{total}}. We will deliver shortly.",
    ),
  },
  {
    event: 'order.shipped',
    channel: 'SMS',
    body: tr(
      "Jeck's: commande {{orderNumber}} expediee avec {{courier}}. Suivi: {{trackingUrl}}",
      'جيكس: تم شحن الطلب {{orderNumber}} عبر {{courier}}. التتبع: {{trackingUrl}}',
      "Jeck's: order {{orderNumber}} shipped with {{courier}}. Track: {{trackingUrl}}",
    ),
  },
  {
    event: 'order.out_for_delivery',
    channel: 'SMS',
    body: tr(
      "Jeck's: votre colis {{orderNumber}} arrive aujourd'hui. Preparez {{total}}.",
      'جيكس: طردك {{orderNumber}} يصل اليوم. جهز {{total}}.',
      "Jeck's: your parcel {{orderNumber}} arrives today. Please have {{total}} ready.",
    ),
  },
  {
    event: 'order.delivered',
    channel: 'SMS',
    body: tr(
      "Jeck's: commande {{orderNumber}} livree. Merci! Votre avis: {{reviewUrl}}",
      'جيكس: تم تسليم الطلب {{orderNumber}}. شكرا! شاركنا رأيك: {{reviewUrl}}',
      "Jeck's: order {{orderNumber}} delivered. Thank you! Leave a review: {{reviewUrl}}",
    ),
  },
  {
    event: 'order.failed',
    channel: 'SMS',
    body: tr(
      "Jeck's: nous n'avons pas pu livrer {{orderNumber}}. Rappelez-nous au {{storePhone}}.",
      'جيكس: تعذر تسليم {{orderNumber}}. اتصل بنا على {{storePhone}}.',
      "Jeck's: we could not deliver {{orderNumber}}. Call us on {{storePhone}}.",
    ),
  },
  {
    event: 'order.cancelled',
    channel: 'SMS',
    body: tr(
      "Jeck's: commande {{orderNumber}} annulee. Une question? {{storePhone}}",
      'جيكس: تم إلغاء الطلب {{orderNumber}}. لأي استفسار: {{storePhone}}',
      "Jeck's: order {{orderNumber}} cancelled. Questions? {{storePhone}}",
    ),
  },
  {
    event: 'cart.abandoned',
    channel: 'SMS',
    body: tr(
      "Jeck's: votre panier vous attend. Code {{promoCode}} pour -10%: {{cartUrl}}",
      'جيكس: سلتك في انتظارك. رمز {{promoCode}} لخصم 10%: {{cartUrl}}',
      "Jeck's: your cart is waiting. Code {{promoCode}} for 10% off: {{cartUrl}}",
    ),
  },
  {
    event: 'stock.back_in_stock',
    channel: 'SMS',
    body: tr(
      "Jeck's: {{productName}} est de retour en stock. {{productUrl}}",
      'جيكس: {{productName}} متوفر من جديد. {{productUrl}}',
      "Jeck's: {{productName}} is back in stock. {{productUrl}}",
    ),
  },
  {
    event: 'review.request',
    channel: 'SMS',
    body: tr(
      "Jeck's: comment trouvez-vous votre {{productName}}? Votre avis: {{reviewUrl}}",
      'جيكس: ما رأيك في {{productName}}؟ شاركنا: {{reviewUrl}}',
      "Jeck's: how is your {{productName}}? Tell us: {{reviewUrl}}",
    ),
  },
  {
    event: 'auth.otp',
    channel: 'SMS',
    body: tr(
      "Jeck's: votre code est {{code}}. Valable {{minutes}} minutes.",
      'جيكس: رمزك هو {{code}}. صالح {{minutes}} دقائق.',
      "Jeck's: your code is {{code}}. Valid for {{minutes}} minutes.",
    ),
  },

  // --- customer, by e-mail --------------------------------------------------
  {
    event: 'order.placed',
    channel: 'EMAIL',
    subject: tr(
      'Commande {{orderNumber}} reçue',
      'تم استلام الطلب {{orderNumber}}',
      'Order {{orderNumber}} received',
    ),
    body: tr(
      'Bonjour {{customerName}},\n\nNous avons bien reçu votre commande {{orderNumber}} d’un montant de {{total}}.\nSuivez-la ici : {{trackingUrl}}\n\nVous payez à la réception, en main propre.\n\nL’équipe {{storeName}}',
      'مرحبا {{customerName}}،\n\nاستلمنا طلبك {{orderNumber}} بقيمة {{total}}.\nتابعه هنا: {{trackingUrl}}\n\nالدفع عند الاستلام.\n\nفريق {{storeName}}',
      'Hi {{customerName}},\n\nWe received your order {{orderNumber}} for {{total}}.\nTrack it here: {{trackingUrl}}\n\nYou pay on delivery.\n\nThe {{storeName}} team',
    ),
  },
  {
    event: 'order.delivered',
    channel: 'EMAIL',
    subject: tr(
      'Commande {{orderNumber}} livrée',
      'تم تسليم الطلب {{orderNumber}}',
      'Order {{orderNumber}} delivered',
    ),
    body: tr(
      'Bonjour {{customerName}},\n\nVotre commande {{orderNumber}} a bien été livrée. Merci de votre confiance.\n\nSi vous avez deux minutes, votre avis nous aide beaucoup : {{reviewUrl}}\n\nL’équipe {{storeName}}',
      'مرحبا {{customerName}}،\n\nتم تسليم طلبك {{orderNumber}}. شكرا لثقتك.\n\nإن كان لديك دقيقتان، رأيك يهمنا: {{reviewUrl}}\n\nفريق {{storeName}}',
      'Hi {{customerName}},\n\nYour order {{orderNumber}} has been delivered. Thank you.\n\nIf you have two minutes, your review helps a lot: {{reviewUrl}}\n\nThe {{storeName}} team',
    ),
  },

  // --- the owner ------------------------------------------------------------
  {
    event: 'owner.new_order',
    channel: 'TELEGRAM',
    subject: tr('Nouvelle commande', 'طلب جديد', 'New order'),
    body: tr(
      '{{orderNumber}} — {{total}} — {{wilaya}} — {{customerPhone}}',
      '{{orderNumber}} — {{total}} — {{wilaya}} — {{customerPhone}}',
      '{{orderNumber}} — {{total}} — {{wilaya}} — {{customerPhone}}',
    ),
  },
  {
    event: 'owner.new_order',
    channel: 'IN_APP',
    subject: tr('Nouvelle commande', 'طلب جديد', 'New order'),
    body: tr(
      '{{orderNumber}} · {{total}} · {{wilaya}}',
      '{{orderNumber}} · {{total}} · {{wilaya}}',
      '{{orderNumber}} · {{total}} · {{wilaya}}',
    ),
  },
  {
    event: 'inventory.low',
    channel: 'TELEGRAM',
    subject: tr('Stock bas', 'مخزون منخفض', 'Low stock'),
    body: tr(
      '{{sku}} ({{productName}}) — il reste {{available}}.',
      '{{sku}} ({{productName}}) — بقي {{available}}.',
      '{{sku}} ({{productName}}) — {{available}} left.',
    ),
  },
  {
    event: 'inventory.low',
    channel: 'IN_APP',
    subject: tr('Stock bas', 'مخزون منخفض', 'Low stock'),
    body: tr(
      '{{sku}} — {{productName}} : {{available}} restant(s)',
      '{{sku}} — {{productName}}: {{available}}',
      '{{sku}} — {{productName}}: {{available}} left',
    ),
  },
  {
    event: 'order.failed',
    channel: 'TELEGRAM',
    subject: tr('Livraison échouée', 'فشل التسليم', 'Failed delivery'),
    body: tr(
      '{{orderNumber}} ({{wilaya}}) — {{reason}}',
      '{{orderNumber}} ({{wilaya}}) — {{reason}}',
      '{{orderNumber}} ({{wilaya}}) — {{reason}}',
    ),
  },
];
