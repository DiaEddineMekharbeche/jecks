'use client';

import {
  format,
  money,
  t,
  type AccountProfile,
  type AddressDto,
  type Locale,
  type LoyaltyEntry,
  type OrderStatus,
  type TrackedOrder,
  type WishlistEntry,
} from '@jecks/shared';
import { Button, cn } from '@jecks/ui';
import { Check, MapPin, Package, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clientApi, errorMessage } from '@/lib/client-api';
import { fill, orderStatusLabel, type Dictionary } from '@/lib/dictionary';

/**
 * The account panels — PRD F-ST-51.
 *
 * Each one owns its own fetch rather than sharing a loader: they are five independent
 * screens a shopper visits one at a time, and a single store would make every visit
 * wait for data four of them do not use.
 */

// --- profile ----------------------------------------------------------------

export function ProfilePanel({ dictionary }: { dictionary: Dictionary; locale: Locale }) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clientApi<AccountProfile>('/account')
      .then((data) => {
        setProfile(data);
        setFullName(data.fullName);
        setEmail(data.email ?? '');
        setMarketing(data.acceptsMarketing);
      })
      .catch((loadError) => setError(errorMessage(loadError, dictionary.common.error)));
  }, [dictionary.common.error]);

  if (!profile) {
    return <p className="text-sm text-muted">{error ?? dictionary.common.loading}</p>;
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      <h1 className="text-section">{dictionary.account.profile}</h1>

      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setSaved(false);
          try {
            const updated = await clientApi<AccountProfile>('/account', {
              method: 'PATCH',
              body: { fullName, email: email || undefined, acceptsMarketing: marketing },
            });
            setProfile(updated);
            setSaved(true);
          } catch (saveError) {
            setError(errorMessage(saveError, dictionary.common.error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={dictionary.contact.name}>
          <input
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="input-line"
          />
        </Field>

        <Field label={dictionary.account.phone}>
          <input readOnly dir="ltr" value={profile.phone} className="input-line opacity-60" />
        </Field>

        <Field label={dictionary.contact.email}>
          <input
            type="email"
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input-line"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(event) => setMarketing(event.target.checked)}
            className="h-4 w-4 accent-brass"
          />
          {dictionary.footer.newsletter}
        </label>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy}>
            {dictionary.account.save}
          </Button>
          {saved ? (
            <span className="flex items-center gap-1 text-sm text-success">
              <Check className="h-4 w-4" />
              {dictionary.account.saved}
            </span>
          ) : null}
        </div>
      </form>

      <div className="border-t border-line pt-6">
        {confirmingDelete ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{dictionary.account.deleteWarning}</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                {dictionary.common.back}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await clientApi('/account', { method: 'DELETE' });
                    window.location.href = '/';
                  } catch (deleteError) {
                    setError(errorMessage(deleteError, dictionary.common.error));
                    setBusy(false);
                  }
                }}
              >
                {dictionary.account.deleteAccount}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-sm text-muted underline-offset-2 hover:text-danger hover:underline"
          >
            {dictionary.account.deleteAccount}
          </button>
        )}
      </div>
    </div>
  );
}

// --- orders -----------------------------------------------------------------

