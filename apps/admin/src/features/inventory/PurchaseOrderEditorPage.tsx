import { PurchaseOrderStatus, t, type PurchaseOrderDto, type Translated } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  MoneyInput,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ban, Check, ImageOff, PackageCheck, Send, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { formatDa, message } from '@/lib/errors';
import * as inventory from './api';
import { PO_STATUS_LABELS, PO_STATUS_TONES } from './PurchaseOrdersPage';
import { useInventoryInvalidate, useLocations, usePurchaseOrder, useSupplierOptions } from './queries';

/**
 * Purchase order editor and receiving flow — PRD F-AD-52.
 *
 * One screen for the whole life of an order. Which controls it shows is driven by the
 * status, because "what can I do to this order right now" is the only question an
 * operator has when they open it, and a form that stays editable after the goods
 * shipped is a form that invites a wrong answer.
 */

interface DraftLine {
  key: string;
  variantId: string;
  sku: string;
  productName: Translated;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  unitCostMinor: bigint;
}

interface VariantHit {
  id: string;
  sku: string;
  productName: Translated;
  variantName: string | null;
  imageUrl: string | null;
  costPriceMinor: string;
  available: number;
}

export function PurchaseOrderEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invalidate = useInventoryInvalidate();
  const isNew = id === 'new';

  const order = usePurchaseOrder(isNew ? undefined : id);
  const suppliers = useSupplierOptions();
  const locations = useLocations();

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [expectedAt, setExpectedAt] = useState('');
  const [shipping, setShipping] = useState<bigint>(0n);
  const [other, setOther] = useState<bigint>(0n);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  const loaded = order.data;
  const editable = isNew || loaded?.status === PurchaseOrderStatus.DRAFT;

  // Seed the form from the loaded order exactly once per order id.
  if (!isNew && loaded && seeded !== loaded.id) {
    setSeeded(loaded.id);
    setSupplierId(loaded.supplierId);
    setLocationId(loaded.locationId);
    setExpectedAt(loaded.expectedAt ? loaded.expectedAt.slice(0, 10) : '');
    setShipping(BigInt(loaded.shippingCost));
    setOther(BigInt(loaded.otherCost));
    setNote(loaded.note ?? '');
    setLines(
      loaded.items.map((item) => ({
        key: item.id,
        variantId: item.variantId,
        sku: item.sku,
        productName: item.productName,
        variantName: item.variantName,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
        unitCostMinor: BigInt(item.unitCost),
      })),
    );
  }

  // A brand-new order lands on the default location, which is what a buyer wants nine
  // times out of ten.
  if (isNew && locationId === null && locations.data && locations.data.length > 0) {
    setLocationId((locations.data.find((location) => location.isDefault) ?? locations.data[0])!.id);
  }

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.unitCostMinor * BigInt(line.quantity), 0n),
    [lines],
  );
  const total = subtotal + shipping + other;

  function addLine(hit: VariantHit) {
    setLines((current) => {
      const existing = current.find((line) => line.variantId === hit.id);
      if (existing) {
        return current.map((line) =>
          line.variantId === hit.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          key: `new-${hit.id}`,
          variantId: hit.id,
          sku: hit.sku,
          productName: hit.productName,
          variantName: hit.variantName,
          imageUrl: hit.imageUrl,
          quantity: 1,
          unitCostMinor: BigInt(hit.costPriceMinor),
        },
      ];
    });
  }

  async function save(thenPlace = false) {
    if (!supplierId || !locationId || lines.length === 0) return;
    setBusy(true);
    try {
      const payload = {
        supplierId,
        locationId,
        expectedAt: expectedAt || undefined,
        shippingCost: shipping.toString(),
        otherCost: other.toString(),
        note: note || undefined,
        items: lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unitCost: line.unitCostMinor.toString(),
        })),
      };

      const saved = isNew
        ? await inventory.createPurchaseOrder(payload)
        : await inventory.updatePurchaseOrder(id!, payload);

      if (thenPlace) await inventory.placePurchaseOrder(saved.id);

      notify.success(thenPlace ? `${saved.number} envoyée au fournisseur` : 'Commande enregistrée');
      invalidate();
      navigate(`/inventory/purchase-orders/${saved.id}`, { replace: true });
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder() {
    if (!loaded) return;
    setBusy(true);
    try {
      await inventory.cancelPurchaseOrder(loaded.id);
      notify.success(`${loaded.number} annulée`);
      invalidate();
      void order.refetch();
    } catch (error) {
      notify.error(message(error, "L'annulation a échoué"));
    } finally {
      setBusy(false);
    }
  }

  if (!isNew && order.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isNew && order.error) {
    return (
      <EmptyState
        title="Commande introuvable"
        description={(order.error as Error).message}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/inventory/purchase-orders')}>
            Retour à la liste
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/inventory/purchase-orders')}
              aria-label="Retour"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {isNew ? 'Nouvelle commande fournisseur' : loaded?.number}
            {loaded ? (
              <Badge tone={PO_STATUS_TONES[loaded.status] ?? 'neutral'}>
                {PO_STATUS_LABELS[loaded.status] ?? loaded.status}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            {loaded && !editable && loaded.status !== PurchaseOrderStatus.RECEIVED &&
            loaded.status !== PurchaseOrderStatus.CANCELLED ? (
              <Button variant="outline" size="sm" loading={busy} onClick={() => void cancelOrder()}>
                <Ban className="h-4 w-4" />
                Annuler la commande
              </Button>
            ) : null}

            {loaded &&
            (loaded.status === PurchaseOrderStatus.ORDERED ||
              loaded.status === PurchaseOrderStatus.PARTIALLY_RECEIVED) ? (
              <Button size="sm" onClick={() => setReceiving(true)}>
                <PackageCheck className="h-4 w-4" />
                Réceptionner
              </Button>
            ) : null}

            {editable ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  loading={busy}
                  disabled={!supplierId || !locationId || lines.length === 0}
                  onClick={() => void save(false)}
                >
                  Enregistrer le brouillon
                </Button>
                <Button
                  size="sm"
                  loading={busy}
                  disabled={!supplierId || !locationId || lines.length === 0}
                  onClick={() => void save(true)}
                >
                  <Send className="h-4 w-4" />
                  Envoyer au fournisseur
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {loaded?.status === PurchaseOrderStatus.RECEIVED ? (
        <Alert tone="success" title="Commande entièrement reçue">
          Le stock et le coût moyen pondéré des variantes ont été mis à jour.
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Lignes</CardTitle>
              {editable ? <VariantPicker locationId={locationId} onPick={addLine} /> : null}
            </CardHeader>
            <CardBody className="p-0">
              {lines.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="Aucune ligne"
                    description="Ajoutez les articles à commander à votre fournisseur."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                        <th className="px-4 py-2 text-start font-medium">Article</th>
                        <th className="px-4 py-2 text-end font-medium">Quantité</th>
                        {!editable ? (
                          <th className="px-4 py-2 text-end font-medium">Reçu</th>
                        ) : null}
                        <th className="px-4 py-2 text-end font-medium">Coût unitaire</th>
                        <th className="px-4 py-2 text-end font-medium">Total</th>
                        {editable ? <th className="w-10 px-4 py-2" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => {
                        const received = loaded?.items.find((item) => item.id === line.key)
                          ?.receivedQuantity;
                        return (
                          <tr key={line.key} className="border-b border-line/60 last:border-0">
                            <td className="px-4 py-3">
                              <div className="flex min-w-0 items-center gap-3">
                                {line.imageUrl ? (
                                  <img
                                    src={line.imageUrl}
                                    alt=""
                                    className="h-9 w-9 shrink-0 rounded-sm object-cover"
                                  />
                                ) : (
                                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-line text-muted">
                                    <ImageOff className="h-4 w-4" />
                                  </span>
                                )}
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-ink">
                                    {t(line.productName, 'fr')}
                                  </p>
                                  <p className="truncate text-xs text-muted">
                                    {line.sku}
                                    {line.variantName ? ` · ${line.variantName}` : ''}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-end">
                              {editable ? (
                                <Input
                                  type="number"
                                  min={1}
                                  className="ms-auto w-20 text-end"
                                  value={line.quantity}
                                  onChange={(event) =>
                                    setLines((current) =>
                                      current.map((item, position) =>
                                        position === index
                                          ? {
                                              ...item,
                                              quantity: Math.max(Number(event.target.value) || 0, 0),
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              ) : (
                                <span className="tabular-nums">{line.quantity}</span>
                              )}
                            </td>
                            {!editable ? (
                              <td className="px-4 py-3 text-end tabular-nums">
                                {received ?? 0}
                                {received !== undefined && received >= line.quantity ? (
                                  <Check className="ms-1 inline h-3.5 w-3.5 text-success" />
                                ) : null}
                              </td>
                            ) : null}
                            <td className="px-4 py-3 text-end">
                              {editable ? (
                                <MoneyInput
                                  className="ms-auto w-32"
                                  value={line.unitCostMinor}
                                  onValueChange={(value) =>
                                    setLines((current) =>
                                      current.map((item, position) =>
                                        position === index
                                          ? { ...item, unitCostMinor: value ?? 0n }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              ) : (
                                <span className="tabular-nums">
                                  {formatDa(line.unitCostMinor.toString())}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-end font-medium tabular-nums">
                              {formatDa((line.unitCostMinor * BigInt(line.quantity)).toString())}
                            </td>
                            {editable ? (
                              <td className="px-4 py-3 text-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Retirer la ligne"
                                  onClick={() =>
                                    setLines((current) =>
                                      current.filter((_, position) => position !== index),
                                    )
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Détails</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <Field label="Fournisseur" required>
                <Combobox
                  options={(suppliers.data ?? []).map((supplier) => ({
                    value: supplier.id,
                    label: supplier.name,
                  }))}
                  value={supplierId}
                  onValueChange={setSupplierId}
                  disabled={!editable}
                  placeholder="Choisir un fournisseur"
                />
              </Field>

              <Field label="Réception à" required>
                <Select
                  value={locationId ?? ''}
                  onValueChange={setLocationId}
                  disabled={!editable}
                  options={(locations.data ?? []).map((location) => ({
                    value: location.id,
                    label: location.name,
                  }))}
                  placeholder="Emplacement"
                />
              </Field>

              <Field label="Date attendue">
                <Input
                  type="date"
                  value={expectedAt}
                  disabled={!editable}
                  onChange={(event) => setExpectedAt(event.target.value)}
                />
              </Field>

              <Field label="Note">
                <Textarea
                  rows={3}
                  value={note}
                  disabled={!editable}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Conditions, référence de facture…"
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Totaux</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <Row label="Sous-total" value={formatDa(subtotal.toString())} />

              <Field label="Transport" hint="Réparti au prorata sur les lignes à la réception">
                <MoneyInput
                  value={shipping}
                  disabled={!editable}
                  onValueChange={(value) => setShipping(value ?? 0n)}
                />
              </Field>
              <Field label="Autres frais">
                <MoneyInput
                  value={other}
                  disabled={!editable}
                  onValueChange={(value) => setOther(value ?? 0n)}
                />
              </Field>

              <div className="border-t border-line pt-3">
                <Row label="Total" value={formatDa(total.toString())} strong />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {loaded ? (
        <ReceiveDialog
          order={loaded}
          open={receiving}
          onClose={() => setReceiving(false)}
          onDone={() => {
            setReceiving(false);
            setSeeded(null);
            invalidate();
            void order.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={strong ? 'font-medium text-ink' : 'text-muted'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-base font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

function VariantPicker({
  locationId,
  onPick,
}: {
  locationId: string | null;
  onPick: (hit: VariantHit) => void;
}) {
  const [term, setTerm] = useState('');

  const search = useQuery({
    queryKey: ['admin', 'variants', 'search', term, locationId],
    queryFn: () =>
      api<VariantHit[]>('/admin/variants/search', {
        query: { q: term || undefined, limit: 20, locationId: locationId ?? undefined },
      }),
    staleTime: 30_000,
  });

  return (
    <div className="w-64">
      <Combobox
        options={(search.data ?? []).map((hit) => ({
          value: hit.id,
          label: `${t(hit.productName, 'fr')}${hit.variantName ? ` · ${hit.variantName}` : ''}`,
          description: `${hit.sku} · ${hit.available} dispo`,
        }))}
        value={null}
        onValueChange={(value) => {
          const hit = (search.data ?? []).find((item) => item.id === value);
          if (hit) onPick(hit);
        }}
        onSearchChange={setTerm}
        loading={search.isFetching}
        placeholder="Ajouter un article"
        searchPlaceholder="SKU ou nom du produit"
        emptyMessage="Aucune variante"
      />
    </div>
  );
}

function ReceiveDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: PurchaseOrderDto;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const outstanding = order.items.filter((item) => item.receivedQuantity < item.quantity);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [costs, setCosts] = useState<Record<string, bigint | null>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Prefill with everything still outstanding: "the whole delivery arrived" is the
  // common case, and correcting one line beats typing every line.
  if (open && !seeded) {
    setSeeded(true);
    setQuantities(
      Object.fromEntries(
        outstanding.map((item) => [item.id, item.quantity - item.receivedQuantity]),
      ),
    );
    setCosts({});
  }
  if (!open && seeded) setSeeded(false);

  const totalReceiving = Object.values(quantities).reduce((sum, value) => sum + (value || 0), 0);

  async function submit() {
    setBusy(true);
    try {
      await inventory.receivePurchaseOrder(order.id, {
        lines: outstanding.map((item) => ({
          itemId: item.id,
          quantity: quantities[item.id] ?? 0,
          ...(costs[item.id] ? { unitCost: costs[item.id]!.toString() as never } : {}),
        })),
        note: note || undefined,
      });
      notify.success(`${totalReceiving} unité(s) réceptionnée(s)`);
      onDone();
    } catch (error) {
      notify.error(message(error, 'La réception a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Réceptionner {order.number}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Saisissez ce qui est réellement arrivé. Le stock, le grand livre et le coût moyen
            pondéré de chaque variante seront mis à jour.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                  <th className="px-2 py-2 text-start font-medium">Article</th>
                  <th className="px-2 py-2 text-end font-medium">Restant</th>
                  <th className="px-2 py-2 text-end font-medium">Reçu</th>
                  <th className="px-2 py-2 text-end font-medium">Coût réel</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((item) => {
                  const remaining = item.quantity - item.receivedQuantity;
                  return (
                    <tr key={item.id} className="border-b border-line/60 last:border-0">
                      <td className="px-2 py-2">
                        <p className="truncate font-medium">{t(item.productName, 'fr')}</p>
                        <p className="truncate text-xs text-muted">{item.sku}</p>
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums text-muted">{remaining}</td>
                      <td className="px-2 py-2 text-end">
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          className="ms-auto w-20 text-end"
                          value={quantities[item.id] ?? 0}
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,
                              [item.id]: Math.min(
                                Math.max(Number(event.target.value) || 0, 0),
                                remaining,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-end">
                        <MoneyInput
                          className="ms-auto w-28"
                          value={costs[item.id] ?? item.unitCost}
                          onValueChange={(value) =>
                            setCosts((current) => ({ ...current, [item.id]: value }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Field label="Note de réception">
            <Textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Bon de livraison n° …"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={totalReceiving === 0} loading={busy}>
            <PackageCheck className="h-4 w-4" />
            Réceptionner {totalReceiving} unité(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
