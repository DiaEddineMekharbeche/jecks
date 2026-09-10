'use client';

import {
  DeliveryType,
  format,
  isValidDzPhone,
  money,
  t,
  type Locale,
} from '@jecks/shared';
import { Button, cn } from '@jecks/ui';
import { AlertCircle, Building2, Home, Loader2, ShieldCheck, Truck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { track } from '@/lib/analytics';
import { useCart } from '@/lib/cart-store';
import { ApiError, clientApi, errorMessage } from '@/lib/client-api';
import { fill, type Dictionary } from '@/lib/dictionary';
import { useSession } from '@/lib/session-store';

/**
 * One-page checkout — PRD F-ST-42.
 *
 * Everything on one screen, in the order a shopper thinks in: who you are, where it
 * goes, what it costs. A multi-step checkout on a COD store is a multi-step abandonment
 * funnel; there is no payment step to justify one.
 *
 * The browser never computes a total. Choosing a wilaya re-quotes the shipping on the
 * server, and the figure shown is the figure the driver will ask for.
 */

interface Wilaya {
  code: number;
  name: Record<string, string>;
}
interface Commune {
  id: string;
  name: Record<string, string>;
}
interface PickupPoint {
  id: string;
  name: string;
  address: string | null;
}

interface PlacedOrder {
  orderId: string;
  number: string;
  totalMinor: string;
  trackingUrl: string;
  checkoutUrl: string | null;
}

export function CheckoutForm({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const cart = useCart((state) => state.cart);
  const loadCart = useCart((state) => state.load);
  const setDelivery = useCart((state) => state.setDelivery);
  const shopper = useSession((state) => state.shopper);
  const loadSession = useSession((state) => state.load);

  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    altPhone: '',
    email: '',
    wilayaCode: 0,
    communeId: '',
    deliveryType: DeliveryType.HOME as DeliveryType,
    address: '',
    pickupPointId: '',
    note: '',
    acceptsMarketing: false,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);

  // A key generated once per mounted form. A double-tap on a slow connection sends the
  // same key twice, and the server returns the first order rather than making a second.
  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    [],
  );

  useEffect(() => {
    void loadCart();
    void loadSession();
    clientApi<Wilaya[]>('/shipping/wilayas')
      .then(setWilayas)
      .catch(() => undefined);
    track({ name: 'checkout_start' });
  }, [loadCart, loadSession]);

  // Prefill from the signed-in shopper: a returning customer should type as little as
  // possible, which is most of what makes a repeat order happen at all.
  useEffect(() => {
    if (!shopper) return;
    setForm((current) => ({
      ...current,
      fullName: current.fullName || shopper.name,
      phone: current.phone || (shopper.phone ?? ''),
    }));
  }, [shopper]);

  useEffect(() => {
    if (!form.wilayaCode) {
      setCommunes([]);
      setPickupPoints([]);
      return;
    }
    void Promise.all([
      clientApi<Commune[]>(`/shipping/wilayas/${form.wilayaCode}/communes`)
        .then(setCommunes)
        .catch(() => setCommunes([])),
      clientApi<PickupPoint[]>(`/shipping/wilayas/${form.wilayaCode}/pickup-points`)
        .then(setPickupPoints)
        .catch(() => setPickupPoints([])),
    ]);
  }, [form.wilayaCode]);

  // Re-quote as soon as there is a destination, so the total on screen is real before
  // the shopper commits to it.
  useEffect(() => {
    if (!form.wilayaCode) return;
    void setDelivery(form.wilayaCode, form.deliveryType);
  }, [form.wilayaCode, form.deliveryType, setDelivery]);

  const items = cart?.items ?? [];
  const amount = (value: string | null | undefined) =>
    format(money(BigInt(value ?? '0')), { locale: `${locale}-DZ` });

  const ready =
    form.fullName.trim().length >= 3 &&
    isValidDzPhone(form.phone) &&
    form.wilayaCode > 0 &&
    form.communeId !== '' &&
    (form.deliveryType === DeliveryType.HOME
      ? form.address.trim().length >= 8
      : form.pickupPointId !== '') &&
    items.length > 0;

  async function submit() {
    if (!cart) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const order = await clientApi<PlacedOrder>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          cartToken: cart.token,
          customer: {
            fullName: form.fullName.trim(),
            phone: form.phone.trim(),
            altPhone: form.altPhone.trim() || undefined,
            email: form.email.trim() || undefined,
          },
          shipping: {
            wilayaCode: form.wilayaCode,
            communeId: form.communeId,
            deliveryType: form.deliveryType,
            address: form.deliveryType === DeliveryType.HOME ? form.address.trim() : undefined,
            pickupPointId:
              form.deliveryType === DeliveryType.STOP_DESK ? form.pickupPointId : undefined,
            note: form.note.trim() || undefined,
          },
          payment: { method: 'COD' },
          acceptsMarketing: form.acceptsMarketing,
        },
      });

      track({ name: 'purchase', orderId: order.orderId, valueMinor: Number(order.totalMinor) });

      if (order.checkoutUrl) {
        window.location.href = order.checkoutUrl;
        return;
      }

      setPlaced(order);
      void loadCart();
    } catch (submitError) {
      if (submitError instanceof ApiError && Array.isArray(submitError.details)) {
        const out: Record<string, string> = {};
        for (const issue of submitError.details as Array<{ path?: string; message?: string }>) {
          if (issue.path && issue.message) out[issue.path] = issue.message;
        }
        setFieldErrors(out);
      }
      setError(errorMessage(submitError, dictionary.common.error));
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    return <Confirmation order={placed} locale={locale} dictionary={dictionary} amount={amount} />;
  }

  if (cart && items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg">{dictionary.cart.empty}</p>
        <Link
          href={`/${locale}`}
          className="border border-line px-5 py-2 text-sm uppercase tracking-wider transition-colors hover:border-brass hover:text-brass"
        >
          {dictionary.cart.continue}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-start">
      <form
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <section className="flex flex-col gap-4">
          <h2 className="text-section">1. {dictionary.contact.name}</h2>

          <Field label={dictionary.contact.name} error={fieldErrors['customer.fullName']} required>
            <input
              required
              autoComplete="name"
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              className="input-line"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={dictionary.contact.phone} error={fieldErrors['customer.phone']} required>
              <input
                required
                type="tel"
                inputMode="tel"
                dir="ltr"
                autoComplete="tel"
                placeholder="0550 11 22 33"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                className="input-line"
              />
            </Field>
            <Field
              label={`${dictionary.contact.phone} 2`}
              hint="Améliore nettement les chances de livraison"
              error={fieldErrors['customer.altPhone']}
            >
              <input
                type="tel"
                inputMode="tel"
                dir="ltr"
                value={form.altPhone}
                onChange={(event) => setForm({ ...form, altPhone: event.target.value })}
                className="input-line"
              />
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-section">2. {dictionary.delivery.title}</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <DeliveryChoice
              active={form.deliveryType === DeliveryType.HOME}
              icon={<Home className="h-5 w-5" />}
              label={dictionary.delivery.home}
              onSelect={() => setForm({ ...form, deliveryType: DeliveryType.HOME })}
            />
            <DeliveryChoice
              active={form.deliveryType === DeliveryType.STOP_DESK}
              icon={<Building2 className="h-5 w-5" />}
              label={dictionary.delivery.stopDesk}
              disabled={form.wilayaCode > 0 && pickupPoints.length === 0}
              onSelect={() => setForm({ ...form, deliveryType: DeliveryType.STOP_DESK })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={dictionary.delivery.chooseWilaya}
              error={fieldErrors['shipping.wilayaCode']}
              required
            >
              <select
                required
                value={form.wilayaCode || ''}
                onChange={(event) =>
                  setForm({ ...form, wilayaCode: Number(event.target.value), communeId: '', pickupPointId: '' })
                }
                className="input-line"
              >
                <option value="">—</option>
                {wilayas.map((wilaya) => (
                  <option key={wilaya.code} value={wilaya.code}>
                    {String(wilaya.code).padStart(2, '0')} — {wilaya.name[locale] ?? wilaya.name.fr}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Commune" error={fieldErrors['shipping.communeId']} required>
              <select
                required
                disabled={communes.length === 0}
                value={form.communeId}
                onChange={(event) => setForm({ ...form, communeId: event.target.value })}
                className="input-line"
              >
                <option value="">—</option>
                {communes.map((commune) => (
                  <option key={commune.id} value={commune.id}>
                    {commune.name[locale] ?? commune.name.fr}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {form.deliveryType === DeliveryType.HOME ? (
            <Field label="Adresse" error={fieldErrors['shipping.address']} required>
              <textarea
                required
                rows={2}
                autoComplete="street-address"
                placeholder="Cité, bâtiment, étage, repère…"
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
                className="input-line"
              />
            </Field>
          ) : (
            <Field
              label={dictionary.delivery.stopDesk}
              error={fieldErrors['shipping.pickupPointId']}
              required
            >
              <select
                required
                disabled={pickupPoints.length === 0}
                value={form.pickupPointId}
                onChange={(event) => setForm({ ...form, pickupPointId: event.target.value })}
                className="input-line"
              >
                <option value="">—</option>
                {pickupPoints.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.name}
                    {point.address ? ` — ${point.address}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={dictionary.contact.body} hint="Facultatif">
            <textarea
              rows={2}
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              className="input-line"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.acceptsMarketing}
              onChange={(event) => setForm({ ...form, acceptsMarketing: event.target.checked })}
              className="h-4 w-4 accent-brass"
            />
            {dictionary.footer.newsletter}
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-section">3. {dictionary.delivery.cod}</h2>
          <p className="flex items-center gap-2 rounded-sm border border-brass/30 bg-brass/5 px-4 py-3 text-sm">
            <Truck className="h-4 w-4 shrink-0 text-brass" />
            {dictionary.delivery.cod}
          </p>
        </section>

        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" editorial loading={busy} disabled={!ready}>
          {dictionary.cart.checkout}
        </Button>

        <p className="flex items-center gap-2 text-xs text-muted">
          <ShieldCheck className="h-3.5 w-3.5" />
          Vous ne payez qu’à la réception, en main propre.
        </p>
      </form>

      <aside className="lg:sticky lg:top-24">
        <div className="flex flex-col gap-4 rounded-sm border border-line p-5">
          <h2 className="text-sm uppercase tracking-wider text-muted">{dictionary.cart.title}</h2>

          {cart === null ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {dictionary.common.loading}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <li key={item.id} className="flex gap-3">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        width={48}
                        height={60}
                        className="h-[60px] w-12 rounded-xs object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{t(item.productName, locale)}</p>
                      <p className="text-xs text-muted">
                        {item.variantName ? `${item.variantName} · ` : ''}× {item.quantity}
                      </p>
                    </div>
                    <span className="text-sm tabular-nums">{amount(item.lineTotalMinor)}</span>
                  </li>
                ))}
              </ul>

              <dl className="flex flex-col gap-1.5 border-t border-line pt-4 text-sm">
                <Row label={dictionary.cart.subtotal} value={amount(cart.subtotalMinor)} />
                {BigInt(cart.discountMinor) > 0n ? (
                  <Row
                    label={dictionary.cart.discount}
                    value={`-${amount(cart.discountMinor)}`}
                    tone="brass"
                  />
                ) : null}
                <Row
                  label={dictionary.cart.shipping}
                  value={
                    cart.shippingQuoted
                      ? cart.freeShipping || cart.shippingMinor === '0'
                        ? dictionary.delivery.free
                        : amount(cart.shippingMinor)
                      : dictionary.cart.shippingLater
                  }
                />
                <div className="mt-1 border-t border-line pt-2">
                  <Row label={dictionary.cart.total} value={amount(cart.totalMinor)} strong />
                </div>
              </dl>

              {cart.freeShippingRemainingMinor &&
              BigInt(cart.freeShippingRemainingMinor) > 0n ? (
                <p className="text-xs text-muted">
                  {fill(dictionary.cart.freeShippingProgress, {
                    amount: amount(cart.freeShippingRemainingMinor),
                  })}
                </p>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Confirmation({
  order,
  locale,
  dictionary,
  amount,
}: {
  order: PlacedOrder;
  locale: Locale;
  dictionary: Dictionary;
  amount: (value: string) => string;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
        <ShieldCheck className="h-7 w-7" />
      </span>

      <div>
        <h1 className="text-section">{dictionary.orderStatus.PENDING}</h1>
        <p className="mt-2 font-mono text-2xl text-brass">{order.number}</p>
      </div>

      <p className="text-sm text-muted">
        Nous vous appelons pour confirmer, puis nous expédions. Vous payez{' '}
        <span className="font-medium text-ink">{amount(order.totalMinor)}</span> à la réception.
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href={`/${locale}/track?number=${order.number}`}
          className="border border-line px-5 py-2 text-sm uppercase tracking-wider transition-colors hover:border-brass hover:text-brass"
        >
          {dictionary.track.title}
        </Link>
        <Link
          href={`/${locale}`}
          className="bg-brass px-5 py-2 text-sm font-semibold uppercase tracking-wider text-base transition-colors hover:bg-brass-soft"
        >
          {dictionary.cart.continue}
        </Link>
      </div>
    </div>
  );
}

function DeliveryChoice({
  active,
  icon,
  label,
  disabled,
  onSelect,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 rounded-sm border p-4 text-start transition-colors',
        active ? 'border-brass bg-brass/5 text-brass' : 'border-line text-muted hover:border-muted',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-muted">
        {label}
        {required ? <span className="text-brass"> *</span> : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'brass';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={strong ? 'font-medium' : 'text-muted'}>{label}</dt>
      <dd
        className={cn(
          'tabular-nums',
          strong && 'text-lg font-semibold',
          tone === 'brass' && 'text-brass',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