export function OrdersPanel({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const [orders, setOrders] = useState<TrackedOrder[] | null>(null);

  useEffect(() => {
    clientApi<TrackedOrder[]>('/account/orders')
      .then(setOrders)
      .catch(() => setOrders([]));
  }, []);

  if (!orders) return <p className="text-sm text-muted">{dictionary.common.loading}</p>;

  if (orders.length === 0) {
    return (
      <Empty
        icon={<Package className="h-8 w-8" />}
        title={dictionary.account.noOrders}
        action={
          <Link
            href={`/${locale}`}
            className="border border-line px-5 py-2 text-sm uppercase tracking-wider transition-colors hover:border-brass hover:text-brass"
          >
            {dictionary.cart.continue}
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-section">{dictionary.account.orders}</h1>
      <ul className="flex flex-col gap-3">
        {orders.map((order) => (
          <li key={order.number}>
            <Link
              href={`/${locale}/account/orders/${order.number}`}
              className="flex flex-wrap items-center justify-between gap-3 border border-line p-4 transition-colors hover:border-brass"
            >
              <div>
                <p className="font-medium">{order.number}</p>
                <p className="text-xs text-muted">
                  {new Intl.DateTimeFormat(`${locale}-DZ`, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }).format(new Date(order.placedAt))}
                </p>
              </div>
              <StatusPill status={order.status} dictionary={dictionary} />
              <span className="tabular-nums">
                {format(money(BigInt(order.totalMinor)), { locale: `${locale}-DZ` })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrderDetail({
  order,
  locale,
  dictionary,
}: {
  order: TrackedOrder;
  locale: Locale;
  dictionary: Dictionary;
}) {
  const formatter = new Intl.DateTimeFormat(`${locale}-DZ`, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-section">{order.number}</h1>
          <p className="mt-1 text-sm text-muted">
            {dictionary.track.placedOn} {formatter.format(new Date(order.placedAt))}
          </p>
        </div>
        <StatusPill status={order.status} dictionary={dictionary} />
      </div>

      <ol className="relative flex flex-col gap-4 border-s border-line ps-6">
        {order.timeline.map((event, index) => (
          <li key={`${event.status}-${event.at}`} className="relative">
            <span
              className={cn(
                'absolute -start-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full',
                index === order.timeline.length - 1 ? 'bg-brass' : 'bg-line',
              )}
            />
            <p className="text-sm font-medium">
              {orderStatusLabel(dictionary, event.status)}
            </p>
            <p className="text-xs text-muted">{formatter.format(new Date(event.at))}</p>
            {event.note ? <p className="mt-0.5 text-xs text-muted">{event.note}</p> : null}
          </li>
        ))}
      </ol>

      {order.courierName || order.trackingNumber ? (
        <dl className="grid gap-2 border border-line p-4 text-sm sm:grid-cols-2">
          {order.courierName ? (
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">
                {dictionary.track.courier}
              </dt>
              <dd>{order.courierName}</dd>
            </div>
          ) : null}
          {order.trackingNumber ? (
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">
                {dictionary.track.tracking}
              </dt>
              <dd className="font-mono">{order.trackingNumber}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {order.items.map((item, index) => (
          <li key={index} className="flex items-center gap-4 py-4">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt=""
                width={56}
                height={70}
                className="h-[70px] w-14 rounded-xs object-cover"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t(item.productName, locale)}</p>
              {item.variantName ? (
                <p className="truncate text-xs text-muted">{item.variantName}</p>
              ) : null}
            </div>
            <span className="text-sm text-muted">× {item.quantity}</span>
            <span className="text-sm tabular-nums">
              {format(money(BigInt(item.unitPriceMinor) * BigInt(item.quantity)), {
                locale: `${locale}-DZ`,
              })}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex justify-between text-lg">
        <span className="font-medium">{dictionary.cart.total}</span>
        <span className="font-semibold tabular-nums">
          {format(money(BigInt(order.totalMinor)), { locale: `${locale}-DZ` })}
        </span>
      </div>
    </div>
  );
}

// --- addresses --------------------------------------------------------------

export function AddressesPanel({ dictionary }: { dictionary: Dictionary; locale: Locale }) {
  const [addresses, setAddresses] = useState<AddressDto[] | null>(null);
  const [wilayas, setWilayas] = useState<Array<{ code: number; name: Record<string, string> }>>([]);
  const [communes, setCommunes] = useState<Array<{ id: string; name: Record<string, string> }>>([]);
  const [editing, setEditing] = useState<AddressDto | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    altPhone: '',
    wilayaCode: 0,
    communeId: '',
    address: '',
    label: '',
    isDefault: false,
  });

  useEffect(() => {
    clientApi<AddressDto[]>('/account/addresses')
      .then(setAddresses)
      .catch(() => setAddresses([]));
    clientApi<Array<{ code: number; name: Record<string, string> }>>('/shipping/wilayas')
      .then(setWilayas)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!form.wilayaCode) {
      setCommunes([]);
      return;
    }
    clientApi<Array<{ id: string; name: Record<string, string> }>>(
      `/shipping/wilayas/${form.wilayaCode}/communes`,
    )
      .then(setCommunes)
      .catch(() => setCommunes([]));
  }, [form.wilayaCode]);

  function open(address: AddressDto | 'new') {
    setEditing(address);
    setError(null);
    setForm(
      address === 'new'
        ? {
            fullName: '',
            phone: '',
            altPhone: '',
            wilayaCode: 0,
            communeId: '',
            address: '',
            label: '',
            isDefault: (addresses ?? []).length === 0,
          }
        : {
            fullName: address.fullName,
            phone: address.phone,
            altPhone: address.altPhone ?? '',
            wilayaCode: address.wilayaCode,
            communeId: address.communeId ?? '',
            address: address.address,
            label: address.label ?? '',
            isDefault: address.isDefault,
          },
    );
  }

  if (!addresses) return <p className="text-sm text-muted">{dictionary.common.loading}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-section">{dictionary.account.addresses}</h1>
        <Button variant="outline" size="md" onClick={() => open('new')}>
          {dictionary.account.addAddress}
        </Button>
      </div>

      {addresses.length === 0 && !editing ? (
        <Empty icon={<MapPin className="h-8 w-8" />} title={dictionary.account.noAddresses} />
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {addresses.map((address) => (
          <li key={address.id} className="flex flex-col gap-2 border border-line p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{address.fullName}</p>
                <p className="truncate text-xs text-muted" dir="ltr">
                  {address.phone}
                </p>
              </div>
              {address.isDefault ? (
                <span className="shrink-0 rounded-xs bg-brass/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brass">
                  {dictionary.account.defaultAddress}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted">
              {address.address}
              <br />
              {address.communeName ? `${address.communeName}, ` : ''}
              {address.wilayaName}
            </p>
            <div className="mt-auto flex gap-3 pt-2 text-xs">
              <button
                type="button"
                className="text-muted underline-offset-2 hover:text-ink hover:underline"
                onClick={() => open(address)}
              >
                {dictionary.account.editAddress}
              </button>
              <button
                type="button"
                className="flex items-center gap-1 text-muted underline-offset-2 hover:text-danger hover:underline"
                onClick={async () => {
                  setAddresses(await clientApi(`/account/addresses/${address.id}`, {
                    method: 'DELETE',
                  }));
                }}
              >
                <Trash2 className="h-3 w-3" />
                {dictionary.account.deleteAddress}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editing ? (
        <form
          className="flex max-w-lg flex-col gap-4 border border-line p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const payload = {
                ...form,
                label: form.label || undefined,
                altPhone: form.altPhone || undefined,
              };
              const updated =
                editing === 'new'
                  ? await clientApi<AddressDto[]>('/account/addresses', {
                      method: 'POST',
                      body: payload,
                    })
                  : await clientApi<AddressDto[]>(`/account/addresses/${editing.id}`, {
                      method: 'PATCH',
                      body: payload,
                    });
              setAddresses(updated);
              setEditing(null);
            } catch (saveError) {
              setError(errorMessage(saveError, dictionary.common.error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={dictionary.contact.name}>
            <input
              required
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              className="input-line"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={dictionary.contact.phone}>
              <input
                required
                type="tel"
                dir="ltr"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                className="input-line"
              />
            </Field>
            <Field label={`${dictionary.contact.phone} 2`}>
              <input
                type="tel"
                dir="ltr"
                value={form.altPhone}
                onChange={(event) => setForm({ ...form, altPhone: event.target.value })}
                className="input-line"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={dictionary.delivery.chooseWilaya}>
              <select
                required
                value={form.wilayaCode || ''}
                onChange={(event) =>
                  setForm({ ...form, wilayaCode: Number(event.target.value), communeId: '' })
                }
                className="input-line"
              >
                <option value="">—</option>
                {wilayas.map((wilaya) => (
                  <option key={wilaya.code} value={wilaya.code}>
                    {wilaya.code} — {wilaya.name.fr}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Commune">
              <select
                required
                value={form.communeId}
                disabled={communes.length === 0}
                onChange={(event) => setForm({ ...form, communeId: event.target.value })}
                className="input-line"
              >
                <option value="">—</option>
                {communes.map((commune) => (
                  <option key={commune.id} value={commune.id}>
                    {commune.name.fr}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={dictionary.contact.subject}>
            <textarea
              required
              rows={2}
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
              className="input-line"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
              className="h-4 w-4 accent-brass"
            />
            {dictionary.account.defaultAddress}
          </label>

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              {dictionary.common.back}
            </Button>
            <Button type="submit" loading={busy}>
              {dictionary.account.save}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// --- wishlist ---------------------------------------------------------------

export function WishlistPanel({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const [items, setItems] = useState<WishlistEntry[] | null>(null);

  useEffect(() => {
    clientApi<WishlistEntry[]>('/wishlist')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  if (!items) return <p className="text-sm text-muted">{dictionary.common.loading}</p>;

  if (items.length === 0) {
    return <Empty icon={<span className="text-3xl">♡</span>} title={dictionary.account.noWishlist} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-section">{dictionary.account.wishlist}</h1>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="group flex flex-col gap-2">
            <Link href={`/${locale}/products/${item.productSlug}`} className="block">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={t(item.productName, locale)}
                  className="aspect-[4/5] w-full rounded-xs object-cover"
                />
              ) : (
                <span className="block aspect-[4/5] w-full rounded-xs border border-line" />
              )}
            </Link>
            <Link
              href={`/${locale}/products/${item.productSlug}`}
              className="text-sm font-medium hover:text-brass"
            >
              {t(item.productName, locale)}
            </Link>
            <div className="flex items-center justify-between text-sm">
              <span className="tabular-nums">
                {format(money(BigInt(item.priceMinor)), { locale: `${locale}-DZ` })}
              </span>
              <span className={item.inStock ? 'text-xs text-success' : 'text-xs text-danger'}>
                {item.inStock ? dictionary.product.inStock : dictionary.product.outOfStock}
              </span>
            </div>
            <button
              type="button"
              className="self-start text-xs text-muted underline-offset-2 hover:text-danger hover:underline"
              onClick={async () => {
                setItems(await clientApi(`/wishlist/${item.id}`, { method: 'DELETE' }));
              }}
            >
              {dictionary.cart.remove}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- loyalty ----------------------------------------------------------------

export function LoyaltyPanel({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [ledger, setLedger] = useState<LoyaltyEntry[]>([]);

  useEffect(() => {
    void Promise.all([
      clientApi<AccountProfile>('/account').then(setProfile).catch(() => undefined),
      clientApi<LoyaltyEntry[]>('/account/loyalty').then(setLedger).catch(() => undefined),
    ]);
  }, []);

  if (!profile) return <p className="text-sm text-muted">{dictionary.common.loading}</p>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-section">{dictionary.account.loyalty}</h1>

      <div className="flex items-center gap-4 border border-brass/30 bg-brass/5 p-5">
        <Sparkles className="h-8 w-8 shrink-0 text-brass" />
        <div>
          <p className="text-2xl font-semibold tabular-nums text-brass">
            {fill(dictionary.account.points, { count: profile.loyaltyPoints })}
          </p>
          <p className="text-sm text-muted">
            {fill(dictionary.account.pointsWorth, {
              amount: format(money(BigInt(profile.loyaltyValueMinor)), {
                locale: `${locale}-DZ`,
              }),
            })}
          </p>
        </div>
      </div>

      {ledger.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {ledger.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">{entry.note ?? entry.orderNumber ?? entry.kind}</p>
                <p className="text-xs text-muted">
                  {new Intl.DateTimeFormat(`${locale}-DZ`, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }).format(new Date(entry.createdAt))}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 tabular-nums',
                  entry.points >= 0 ? 'text-success' : 'text-danger',
                )}
              >
                {entry.points > 0 ? `+${entry.points}` : entry.points}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// --- shared -----------------------------------------------------------------

export function StatusPill({
  status,
  dictionary,
}: {
  status: OrderStatus;
  dictionary: Dictionary;
}) {
  const tone =
    status === 'DELIVERED'
      ? 'bg-success/15 text-success'
      : status === 'CANCELLED' || status === 'FAILED' || status === 'RETURNED'
        ? 'bg-danger/15 text-danger'
        : status === 'PENDING'
          ? 'bg-warning/15 text-warning'
          : 'bg-info/15 text-info';

  return (
    <span
      className={cn('rounded-xs px-2.5 py-1 text-[11px] uppercase tracking-wider', tone)}
    >
      {orderStatusLabel(dictionary, status)}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

function Empty({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 border border-dashed border-line py-16 text-center">
      <span className="text-muted">{icon}</span>
      <p className="text-sm text-muted">{title}</p>
      {action}
    </div>
  );
}
