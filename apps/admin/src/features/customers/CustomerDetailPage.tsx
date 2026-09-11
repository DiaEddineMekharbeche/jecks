import { t, type CustomerDetail } from '@jecks/shared';
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
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  SwitchField,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dateFormatter, dateTimeFormatter, formatDa, message } from '@/lib/errors';
import * as customers from './api';
import { LOYALTY_KIND_LABELS, SEGMENT_HINTS, SEGMENT_LABELS, SEGMENT_TONES } from './labels';

/**
 * One customer — PRD F-AD-41.
 *
 * Everything an agent needs before picking up the phone: what this person has bought,
 * how often they actually take the parcel, and whether anybody has written down why the
 * last one failed.
 */
export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [noteOpen, setNoteOpen] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['admin', 'customer', id],
    queryFn: () => customers.getCustomer(id!),
    enabled: Boolean(id),
  });

  const groups = useQuery({
    queryKey: ['admin', 'customer-groups'],
    queryFn: customers.listGroups,
    staleTime: 300_000,
  });

  async function refresh() {
    setBusy(true);
    try {
      await customers.refreshRollups(id!);
      notify.success('Compteurs recalculés');
      await query.refetch();
    } catch (error) {
      notify.error(message(error, 'Le recalcul a échoué'));
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement du client" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <EmptyState
        title="Client introuvable"
        description={(query.error as Error | undefined)?.message ?? ''}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/customers')}>
            Retour aux clients
          </Button>
        }
      />
    );
  }

  const customer = query.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Retour"
              onClick={() => navigate('/customers')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {customer.fullName}
            <Badge tone={SEGMENT_TONES[customer.segment] ?? 'neutral'}>
              {SEGMENT_LABELS[customer.segment] ?? customer.segment}
            </Badge>
          </span>
        }
        description={SEGMENT_HINTS[customer.segment]}
        actions={
          <>
            <a
              href={`tel:${customer.phone}`}
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-line px-3 text-sm hover:bg-elevated"
            >
              <Phone className="h-4 w-4" />
              Appeler
            </a>
            <a
              href={`https://wa.me/${customer.phone.replace(/[^\d]/g, '')}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-line px-3 text-sm hover:bg-elevated"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
            <Button variant="outline" size="sm" loading={busy} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" />
              Recalculer
            </Button>
            <Button
              variant={customer.blacklisted ? 'outline' : 'danger'}
              size="sm"
              onClick={() => setBlacklistOpen(true)}
            >
              {customer.blacklisted ? (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Débloquer
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4" />
                  Bloquer
                </>
              )}
            </Button>
          </>
        }
      />

      {customer.blacklisted ? (
        <Alert tone="danger" title="Client bloqué">
          {customer.blacklistReason ?? 'Aucun motif enregistré.'} Ses nouvelles commandes sont
          refusées au checkout.
        </Alert>
      ) : customer.overdue ? (
        <Alert tone="warning" title="Client en retard sur son rythme">
          Il commande en moyenne tous les {customer.averageDaysBetweenOrders} jours et n’a rien
          commandé depuis plus longtemps que d’habitude.
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Commandes" value={String(customer.ordersCount)} hint={`${customer.deliveredCount} livrées`} />
        <Tile
          label="Fiabilité"
          value={customer.reliability === null ? '—' : `${customer.reliability} %`}
          hint={`${customer.failedCount} échec(s)`}
          tone={
            customer.reliability !== null && customer.reliability < 60 ? 'danger' : undefined
          }
        />
        <Tile label="Valeur vie" value={formatDa(customer.lifetimeValueMinor)} />
        <Tile label="Panier moyen" value={formatDa(customer.averageOrderMinor)} />
        <Tile
          label="Points"
          value={String(customer.loyaltyPoints)}
          hint="fidélité"
          action={
            <Button variant="ghost" size="sm" onClick={() => setPointsOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" />
              Ajuster
            </Button>
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px] xl:items-start">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Commandes</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {customer.orders.length === 0 ? (
                <EmptyState className="border-0" title="Aucune commande" />
              ) : (
                <ul className="divide-y divide-line">
                  {customer.orders.map((order) => (
                    <li key={order.id}>
                      <Link
                        to={`/orders/${order.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated"
                      >
                        <span className="font-mono text-xs">{order.number}</span>
                        <StatusBadge status={order.status} />
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">
                          {dateFormatter.format(new Date(order.createdAt))} · {order.itemCount}{' '}
                          article(s)
                        </span>
                        <span className="text-sm tabular-nums">{formatDa(order.totalMinor)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Notes internes</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setNoteOpen(true)}>
                Ajouter
              </Button>
            </CardHeader>
            <CardBody className="p-0">
              {customer.notes.length === 0 ? (
                <EmptyState
                  className="border-0"
                  title="Aucune note"
                  description="Ce qu’un agent apprend au téléphone se perd s’il ne l’écrit pas."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {customer.notes.map((note) => (
                    <li key={note.id} className="px-4 py-3">
                      <p className="text-sm">{note.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        {note.authorName ?? 'Système'} ·{' '}
                        {dateTimeFormatter.format(new Date(note.createdAt))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Points de fidélité</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {customer.loyalty.length === 0 ? (
                <EmptyState
                  className="border-0"
                  title="Aucun mouvement"
                  description="Les points se gagnent à la livraison, pas à la commande."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {customer.loyalty.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 px-4 py-2">
                      <span
                        className={cn(
                          'w-16 text-sm font-medium tabular-nums',
                          entry.points < 0 ? 'text-danger' : 'text-success',
                        )}
                      >
                        {entry.points > 0 ? '+' : ''}
                        {entry.points}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {LOYALTY_KIND_LABELS[entry.kind] ?? entry.kind}
                        </p>
                        {entry.note ? (
                          <p className="truncate text-xs text-muted">{entry.note}</p>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted">solde {entry.balanceAfter}</span>
                      <span className="whitespace-nowrap text-xs text-muted">
                        {dateFormatter.format(new Date(entry.createdAt))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <ProfileCard
            customer={customer}
            groups={groups.data ?? []}
            onSaved={() => void query.refetch()}
          />

          <Card>
            <CardHeader>
              <CardTitle>Adresses</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {customer.addresses.length === 0 ? (
                <EmptyState className="border-0" title="Aucune adresse" />
              ) : (
                <ul className="divide-y divide-line">
                  {customer.addresses.map((address) => (
                    <li key={address.id} className="px-4 py-3">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {address.label ?? 'Adresse'}
                        {address.isDefault ? <Badge tone="brass">par défaut</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{address.address}</p>
                      <p className="text-xs text-muted">
                        {address.communeName ? `${address.communeName}, ` : ''}
                        {address.wilayaName}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Repères</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-2 text-sm">
              <Row
                label="Première commande"
                value={
                  customer.firstOrderAt
                    ? dateFormatter.format(new Date(customer.firstOrderAt))
                    : '—'
                }
              />
              <Row
                label="Dernière commande"
                value={
                  customer.lastOrderAt ? dateFormatter.format(new Date(customer.lastOrderAt)) : '—'
                }
              />
              <Row
                label="Rythme"
                value={
                  customer.averageDaysBetweenOrders === null
                    ? 'inconnu'
                    : `tous les ${customer.averageDaysBetweenOrders} j`
                }
              />
              <Row label="Annulées" value={String(customer.cancelledCount)} />
              <Row label="Client depuis" value={dateFormatter.format(new Date(customer.createdAt))} />
            </CardBody>
          </Card>
        </div>
      </div>

      <NoteDialog
        open={noteOpen}
        customerId={customer.id}
        onClose={() => setNoteOpen(false)}
        onSaved={() => {
          setNoteOpen(false);
          void query.refetch();
        }}
      />

      <BlacklistDialog
        open={blacklistOpen}
        customer={customer}
        onClose={() => setBlacklistOpen(false)}
        onSaved={() => {
          setBlacklistOpen(false);
          void query.refetch();
        }}
      />

      <PointsDialog
        open={pointsOpen}
        customerId={customer.id}
        balance={customer.loyaltyPoints}
        onClose={() => setPointsOpen(false)}
        onSaved={() => {
          setPointsOpen(false);
          void query.refetch();
        }}
      />
    </div>
  );
}

function ProfileCard({
  customer,
  groups,
  onSaved,
}: {
  customer: CustomerDetail;
  groups: Array<{ id: string; name: Record<string, string> }>;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(customer.fullName);
  const [email, setEmail] = useState(customer.email ?? '');
  const [altPhone, setAltPhone] = useState(customer.altPhone ?? '');
  const [groupId, setGroupId] = useState(customer.groupId ?? '');
  const [acceptsMarketing, setAcceptsMarketing] = useState(customer.acceptsMarketing);
  const [busy, setBusy] = useState(false);

  const dirty =
    fullName !== customer.fullName ||
    email !== (customer.email ?? '') ||
    altPhone !== (customer.altPhone ?? '') ||
    groupId !== (customer.groupId ?? '') ||
    acceptsMarketing !== customer.acceptsMarketing;

  async function save() {
    setBusy(true);
    try {
      await customers.updateCustomer(customer.id, {
        fullName: fullName.trim(),
        email: email.trim() || null,
        altPhone: altPhone.trim() || null,
        groupId: groupId || null,
        acceptsMarketing,
      });
      notify.success('Fiche mise à jour');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiche</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <Field label="Téléphone" hint="L’identité du client ; elle ne se modifie pas ici.">
          <Input value={customer.phone} readOnly className="font-mono" />
        </Field>

        <Field label="Nom complet">
          <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </Field>

        <Field label="Second numéro" hint="Ce qui transforme un échec de livraison en réussite.">
          <Input value={altPhone} onChange={(event) => setAltPhone(event.target.value)} />
        </Field>

        <Field label="E-mail">
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>

        <Field label="Groupe">
          <Select
            value={groupId}
            onValueChange={setGroupId}
            options={[
              { value: '', label: 'Aucun' },
              ...groups.map((group) => ({ value: group.id, label: t(group.name, 'fr') })),
            ]}
          />
        </Field>

        <SwitchField
          label="Accepte le marketing"
          description="Newsletter et relances."
          checked={acceptsMarketing}
          onCheckedChange={setAcceptsMarketing}
        />

        <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
          Enregistrer
        </Button>
      </CardBody>
    </Card>
  );
}

function NoteDialog({
  open,
  customerId,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await customers.addNote(customerId, { body: body.trim() });
      notify.success('Note ajoutée');
      setBody('');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'ajout a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Note interne</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field label="Note" hint="Visible par l’équipe, jamais par le client.">
            <Textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!body.trim()} onClick={() => void submit()}>
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlacklistDialog({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean;
  customer: CustomerDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState(customer.blacklistReason ?? '');
  const [busy, setBusy] = useState(false);
  const blocking = !customer.blacklisted;

  async function submit() {
    setBusy(true);
    try {
      await customers.setBlacklisted(customer.id, {
        blacklisted: blocking,
        reason: blocking ? reason.trim() : null,
      });
      notify.success(blocking ? 'Client bloqué' : 'Client débloqué');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'opération a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{blocking ? 'Bloquer ce client' : 'Débloquer ce client'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {blocking ? (
            <>
              <Alert tone="warning" title="Ses commandes seront refusées">
                Le blocage est le seul signal qui refuse une commande d’office. Tout le reste se
                contente de la signaler.
              </Alert>
              <Field label="Motif" required hint="Le prochain agent aura besoin de le lire.">
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="3 colis refusés à la porte en deux mois"
                />
              </Field>
            </>
          ) : (
            <p className="text-sm">
              Motif actuel : {customer.blacklistReason ?? 'aucun'}. Le client pourra de nouveau
              commander.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant={blocking ? 'danger' : 'primary'}
            loading={busy}
            disabled={blocking && !reason.trim()}
            onClick={() => void submit()}
          >
            {blocking ? 'Bloquer' : 'Débloquer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PointsDialog({
  open,
  customerId,
  balance,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  balance: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const result = await customers.adjustLoyalty(customerId, {
        points: Number(points),
        note: note.trim(),
      });
      notify.success(`Nouveau solde : ${result.balance} point(s)`);
      setPoints('');
      setNote('');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'ajustement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajuster les points</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-sm text-muted">Solde actuel : {balance} point(s).</p>

          <Field label="Mouvement" required hint="Négatif pour retirer des points.">
            <Input
              type="number"
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              placeholder="500"
            />
          </Field>

          <Field label="Motif" required hint="Un ajustement sans raison est une erreur plus tard.">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!points || Number(points) === 0 || !note.trim()}
            onClick={() => void submit()}
          >
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'danger';
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'danger' && 'text-danger')}>
        {value}
      </p>
      <div className="flex items-center justify-between gap-2">
        {hint ? <span className="text-xs text-muted">{hint}</span> : <span />}
        {action}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
