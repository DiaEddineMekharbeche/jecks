import type { AbandonedCartRow, AffiliateRow } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
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
  SwitchField,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import * as content from './api';

/**
 * The three marketing screens — PRD F-AD-91.
 *
 * Kept in one file because they share a shape: a list of people who could be sold to,
 * and what happened when somebody tried.
 */

// --- newsletter -------------------------------------------------------------

export function NewsletterPage() {
  const [busy, setBusy] = useState(false);

  const stats = useQuery({
    queryKey: ['admin', 'newsletter-stats'],
    queryFn: content.newsletterStats,
  });

  const subscribers = useQuery({
    queryKey: ['admin', 'newsletter'],
    queryFn: () => content.listSubscribers(500),
  });

  async function sync() {
    setBusy(true);
    try {
      const result = await content.syncNewsletter({});
      notify.success(
        `${result.sent} contact(s) synchronisés avec ${result.provider}` +
          (result.skipped > 0 ? `, ${result.skipped} ignorés` : ''),
      );
      for (const warning of result.warnings) notify.error(warning);
    } catch (error) {
      notify.error(message(error, 'La synchronisation a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Newsletter"
        description="La liste appartient à la boutique ; le prestataire n’en reçoit qu’une copie."
        actions={
          <Button size="sm" loading={busy} onClick={() => void sync()}>
            <RefreshCw className="h-4 w-4" />
            Synchroniser
          </Button>
        }
      />

      {stats.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Inscrits" value={String(stats.data.total)} />
          <Tile label="Confirmés" value={String(stats.data.confirmed)} tone="success" />
          <Tile
            label="Désinscrits"
            value={String(stats.data.unsubscribed)}
            tone={stats.data.unsubscribed > 0 ? 'warning' : undefined}
          />
          <Tile label="30 derniers jours" value={`+${stats.data.last30Days}`} />
        </div>
      ) : null}

      <Alert tone="info" title="Les désinscriptions partent aussi">
        Une désinscription est envoyée au prestataire comme le reste, sinon la prochaine campagne
        atteindrait quelqu’un qui a demandé à ne plus rien recevoir.
      </Alert>

      {stats.data && stats.data.bySource.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>D’où ils viennent</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {stats.data.bySource.map((entry) => (
              <Badge key={entry.source} tone="neutral">
                {entry.source} · {entry.count}
              </Badge>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Inscrits</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {subscribers.isLoading ? (
            <Skeleton className="m-4 h-40" label="Chargement des inscrits" />
          ) : (subscribers.data ?? []).length === 0 ? (
            <EmptyState className="border-0" title="Personne pour l’instant" />
          ) : (
            <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
              {subscribers.data!.map((subscriber) => (
                <li
                  key={subscriber.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-4 py-2',
                    subscriber.unsubscribed && 'opacity-50',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{subscriber.email ?? subscriber.phone}</p>
                    <p className="text-xs text-muted">
                      {subscriber.source ?? 'inconnu'} · {subscriber.locale}
                    </p>
                  </div>
                  {subscriber.unsubscribed ? (
                    <Badge tone="danger">désinscrit</Badge>
                  ) : subscriber.confirmed ? (
                    <Badge tone="success">confirmé</Badge>
                  ) : (
                    <Badge tone="neutral">en attente</Badge>
                  )}
                  <span className="whitespace-nowrap text-xs text-muted">
                    {dateFormatter.format(new Date(subscriber.createdAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// --- abandoned carts --------------------------------------------------------

const CART_TABS = [
  { value: 'open', label: 'À relancer' },
  { value: 'contacted', label: 'Relancés' },
  { value: 'recovered', label: 'Récupérés' },
  { value: 'all', label: 'Tous' },
];

export function AbandonedCartsPage() {
  const [filter, setFilter] = useState('open');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const stats = useQuery({
    queryKey: ['admin', 'abandoned-cart-stats'],
    queryFn: content.abandonedCartStats,
  });

  const carts = useQuery({
    queryKey: ['admin', 'abandoned-carts', filter],
    queryFn: () => content.listAbandonedCarts(filter),
  });

  async function contact() {
    setBusy(true);
    try {
      const result = await content.contactCarts({ cartIds: selected });
      notify.success(`${result.queued} relance(s) envoyées`);
      if (result.skipped > 0) {
        notify.error(`${result.skipped} panier(s) sans numéro de téléphone`);
      }
      setSelected([]);
      await Promise.all([carts.refetch(), stats.refetch()]);
    } catch (error) {
      notify.error(message(error, 'La relance a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Paniers abandonnés"
        description="Ce que des clients ont mis de côté sans finir."
        actions={
          <Button
            size="sm"
            loading={busy}
            disabled={selected.length === 0}
            onClick={() => void contact()}
          >
            <MessageCircle className="h-4 w-4" />
            Relancer ({selected.length})
          </Button>
        }
      />

      {stats.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            label="À relancer"
            value={String(stats.data.open)}
            hint={formatDa(stats.data.openValueMinor)}
          />
          <Tile label="Relancés" value={String(stats.data.contacted)} />
          <Tile
            label="Récupérés"
            value={String(stats.data.recovered)}
            hint={formatDa(stats.data.recoveredValueMinor)}
            tone="success"
          />
          <Tile
            label="Taux de récupération"
            value={`${stats.data.recoveryRate} %`}
            hint="sur les paniers relancés"
          />
        </div>
      ) : null}

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
          {CART_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={filter === tab.value}
              onClick={() => {
                setFilter(tab.value);
                setSelected([]);
              }}
              className={cn(
                'relative whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                filter === tab.value
                  ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brass'
                  : 'text-muted hover:text-ink',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {carts.isLoading ? (
        <Skeleton className="h-64" label="Chargement des paniers" />
      ) : (carts.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucun panier"
          description="Un panier devient abandonné après quelques heures sans commande."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {carts.data!.map((cart) => (
                <CartRow
                  key={cart.id}
                  cart={cart}
                  selectable={!cart.contactedAt && !cart.recoveredOrderId}
                  checked={selected.includes(cart.id)}
                  onToggle={() =>
                    setSelected((current) =>
                      current.includes(cart.id)
                        ? current.filter((id) => id !== cart.id)
                        : [...current, cart.id],
                    )
                  }
                />
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function CartRow({
  cart,
  selectable,
  checked,
  onToggle,
}: {
  cart: AbandonedCartRow;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      {selectable ? (
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={`Sélectionner le panier de ${cart.fullName ?? cart.phone ?? 'ce client'}`}
          disabled={!cart.phone}
        />
      ) : (
        <span className="w-4" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{cart.fullName ?? 'Client anonyme'}</p>
        <p className="truncate text-xs text-muted">
          {cart.phone ?? 'aucun numéro'} · {cart.itemCount} article(s) ·{' '}
          {dateFormatter.format(new Date(cart.createdAt))}
        </p>
      </div>

      {cart.recoveredOrderNumber ? (
        <Badge tone="success">récupéré {cart.recoveredOrderNumber}</Badge>
      ) : cart.contactedAt ? (
        <Badge tone="info">relancé</Badge>
      ) : null}

      <span className="text-sm tabular-nums">{formatDa(cart.subtotalMinor)}</span>

      {cart.phone ? (
        <a
          href={`https://wa.me/${cart.phone.replace(/[^\d]/g, '')}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-elevated hover:text-ink"
          aria-label="Écrire sur WhatsApp"
        >
          <MessageCircle className="h-4 w-4" />
        </a>
      ) : null}
    </li>
  );
}

// --- affiliates -------------------------------------------------------------

export function AffiliatesPage() {
  const [editing, setEditing] = useState<AffiliateRow | 'new' | null>(null);

  const affiliates = useQuery({
    queryKey: ['admin', 'affiliates'],
    queryFn: content.listAffiliates,
  });

  async function remove(affiliate: AffiliateRow) {
    if (!window.confirm(`Retirer ${affiliate.name} ?`)) return;
    try {
      await content.deleteAffiliate(affiliate.id);
      notify.success('Affilié retiré');
      await affiliates.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  const owed = (affiliates.data ?? []).reduce(
    (sum, affiliate) => sum + BigInt(affiliate.commissionMinor),
    0n,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Affiliés"
        description="Les personnes payées pour envoyer du trafic, et ce que leur code a rapporté."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Nouvel affilié
          </Button>
        }
      />

      {owed > 0n ? (
        <Alert tone="info" title={`${formatDa(owed.toString())} de commissions cumulées`}>
          Calculées sur les commandes livrées uniquement : une commande refusée à la porte n’est
          pas une vente.
        </Alert>
      ) : null}

      {affiliates.isLoading ? (
        <Skeleton className="h-64" label="Chargement des affiliés" />
      ) : (affiliates.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucun affilié"
          description="Associez un code promo à une personne pour suivre ce qu’elle apporte."
          action={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Nouvel affilié
            </Button>
          }
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-2 text-start font-medium">Affilié</th>
                  <th className="px-4 py-2 text-start font-medium">Code</th>
                  <th className="px-4 py-2 text-end font-medium">Commandes</th>
                  <th className="px-4 py-2 text-end font-medium">CA livré</th>
                  <th className="px-4 py-2 text-end font-medium">Taux</th>
                  <th className="px-4 py-2 text-end font-medium">Commission</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {affiliates.data!.map((affiliate) => (
                  <tr key={affiliate.id} className={cn(!affiliate.active && 'opacity-60')}>
                    <td className="px-4 py-2">
                      <p className="font-medium">{affiliate.name}</p>
                      <p className="text-xs text-muted">@{affiliate.handle}</p>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {affiliate.promotionCode ?? <span className="text-muted">aucun</span>}
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums">{affiliate.orders}</td>
                    <td className="px-4 py-2 text-end tabular-nums">
                      {formatDa(affiliate.revenueMinor)}
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums text-muted">
                      {affiliate.commissionPercent} %
                    </td>
                    <td className="px-4 py-2 text-end font-medium tabular-nums">
                      {formatDa(affiliate.commissionMinor)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(affiliate)}>
                          Modifier
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Retirer"
                          onClick={() => void remove(affiliate)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {editing ? (
        <AffiliateDialog
          affiliate={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void affiliates.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function AffiliateDialog({
  affiliate,
  onClose,
  onSaved,
}: {
  affiliate: AffiliateRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(affiliate?.name ?? '');
  const [handle, setHandle] = useState(affiliate?.handle ?? '');
  const [phone, setPhone] = useState(affiliate?.phone ?? '');
  const [email, setEmail] = useState(affiliate?.email ?? '');
  const [promotionId, setPromotionId] = useState(affiliate?.promotionId ?? '');
  const [commissionPercent, setCommissionPercent] = useState(
    String(affiliate?.commissionPercent ?? 10),
  );
  const [active, setActive] = useState(affiliate?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Only promotions with a code make sense here: the code is the attribution.
  const promotionOptions = useQuery({
    queryKey: ['admin', 'promotions', 'for-affiliates'],
    queryFn: async () => {
      const result = await api<Array<{ id: string; name: string; code: string | null }>>(
        '/admin/promotions',
        { query: { pageSize: 100 } },
      );
      return result.filter((promotion) => promotion.code);
    },
  });

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        name: name.trim(),
        handle: handle.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        promotionId: promotionId || null,
        commissionPercent: Number(commissionPercent),
        active,
      };

      if (affiliate) await content.updateAffiliate(affiliate.id, payload);
      else await content.createAffiliate(payload);

      notify.success(affiliate ? 'Affilié mis à jour' : 'Affilié ajouté');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{affiliate ? affiliate.name : 'Nouvel affilié'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required error={errors.name}>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>

          <Field label="Pseudo" required hint="Sert d’identifiant." error={errors.handle}>
            <Input
              value={handle}
              onChange={(event) =>
                setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))
              }
              className="font-mono"
              placeholder="lina.style"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Téléphone">
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
            <Field label="E-mail" error={errors.email}>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
          </div>

          <Field
            label="Code promo attribué"
            hint="C’est lui qui permet de compter ce que cette personne rapporte."
          >
            <Select
              value={promotionId}
              onValueChange={setPromotionId}
              options={[
                { value: '', label: 'Aucun' },
                ...(promotionOptions.data ?? []).map((promotion) => ({
                  value: promotion.id,
                  label: `${promotion.name} (${promotion.code})`,
                })),
              ]}
            />
          </Field>

          <Field label="Commission" hint="Pourcentage du chiffre d’affaires livré.">
            <Input
              type="number"
              min={0}
              max={50}
              step="0.5"
              value={commissionPercent}
              onChange={(event) => setCommissionPercent(event.target.value)}
              className="max-w-[140px]"
            />
          </Field>

          <SwitchField label="Actif" checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!name.trim() || !handle.trim()}
            onClick={() => void submit()}
          >
            Enregistrer
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
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
