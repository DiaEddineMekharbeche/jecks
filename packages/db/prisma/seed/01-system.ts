import { hash } from '@node-rs/argon2';
import { PERMISSIONS, PERMISSION_GROUPS, ROLE_PERMISSIONS, RoleSlug } from '@jecks/shared';
import type { PrismaClient } from '@prisma/client';
import { NOTIFICATION_TEMPLATES } from './templates.js';
import { log, tr } from './util.js';

const ROLE_NAMES: Record<string, { fr: string; ar: string; en: string }> = {
  owner: { fr: 'Propriétaire', ar: 'المالك', en: 'Owner' },
  manager: { fr: 'Responsable', ar: 'مسؤول', en: 'Manager' },
  order_agent: { fr: 'Agent commandes', ar: 'وكيل الطلبات', en: 'Order agent' },
  warehouse: { fr: 'Magasinier', ar: 'أمين المخزن', en: 'Warehouse' },
  driver: { fr: 'Livreur', ar: 'موصل', en: 'Driver' },
  marketing: { fr: 'Marketing', ar: 'التسويق', en: 'Marketing' },
  accountant: { fr: 'Comptable', ar: 'محاسب', en: 'Accountant' },
};

/** Reverse index so each permission knows which group screen it belongs to. */
const GROUP_OF = new Map<string, string>();
for (const [group, keys] of Object.entries(PERMISSION_GROUPS)) {
  for (const key of keys) GROUP_OF.set(key, group);
}

