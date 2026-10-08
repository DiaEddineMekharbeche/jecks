'use client';

import { DeliveryType, format, isValidDzPhone, money, type Locale } from '@jecks/shared';
import { Button } from '@jecks/ui';
import { AlertCircle, Building2, Home, Minus, Plus, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Confirmation,
  DeliveryChoice,
  Field,
  type Commune,
  type PickupPoint,
  type PlacedOrder,
  type Wilaya,
} from './checkout-form';
import { track } from '@/lib/analytics';
import { ApiError, clientApi, errorMessage } from '@/lib/client-api';
import type { Dictionary } from '@/lib/dictionary';
import { readAttribution } from '@/lib/offer';

/**
 * The order form of an advert's landing page.
 *
 * Name, phone, where it goes and how many — nothing else is asked, and nothing is
 * between the shopper and the order: no cart, no account, no second page. It posts to
 * `POST /orders/quick`, which prices the line on the server.
 *
 * The form is folded behind the buy button so a page of several products stays short;
 * tapping the button opens it in place.
 */

// Wilayas are the same for every product on the page, so they are fetched once.
let wilayasRequest: Promise<Wilaya[]> | null = null;
function loadWilayas(): Promise<Wilaya[]> {
  wilayasRequest ??= clientApi<Wilaya[]>('/shipping/wilayas').catch(() => {
    wilayasRequest = null;
    return [];
  });
  return wilayasRequest;
}

export function OfferOrderForm({
  variantId,
  inStock,
  available,
  unitPriceMinor,
  startOpen = false,
  locale,
  dictionary,
}: {
  variantId: string | null;
  inStock: boolean;
  available: number;
  unitPriceMinor: string;
  /** Show the fields at once instead of behind the buy button. */
  startOpen?: boolean;
  locale: Locale;
  dictionary: Dictionary;
}) {
  const [open, setOpen] = useState(startOpen);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    wilayaCode: 0,
    communeId: '',
    deliveryType: DeliveryType.HOME as DeliveryType,
    address: '',
    pickupPointId: '',
    note: '',
    quantity: 1,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);

  // One key per mounted form: a double tap on a slow connection sends the same key
  // twice and the server hands back the first order.
  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    [],
  );

  useEffect(() => {
    if (open) void loadWilayas().then(setWilayas);
  }, [open]);

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

  const maxQuantity = Math.max(1, Math.min(10, available));
  const quantity = Math.min(form.quantity, maxQuantity);
  const amount = (value: string | bigint) =>
    format(money(BigInt(value)), { locale: `${locale}-DZ` });
  const subtotal = BigInt(unitPriceMinor) * BigInt(quantity);

  const ready =
    variantId !== null &&
    form.fullName.trim().length >= 3 &&
    isValidDzPhone(form.phone) &&
    form.wilayaCode > 0 &&
    form.communeId !== '' &&
    (form.deliveryType === DeliveryType.HOME
      ? form.address.trim().length >= 8
      : form.pickupPointId !== '');

  async function submit() {
    if (!variantId) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const attribution = readAttribution(window.location.search);
      const order = await clientApi<PlacedOrder>('/orders/quick', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          variantId,
          quantity,
          customer: { fullName: form.fullName.trim(), phone: form.phone.trim() },
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
          source: attribution.source,
          utm: attribution.utm,
        },
      });

      track({ name: 'purchase', orderId: order.orderId, valueMinor: Number(order.totalMinor) });
      setPlaced(order);
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

  if (!inStock) {
    return <p className="text-danger">{dictionary.product.outOfStock}</p>;
  }

  if (!open) {
    return (
      <Button
        size="lg"
        editorial
        disabled={!variantId}
        onClick={() => {
          setOpen(true);
          track({ name: 'checkout_start' });
        }}
      >
        {dictionary.product.buyNow}
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-sm border border-brass/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label={dictionary.contact.name} error={fieldErrors['customer.fullName']} required>
        <input
          required
          autoComplete="name"
          value={form.fullName}
          onChange={(event) => setForm({ ...form, fullName: event.target.value })}
          className="input-line"
        />
      </Field>

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
              setForm({
                ...form,
                wilayaCode: Number(event.target.value),
                communeId: '',
                pickupPointId: '',
              })
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

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-muted">
          {dictionary.cart.quantity}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="−"
            disabled={quantity <= 1}
            onClick={() => setForm({ ...form, quantity: quantity - 1 })}
            className="flex h-9 w-9 items-center justify-center rounded-sm border border-line disabled:opacity-40"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-6 text-center tabular-nums">{quantity}</span>
          <button
            type="button"
            aria-label="+"
            disabled={quantity >= maxQuantity}
            onClick={() => setForm({ ...form, quantity: quantity + 1 })}
            className="flex h-9 w-9 items-center justify-center rounded-sm border border-line disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <dl className="flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">{dictionary.cart.subtotal}</dt>
          <dd className="tabular-nums">{amount(subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{dictionary.cart.shipping}</dt>
          <dd>{dictionary.cart.shippingLater}</dd>
        </div>
      </dl>

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
  );
}
