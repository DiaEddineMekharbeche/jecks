import type { SettingScope } from '@jecks/shared';

/**
 * The shape of every settings form — PRD F-AD-91.
 *
 * A declaration rather than fifteen hand-written forms. Each field names its key, its
 * control and the sentence that tells the owner what it changes. The API validates the
 * same keys with its own Zod schemas, so this file decides presentation only; it can
 * never widen what the server accepts.
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'number'
  | 'money'
  | 'switch'
  | 'select'
  | 'multiselect'
  | 'color'
  | 'secret'
  | 'list';

export interface SettingField {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  /** Only shown when this key is truthy — a provider's credentials, say. */
  showWhen?: string;
  suffix?: string;
}

export interface SettingSection {
  title: string;
  description: string;
  fields: SettingField[];
}

export const SETTINGS_FORMS: Record<SettingScope, SettingSection> = {
  store: {
    title: 'Boutique',
    description: 'Identité légale et coordonnées, reprises sur les factures et le pied de page.',
    fields: [
      { key: 'store.name', label: 'Nom commercial', kind: 'text' },
      { key: 'store.legal_name', label: 'Raison sociale', kind: 'text' },
      { key: 'store.email', label: 'E-mail de contact', kind: 'email' },
      {
        key: 'store.phones',
        label: 'Téléphones',
        kind: 'list',
        hint: 'Un numéro par ligne ; le premier est affiché en tête de site.',
      },
      { key: 'store.address', label: 'Adresse', kind: 'textarea' },
      { key: 'store.rc', label: 'Registre de commerce', kind: 'text' },
      { key: 'store.nif', label: 'NIF', kind: 'text' },
      {
        key: 'store.currency',
        label: 'Devise',
        kind: 'select',
        options: [{ value: 'DZD', label: 'Dinar algérien (DA)' }],
        hint: 'Tous les montants sont stockés en centimes de dinar.',
      },
    ],
  },

  localisation: {
    title: 'Langues et fuseau',
    description: 'Ce que voient les visiteurs par défaut, et l’heure sur laquelle tout est calculé.',
    fields: [
      {
        key: 'store.timezone',
        label: 'Fuseau horaire',
        kind: 'select',
        options: [
          { value: 'Africa/Algiers', label: 'Alger (UTC+1)' },
          { value: 'UTC', label: 'UTC' },
        ],
        hint: 'Les statistiques journalières et les tournées sont découpées sur ce fuseau.',
      },
      {
        key: 'store.locales',
        label: 'Langues actives',
        kind: 'multiselect',
        options: [
          { value: 'fr', label: 'Français' },
          { value: 'ar', label: 'العربية' },
          { value: 'en', label: 'English' },
        ],
      },
      {
        key: 'store.default_locale',
        label: 'Langue par défaut',
        kind: 'select',
        options: [
          { value: 'fr', label: 'Français' },
          { value: 'ar', label: 'العربية' },
          { value: 'en', label: 'English' },
        ],
      },
    ],
  },

  tax: {
    title: 'TVA',
    description: 'Le taux appliqué et la façon dont il est présenté dans les prix.',
    fields: [
      { key: 'tax.vat_percent', label: 'Taux de TVA', kind: 'number', suffix: '%' },
      {
        key: 'tax.prices_include_tax',
        label: 'Prix TTC',
        kind: 'switch',
        hint: 'Les prix affichés incluent la TVA, comme le veut l’usage en Algérie.',
      },
    ],
  },

  orders: {
    title: 'Commandes',
    description: 'Numérotation, confirmation et garde-fous contre les fausses commandes.',
    fields: [
      {
        key: 'orders.stock_deduction_moment',
        label: 'Le stock est déduit',
        kind: 'select',
        options: [
          { value: 'confirmed', label: 'à la confirmation' },
          { value: 'packed', label: 'à la préparation' },
          { value: 'shipped', label: 'à l’expédition' },
          { value: 'delivered', label: 'à la livraison' },
        ],
        hint: 'Avant ce moment les unités sont réservées, pas retirées.',
      },
      { key: 'orders.number_format', label: 'Format du numéro', kind: 'text' },
      {
        key: 'orders.auto_confirm',
        label: 'Confirmer automatiquement',
        kind: 'switch',
        hint: 'À n’activer que si personne n’appelle les clients avant expédition.',
      },
      {
        key: 'orders.duplicate_window_minutes',
        label: 'Fenêtre anti-doublon',
        kind: 'number',
        suffix: 'min',
        hint: 'Deux commandes identiques du même numéro dans ce délai sont signalées.',
      },
      {
        key: 'orders.max_per_phone_per_day',
        label: 'Commandes maximum par téléphone et par jour',
        kind: 'number',
      },
      {
        key: 'orders.captcha_after_attempts',
        label: 'Captcha après',
        kind: 'number',
        suffix: 'essais',
      },
      {
        key: 'orders.require_otp',
        label: 'Vérifier le téléphone par SMS',
        kind: 'switch',
        hint: 'Réduit fortement les fausses commandes, au prix d’une étape de plus.',
      },
    ],
  },

  checkout: {
    title: 'Ligne de caisse',
    description: 'Ce que le client remplit, et à partir de quel montant il ne paie plus la livraison.',
    fields: [
      {
        key: 'checkout.free_shipping_threshold',
        label: 'Livraison offerte à partir de',
        kind: 'money',
        hint: 'Zéro désactive la barre de progression du panier.',
      },
      { key: 'checkout.allow_guest', label: 'Commande sans compte', kind: 'switch' },
      { key: 'checkout.collect_email', label: 'Demander l’e-mail', kind: 'switch' },
      {
        key: 'checkout.second_phone',
        label: 'Demander un second numéro',
        kind: 'switch',
        hint: 'Améliore nettement le taux de livraison réussie.',
      },
    ],
  },

  loyalty: {
    title: 'Fidélité',
    description: 'Points gagnés à la livraison, utilisables en réduction à la commande suivante.',
    fields: [
      { key: 'loyalty.enabled', label: 'Programme actif', kind: 'switch' },
      {
        key: 'loyalty.points_per_currency_unit',
        label: 'Points par dinar dépensé',
        kind: 'number',
        hint: '0,01 donne 1 point pour 100 DA.',
      },
      { key: 'loyalty.point_value_centimes', label: 'Valeur d’un point', kind: 'money' },
      {
        key: 'loyalty.max_order_percent',
        label: 'Réduction maximale par commande',
        kind: 'number',
        suffix: '%',
      },
    ],
  },

  inventory: {
    title: 'Stock',
    description: 'Seuils par défaut appliqués aux produits qui n’en définissent pas.',
    fields: [
      { key: 'inventory.low_stock_threshold', label: 'Seuil de stock bas', kind: 'number' },
      {
        key: 'inventory.allow_backorder',
        label: 'Autoriser la vente en rupture',
        kind: 'switch',
        hint: 'À réserver aux produits que vous savez pouvoir réapprovisionner vite.',
      },
    ],
  },

  theme: {
    title: 'Thème',
    description: 'Les couleurs de la vitrine. Le laiton sur fond sombre est l’identité de la marque.',
    fields: [
      { key: 'theme.primary_color', label: 'Couleur d’accent', kind: 'color' },
      { key: 'theme.base_color', label: 'Fond', kind: 'color' },
      { key: 'theme.surface_color', label: 'Surfaces', kind: 'color' },
    ],
  },

  integrations: {
    title: 'Pixels et analytics',
    description: 'Identifiants injectés dans la vitrine, sous réserve du consentement du visiteur.',
    fields: [
      { key: 'integrations.ga4_id', label: 'Google Analytics 4', kind: 'text', hint: 'G-XXXXXXXXXX' },
      { key: 'integrations.meta_pixel_id', label: 'Pixel Meta', kind: 'text' },
      { key: 'integrations.tiktok_pixel_id', label: 'Pixel TikTok', kind: 'text' },
      {
        key: 'integrations.cookie_banner',
        label: 'Bandeau de consentement',
        kind: 'switch',
        hint: 'Les pixels ne se chargent qu’après acceptation.',
      },
    ],
  },

  notifications: {
    title: 'Notifications',
    description: 'Par où partent les SMS, les e-mails et les alertes du propriétaire.',
    fields: [
      {
        key: 'notifications.sms_driver',
        label: 'Passerelle SMS',
        kind: 'select',
        options: [
          { value: 'log', label: 'Journal (aucun envoi réel)' },
          { value: 'twilio', label: 'Twilio' },
          { value: 'http', label: 'Passerelle HTTP générique' },
          { value: 'whatsapp', label: 'WhatsApp Cloud' },
        ],
      },
      {
        key: 'notifications.sms_endpoint',
        label: 'URL de la passerelle',
        kind: 'text',
        showWhen: 'notifications.sms_driver',
      },
      { key: 'notifications.sms_credentials', label: 'Identifiants passerelle', kind: 'secret' },
      {
        key: 'notifications.email_driver',
        label: 'Envoi des e-mails',
        kind: 'select',
        options: [
          { value: 'log', label: 'Journal' },
          { value: 'smtp', label: 'SMTP' },
        ],
      },
      { key: 'notifications.telegram_enabled', label: 'Alertes Telegram', kind: 'switch' },
      { key: 'notifications.telegram_token', label: 'Jeton du bot Telegram', kind: 'secret' },
      { key: 'notifications.telegram_chat_id', label: 'Identifiant de discussion', kind: 'text' },
      {
        key: 'notifications.owner_alerts',
        label: 'Alertes reçues par le propriétaire',
        kind: 'multiselect',
        options: [
          { value: 'order.placed', label: 'Nouvelle commande' },
          { value: 'delivery.failed', label: 'Livraison échouée' },
          { value: 'inventory.low', label: 'Stock bas' },
          { value: 'review.pending', label: 'Avis à modérer' },
        ],
      },
    ],
  },

  payments: {
    title: 'Paiements',
    description: 'Le paiement à la livraison reste le mode par défaut du marché algérien.',
    fields: [
      {
        key: 'payments.default_provider',
        label: 'Mode par défaut',
        kind: 'select',
        options: [
          { value: 'cod', label: 'Paiement à la livraison' },
          { value: 'chargily', label: 'Chargily (CIB / Edahabia)' },
        ],
      },
      { key: 'payments.cod_enabled', label: 'Paiement à la livraison', kind: 'switch' },
      { key: 'payments.chargily_enabled', label: 'Chargily', kind: 'switch' },
      { key: 'payments.chargily_api_key', label: 'Clé API Chargily', kind: 'secret' },
      { key: 'payments.chargily_secret', label: 'Secret de webhook Chargily', kind: 'secret' },
      {
        key: 'payments.cod_deposit_minor',
        label: 'Acompte demandé à la commande',
        kind: 'money',
        hint: 'Zéro pour ne rien demander d’avance.',
      },
    ],
  },

  couriers: {
    title: 'Transporteurs',
    description: 'Comment les expéditions partent et à quelle fréquence leur suivi est relu.',
    fields: [
      {
        key: 'couriers.default_provider',
        label: 'Transporteur par défaut',
        kind: 'select',
        options: [
          { value: 'manual', label: 'Manuel (export CSV)' },
          { value: 'yalidine', label: 'Yalidine' },
          { value: 'zrexpress', label: 'ZR Express' },
          { value: 'maystro', label: 'Maystro' },
          { value: 'ems', label: 'EMS Algérie' },
        ],
      },
      {
        key: 'couriers.auto_create_shipment',
        label: 'Créer l’expédition à la préparation',
        kind: 'switch',
      },
      {
        key: 'couriers.sync_interval_minutes',
        label: 'Relire le suivi toutes les',
        kind: 'number',
        suffix: 'min',
      },
    ],
  },

  maintenance: {
    title: 'Maintenance',
    description: 'Ferme la vitrine au public sans arrêter l’administration.',
    fields: [
      { key: 'store.maintenance_mode', label: 'Mode maintenance', kind: 'switch' },
      {
        key: 'store.maintenance_message',
        label: 'Message affiché',
        kind: 'textarea',
        hint: 'Visible par les visiteurs pendant la fermeture.',
      },
    ],
  },
};