export async function seedSystem(prisma: PrismaClient): Promise<{ ownerId: string }> {
  // --- permissions -----------------------------------------------------------
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, group: GROUP_OF.get(key) ?? 'Other' },
      update: { group: GROUP_OF.get(key) ?? 'Other' },
    });
  }
  log('permissions', PERMISSIONS.length);

  const permissionIds = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
  );

  // --- roles -----------------------------------------------------------------
  for (const slug of Object.values(RoleSlug)) {
    const names = ROLE_NAMES[slug] ?? { fr: slug, ar: slug, en: slug };
    const role = await prisma.role.upsert({
      where: { slug },
      create: { slug, name: tr(names.fr, names.ar, names.en), isSystem: true },
      update: { name: tr(names.fr, names.ar, names.en) },
    });
    // Re-grant from scratch so a permission removed from the catalogue is revoked.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: (ROLE_PERMISSIONS[slug] ?? [])
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }
  log('roles', Object.values(RoleSlug).length);

  // --- staff -----------------------------------------------------------------
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Jecks2026!';
  const passwordHash = await hash(password);
  const roleIds = new Map(
    (await prisma.role.findMany({ select: { id: true, slug: true } })).map((r) => [r.slug, r.id]),
  );

  const staff = [
    { email: process.env.SEED_OWNER_EMAIL ?? 'owner@jecks.dz', name: 'Maher', phone: '+213551000001', role: RoleSlug.OWNER },
    { email: 'manager@jecks.dz', name: 'Nadia Belkacem', phone: '+213551000002', role: RoleSlug.MANAGER },
    { email: 'agent@jecks.dz', name: 'Yacine Haddad', phone: '+213551000003', role: RoleSlug.ORDER_AGENT },
    { email: 'warehouse@jecks.dz', name: 'Karim Slimani', phone: '+213551000004', role: RoleSlug.WAREHOUSE },
    { email: 'marketing@jecks.dz', name: 'Lina Cherif', phone: '+213551000005', role: RoleSlug.MARKETING },
    { email: 'accountant@jecks.dz', name: 'Sofiane Amrani', phone: '+213551000006', role: RoleSlug.ACCOUNTANT },
    { email: 'driver1@jecks.dz', name: 'Rachid Boumediene', phone: '+213661000011', role: RoleSlug.DRIVER },
    { email: 'driver2@jecks.dz', name: 'Amine Zerrouki', phone: '+213661000012', role: RoleSlug.DRIVER },
  ];

  let ownerId = '';
  for (const person of staff) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      create: {
        email: person.email,
        name: person.name,
        phone: person.phone,
        passwordHash,
        type: 'STAFF',
      },
      update: { name: person.name, phone: person.phone },
    });
    if (person.role === RoleSlug.OWNER) ownerId = user.id;

    const roleId = roleIds.get(person.role);
    if (roleId) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        create: { userId: user.id, roleId },
        update: {},
      });
    }
  }
  log('staff users', staff.length);

  // --- settings --------------------------------------------------------------
  const settings: Array<{ key: string; value: unknown; scope?: string; secret?: boolean }> = [
    { key: 'store.name', value: "Jeck's", scope: 'store' },
    { key: 'store.legal_name', value: "Jeck's Headwear SARL", scope: 'store' },
    { key: 'store.email', value: 'contact@jecks.dz', scope: 'store' },
    { key: 'store.phones', value: ['+213551000000'], scope: 'store' },
    { key: 'store.address', value: 'Cité 1200 Logements, Bab Ezzouar, Alger', scope: 'store' },
    { key: 'store.rc', value: '16/00-1234567 B 24', scope: 'store' },
    { key: 'store.nif', value: '001916012345678', scope: 'store' },
    { key: 'store.currency', value: 'DZD', scope: 'store' },
    { key: 'store.timezone', value: 'Africa/Algiers', scope: 'store' },
    { key: 'store.locales', value: ['fr', 'ar', 'en'], scope: 'store' },
    { key: 'store.default_locale', value: 'fr', scope: 'store' },
    { key: 'store.maintenance_mode', value: false, scope: 'store' },

    { key: 'tax.vat_percent', value: 19, scope: 'tax' },
    { key: 'tax.prices_include_tax', value: true, scope: 'tax' },

    // PRD Section 7 and DECISIONS D20.
    { key: 'orders.stock_deduction_moment', value: 'confirmed', scope: 'orders' },
    { key: 'orders.number_format', value: 'JK-{YYMMDD}-{SEQ}', scope: 'orders' },
    { key: 'orders.auto_confirm', value: false, scope: 'orders' },
    { key: 'orders.duplicate_window_minutes', value: 30, scope: 'orders' },
    { key: 'orders.max_per_phone_per_day', value: 3, scope: 'orders' },
    { key: 'orders.captcha_after_attempts', value: 3, scope: 'orders' },
    { key: 'orders.require_otp', value: false, scope: 'orders' },

    { key: 'checkout.free_shipping_threshold', value: 600000, scope: 'checkout' },
    { key: 'checkout.allow_guest', value: true, scope: 'checkout' },
    { key: 'checkout.collect_email', value: false, scope: 'checkout' },
    { key: 'checkout.second_phone', value: true, scope: 'checkout' },

    // PRD Section 6.5 — 1 point per 100 DA, 1 point redeems 5 DA, capped at 20 %.
    { key: 'loyalty.enabled', value: true, scope: 'loyalty' },
    { key: 'loyalty.points_per_currency_unit', value: 0.01, scope: 'loyalty' },
    { key: 'loyalty.point_value_centimes', value: 500, scope: 'loyalty' },
    { key: 'loyalty.max_order_percent', value: 20, scope: 'loyalty' },

    { key: 'inventory.low_stock_threshold', value: 5, scope: 'inventory' },
    { key: 'inventory.allow_backorder', value: false, scope: 'inventory' },

    { key: 'theme.primary_color', value: '#D9B36A', scope: 'theme' },
    { key: 'theme.base_color', value: '#0F0F10', scope: 'theme' },
    { key: 'theme.surface_color', value: '#1A1A1C', scope: 'theme' },

    { key: 'integrations.ga4_id', value: '', scope: 'integrations' },
    { key: 'integrations.meta_pixel_id', value: '', scope: 'integrations' },
    { key: 'integrations.tiktok_pixel_id', value: '', scope: 'integrations' },
    { key: 'integrations.cookie_banner', value: true, scope: 'integrations' },

    { key: 'notifications.telegram_enabled', value: false, scope: 'notifications', secret: true },
    { key: 'notifications.sms_driver', value: 'log', scope: 'notifications' },
    { key: 'notifications.owner_alerts', value: ['order.placed', 'delivery.failed', 'inventory.low'], scope: 'notifications' },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: {
        key: setting.key,
        scope: setting.scope ?? 'global',
        value: setting.value as never,
        secret: setting.secret ?? false,
      },
      update: { value: setting.value as never },
    });
  }
  log('settings', settings.length);

  // --- notification templates ------------------------------------------------
  //
  // The bodies live in templates.ts so their variable names sit next to the list the
  // admin editor offers. A name that drifts renders as a literal placeholder in a real
  // SMS, which nobody notices until a customer forwards one.
  const templates = NOTIFICATION_TEMPLATES;

  for (const template of templates) {
    await prisma.notificationTemplate.upsert({
      where: { event_channel: { event: template.event, channel: template.channel } },
      create: {
        event: template.event,
        channel: template.channel,
        subject: (template as { subject?: unknown }).subject as never,
        body: template.body as never,
      },
      update: {
        body: template.body as never,
        subject: ((template as { subject?: unknown }).subject ?? null) as never,
      },
    });
  }
  log('notification templates', templates.length);

  return { ownerId };
}
