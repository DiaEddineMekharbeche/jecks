import {
  CallOutcome,
  OrderStatus,
  t,
  type OrderDetail,
  type RiskFlag,
} from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  MoneyInput,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronDown,
  ImageOff,
  MessageSquare,
  Phone,
  Printer,
  Save,
  ShieldAlert,
  Tag,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dateTimeFormatter, formatDa, message } from '@/lib/errors';
import * as orders from './api';
import {
  CALL_OUTCOME_LABELS,
  DELIVERY_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_STATUS_LABELS,
  RISK_FLAG_LABELS,
  SOURCE_LABELS,
  TRANSITION_LABELS,
  riskTone,
} from './labels';

/**
 * The order detail — PRD F-AD-31 to F-AD-36.
 *
 * Built around what an agent actually does with an order: read the risk, call the
 * customer, fix the address, then move it forward. The transition buttons come from the
 * server's `allowedTransitions`, so the screen can never offer a move the state machine
 * would refuse.
 */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => orders.getOrder(id!),
    enabled: Boolean(id),
  });

  const [transitioning, setTransitioning] = useState<OrderStatus | null>(null);
  // Set while a panel is saving, so the status menu cannot be used mid-write.
  const [busy] = useState(false);

  const order = query.data;

  /** Streams the PDF straight to the browser's download, which opens the print dialogue. */
  async function printDocument(kind: 'invoice' | 'packing-slip') {
    if (!id) return;
    try {
      await orders.downloadOrderDocument(id, kind);
    } catch (error) {
      notify.error(message(error, "Le document n'a pas pu être généré"));
    }
  }

  function refresh(next: OrderDetail) {
    queryClient.setQueryData(['admin', 'order', id], next);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
  }

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (query.error || !order) {
    return (
      <EmptyState
        title="Commande introuvable"
        description={(query.error as Error | null)?.message ?? 'Cette commande n’existe plus.'}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/orders')}>
            Retour aux commandes
          </Button>
        }
      />
    );
  }

  const risk = riskTone(order.riskScore);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" aria-label="Retour" onClick={() => navigate('/orders')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {order.number}
            <Badge tone={ORDER_STATUS_TONES[order.status] ?? 'neutral'}>
              {ORDER_STATUS_LABELS[order.status] ?? order.status}
            </Badge>
            <Badge tone={order.paymentStatus === 'PAID' ? 'success' : 'neutral'}>
              {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
            </Badge>
          </span>
        }
        description={`${SOURCE_LABELS[order.source] ?? order.source} · ${dateTimeFormatter.format(new Date(order.createdAt))}`}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Printer className="h-4 w-4" />
                  Imprimer
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void printDocument('invoice')}>
                  Facture
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void printDocument('packing-slip')}>
                  Bon de préparation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {order.allowedTransitions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" loading={busy}>
                  Changer le statut
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Étapes possibles</DropdownMenuLabel>
                {order.allowedTransitions.map((status) => (
                  <DropdownMenuItem key={status} onSelect={() => setTransitioning(status)}>
                    {TRANSITION_LABELS[status] ?? status}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            ) : null}
          </>
        }
      />

      {order.riskScore >= 40 ? (
        <Alert
          tone={risk.tone === 'danger' ? 'danger' : 'warning'}
          title={`${risk.label} — ${order.riskScore}/100`}
        >
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {order.riskFlags.map((flag) => (
              <li key={flag} className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                {RISK_FLAG_LABELS[flag as RiskFlag] ?? flag}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Articles</CardTitle>
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-2 text-start font-medium">Article</th>
                    <th className="px-4 py-2 text-end font-medium">Qté</th>
                    <th className="px-4 py-2 text-end font-medium">Prix</th>
                    <th className="px-4 py-2 text-end font-medium">Coût</th>
                    <th className="px-4 py-2 text-end font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-sm object-cover"
                            />
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-line text-muted">
                              <ImageOff className="h-4 w-4" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {t(item.productName, 'fr')}
                            </p>
                            <p className="truncate text-xs text-muted">
                              {item.sku}
                              {item.variantName ? ` · ${item.variantName}` : ''}
                              {item.available < item.quantity ? (
                                <span className="ms-2 text-warning">
                                  stock : {item.available}
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-3 text-end tabular-nums">
                        {formatDa(item.unitPriceMinor)}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-muted">
                        {formatDa(item.unitCostMinor)}
                      </td>
                      <td className="px-4 py-3 text-end font-medium tabular-nums">
                        {formatDa(item.lineTotalMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">Historique</TabsTrigger>
              <TabsTrigger value="calls">Appels ({order.callLogs.length})</TabsTrigger>
              <TabsTrigger value="notes">Notes ({order.notes.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline">
              <Card>
                <CardBody>
                  <Timeline
                    entries={order.events.map((event) => ({
                      id: event.id,
                      title: event.toStatus
                        ? (ORDER_STATUS_LABELS[event.toStatus] ?? event.toStatus)
                        : event.kind,
                      description: event.reason ?? undefined,
                      timestamp: dateTimeFormatter.format(new Date(event.createdAt)),
                      actor: event.actorName ?? 'Système',
                      tone: event.toStatus ? ORDER_STATUS_TONES[event.toStatus] : undefined,
                    }))}
                  />
                </CardBody>
              </Card>
            </TabsContent>

            <TabsContent value="calls">
              <CallPanel order={order} busy={busy} onDone={refresh} />
            </TabsContent>

            <TabsContent value="notes">
              <NotePanel order={order} busy={busy} onDone={refresh} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex flex-col gap-5">
          <CustomerCard order={order} onSaved={refresh} />

          <Card>
            <CardHeader>
              <CardTitle>Totaux</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-2 text-sm">
              <Row label="Sous-total" value={formatDa(order.itemsSubtotalMinor)} />
              {BigInt(order.discountTotalMinor) > 0n ? (
                <Row label="Remise" value={`-${formatDa(order.discountTotalMinor)}`} />
              ) : null}
              {BigInt(order.loyaltyDiscountMinor) > 0n ? (
                <Row label="Fidélité" value={`-${formatDa(order.loyaltyDiscountMinor)}`} />
              ) : null}
              <Row label="Livraison" value={formatDa(order.shippingTotalMinor)} />
              <div className="border-t border-line pt-2">
                <Row label="Total" value={formatDa(order.totalMinor)} strong />
              </div>
              <div className="mt-2 border-t border-line pt-2 text-xs text-muted">
                <Row label="Coût des marchandises" value={formatDa(order.cogsTotalMinor)} />
                <Row label="Coût transporteur" value={formatDa(order.shippingCostMinor)} />
                <Row
                  label="Marge"
                  value={formatDa(order.marginMinor)}
                  tone={BigInt(order.marginMinor) > 0n ? 'success' : 'danger'}
                />
              </div>
            </CardBody>
          </Card>

          <TagsCard order={order} onSaved={refresh} />
        </div>
      </div>

      <TransitionDialog
        order={order}
        target={transitioning}
        onClose={() => setTransitioning(null)}
        onDone={(next) => {
          setTransitioning(null);
          refresh(next);
        }}
      />
    </div>
  );
}

// --- customer ---------------------------------------------------------------

function CustomerCard({
  order,
  onSaved,
}: {
  order: OrderDetail;
  onSaved: (next: OrderDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerAltPhone: order.customerAltPhone ?? '',
    address: order.address ?? '',
    internalNote: order.internalNote ?? '',
  });

  const digits = order.customerPhone.replace(/\D/g, '');

  async function save() {
    setBusy(true);
    try {
      onSaved(
        await orders.updateOrder(order.id, {
          ...form,
          customerAltPhone: form.customerAltPhone || null,
          address: form.address || null,
          internalNote: form.internalNote || null,
        }),
      );
      notify.success('Coordonnées mises à jour');
      setEditing(false);
    } catch (error) {
      notify.error(message(error, 'La mise à jour a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Client</CardTitle>
        {order.editable ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing((open) => !open)}>
            {editing ? 'Annuler' : 'Modifier'}
          </Button>
        ) : null}
      </CardHeader>

      <CardBody className="flex flex-col gap-3">
        {editing ? (
          <>
            <Field label="Nom">
              <Input
                value={form.customerName}
                onChange={(event) => setForm({ ...form, customerName: event.target.value })}
              />
            </Field>
            <Field label="Téléphone">
              <Input
                dir="ltr"
                value={form.customerPhone}
                onChange={(event) => setForm({ ...form, customerPhone: event.target.value })}
              />
            </Field>
            <Field label="Téléphone 2">
              <Input
                dir="ltr"
                value={form.customerAltPhone}
                onChange={(event) => setForm({ ...form, customerAltPhone: event.target.value })}
              />
            </Field>
            <Field label="Adresse">
              <Textarea
                rows={2}
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </Field>
            <Field label="Note interne" hint="Jamais visible par le client">
              <Textarea
                rows={2}
                value={form.internalNote}
                onChange={(event) => setForm({ ...form, internalNote: event.target.value })}
              />
            </Field>
            <Button size="sm" loading={busy} onClick={() => void save()}>
              <Save className="h-4 w-4" />
              Enregistrer
            </Button>
          </>
        ) : (
          <>
            <div>
              <p className="font-medium text-ink">{order.customerName}</p>
              <p className="text-xs text-muted">
                {order.customerOrdersCount} commande(s) · {order.customerDeliveredCount} livrée(s)
                {order.customerFailedCount > 0 ? (
                  <span className="text-danger"> · {order.customerFailedCount} échec(s)</span>
                ) : null}
              </p>
            </div>

            {/* tel: and wa.me rather than a copyable string: an agent calls from the
                screen, and a number they have to retype is a number they mistype. */}
            <div className="flex flex-wrap gap-2">
              <a
                href={`tel:${order.customerPhone}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-xs transition-colors hover:border-brass hover:text-brass"
              >
                <Phone className="h-3.5 w-3.5" />
                {order.customerPhone}
              </a>
              <a
                href={`https://wa.me/${digits}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-xs transition-colors hover:border-success hover:text-success"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                WhatsApp
              </a>
              {order.customerAltPhone ? (
                <a
                  href={`tel:${order.customerAltPhone}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-xs text-muted transition-colors hover:border-brass hover:text-brass"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {order.customerAltPhone}
                </a>
              ) : null}
            </div>

            <dl className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
              <Row
                label="Livraison"
                value={DELIVERY_TYPE_LABELS[order.deliveryType] ?? order.deliveryType}
              />
              <Row label="Wilaya" value={`${order.wilayaCode} — ${order.wilayaName}`} />
              {order.communeName ? <Row label="Commune" value={order.communeName} /> : null}
            </dl>

            {order.address ? (
              <p className="rounded-sm bg-elevated p-3 text-sm">{order.address}</p>
            ) : order.pickupPointName ? (
              <p className="rounded-sm bg-elevated p-3 text-sm">{order.pickupPointName}</p>
            ) : null}

            {order.note ? (
              <p className="text-xs text-muted">
                <span className="font-medium">Note du client :</span> {order.note}
              </p>
            ) : null}
            {order.internalNote ? (
              <p className="text-xs text-warning">
                <span className="font-medium">Interne :</span> {order.internalNote}
              </p>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

// --- tags -------------------------------------------------------------------

function TagsCard({ order, onSaved }: { order: OrderDetail; onSaved: (next: OrderDetail) => void }) {
  const [value, setValue] = useState('');

  async function apply(tags: string[]) {
    try {
      onSaved(await orders.setOrderTags(order.id, { tags }));
    } catch (error) {
      notify.error(message(error, 'La mise à jour a échoué'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Étiquettes</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {order.tags.length === 0 ? (
            <span className="text-xs text-muted">Aucune</span>
          ) : (
            order.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="inline-flex items-center gap-1 rounded-xs bg-elevated px-2 py-0.5 text-xs transition-colors hover:text-danger"
                onClick={() => void apply(order.tags.filter((entry) => entry !== tag))}
              >
                <Tag className="h-3 w-3" />
                {tag}
              </button>
            ))
          )}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const tag = value.trim();
            if (!tag) return;
            void apply([...order.tags, tag]);
            setValue('');
          }}
        >
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Ajouter une étiquette"
          />
          <Button type="submit" variant="outline" size="sm" disabled={!value.trim()}>
            Ajouter
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

// --- calls and notes --------------------------------------------------------

function CallPanel({
  order,
  busy,
  onDone,
}: {
  order: OrderDetail;
  busy: boolean;
  onDone: (next: OrderDetail) => void;
}) {
  const [outcome, setOutcome] = useState<string>(CallOutcome.NO_ANSWER);
  const [note, setNote] = useState('');
  const [callBackAt, setCallBackAt] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      onDone(
        await orders.logCall(order.id, {
          outcome,
          note: note || undefined,
          callBackAt: callBackAt || undefined,
        }),
      );
      notify.success('Appel enregistré');
      setNote('');
      setCallBackAt('');
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Résultat de l’appel">
            <Select
              value={outcome}
              onValueChange={setOutcome}
              options={Object.entries(CALL_OUTCOME_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Field>
          <Field label="Rappeler le" hint="Facultatif">
            <Input
              type="datetime-local"
              value={callBackAt}
              onChange={(event) => setCallBackAt(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Note">
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>

        <Button size="sm" loading={saving || busy} onClick={() => void submit()}>
          <Phone className="h-4 w-4" />
          Enregistrer l’appel
        </Button>

        {order.callLogs.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line border-t border-line pt-2">
            {order.callLogs.map((log) => (
              <li key={log.id} className="py-2.5 text-sm">
                <p className="font-medium">
                  {CALL_OUTCOME_LABELS[log.outcome] ?? log.outcome}
                  {log.callBackAt ? (
                    <span className="ms-2 text-xs text-brass">
                      rappel {dateTimeFormatter.format(new Date(log.callBackAt))}
                    </span>
                  ) : null}
                </p>
                {log.note ? <p className="text-xs text-muted">{log.note}</p> : null}
                <p className="text-xs text-muted">
                  {log.agentName ?? 'Système'} ·{' '}
                  {dateTimeFormatter.format(new Date(log.createdAt))}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

function NotePanel({
  order,
  busy,
  onDone,
}: {
  order: OrderDetail;
  busy: boolean;
  onDone: (next: OrderDetail) => void;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <Field label="Nouvelle note">
          <Textarea rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>

        <Button
          size="sm"
          loading={saving || busy}
          disabled={!body.trim()}
          onClick={async () => {
            setSaving(true);
            try {
              onDone(await orders.addOrderNote(order.id, { body: body.trim() }));
              setBody('');
            } catch (error) {
              notify.error(message(error, "L'enregistrement a échoué"));
            } finally {
              setSaving(false);
            }
          }}
        >
          Ajouter
        </Button>

        {order.notes.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line border-t border-line pt-2">
            {order.notes.map((note) => (
              <li key={note.id} className="py-2.5 text-sm">
                <p className="whitespace-pre-line">{note.body}</p>
                <p className="mt-1 text-xs text-muted">
                  {note.authorName ?? 'Système'} ·{' '}
                  {dateTimeFormatter.format(new Date(note.createdAt))}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

// --- transition -------------------------------------------------------------

function TransitionDialog({
  order,
  target,
  onClose,
  onDone,
}: {
  order: OrderDetail;
  target: OrderStatus | null;
  onClose: () => void;
  onDone: (next: OrderDetail) => void;
}) {
  const [reason, setReason] = useState('');
  const [cash, setCash] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  const needsCash = target === OrderStatus.DELIVERED && order.paymentMethod === 'COD';
  const needsReason = target === OrderStatus.CANCELLED || target === OrderStatus.FAILED;

  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      onDone(
        await orders.transitionOrder(order.id, {
          to: target,
          reason: reason || undefined,
          ...(needsCash && cash !== null ? { cashCollected: cash.toString() } : {}),
        }),
      );
      notify.success(`${order.number} — ${ORDER_STATUS_LABELS[target] ?? target}`);
      setReason('');
      setCash(null);
    } catch (error) {
      notify.error(message(error, 'La transition a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target ? (TRANSITION_LABELS[target] ?? target) : ''} — {order.number}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {target === OrderStatus.CANCELLED && order.stockDeducted ? (
            <Alert tone="info" title="Le stock sera remis en rayon">
              Les articles de cette commande retourneront au stock disponible.
            </Alert>
          ) : null}

          {needsCash ? (
            <Field
              label="Montant encaissé"
              hint={`Attendu : ${formatDa(order.totalMinor)}. Un montant inférieur laisse la commande partiellement réglée.`}
            >
              <MoneyInput
                value={cash ?? order.totalMinor}
                onValueChange={(value) => setCash(value)}
              />
            </Field>
          ) : null}

          <Field
            label="Motif"
            required={needsReason}
            hint="Apparaît dans l’historique de la commande"
          >
            <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={needsReason && !reason.trim()}
            variant={target === OrderStatus.CANCELLED ? 'danger' : 'primary'}
            onClick={() => void submit()}
          >
            {target ? (TRANSITION_LABELS[target] ?? target) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={strong ? 'font-medium text-ink' : 'text-muted'}>{label}</dt>
      <dd
        className={cn(
          'tabular-nums',
          strong && 'text-base font-semibold',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
