import { t, type StockCountItemDto } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
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
  Input,
  PageHeader,
  Skeleton,
  StatTile,
  cn,
  notify,
} from '@jecks/ui';
import { ArrowLeft, Ban, Check, Download, Save, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDa, message } from '@/lib/errors';
import * as inventory from './api';
import { COUNT_STATUS_LABELS, COUNT_STATUS_TONES } from './StockCountsPage';
import { useInventoryInvalidate, useStockCount } from './queries';

/**
 * One count session — PRD F-AD-51.
 *
 * Counted quantities are held locally until the operator saves, because a warehouse
 * tablet on a weak connection should not lose a shelf's worth of typing to a failed
 * request. Applying is a separate, explicit step that writes the movements.
 */
export function StockCountSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invalidate = useInventoryInvalidate();
  const session = useStockCount(id);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  const data = session.data;
  const open = data?.status === 'OPEN';

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const needle = term.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.sku.toLowerCase().includes(needle) ||
        t(item.productName, 'fr').toLowerCase().includes(needle),
    );
  }, [data?.items, term]);

  const pending = Object.keys(drafts).length;

  function countedFor(item: StockCountItemDto): string {
    const draft = drafts[item.id];
    if (draft !== undefined) return draft;
    return item.countedQuantity === null ? '' : String(item.countedQuantity);
  }

  function varianceFor(item: StockCountItemDto): number | null {
    const value = countedFor(item);
    if (value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed - item.expectedQuantity : null;
  }

  async function save() {
    if (!id || pending === 0) return;
    setBusy(true);
    try {
      await inventory.enterStockCount(id, {
        lines: Object.entries(drafts).map(([itemId, value]) => ({
          itemId,
          countedQuantity: value === '' ? null : Number(value),
        })),
      });
      notify.success(`${pending} ligne(s) enregistrée(s)`);
      setDrafts({});
      void session.refetch();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!id) return;
    setBusy(true);
    try {
      if (pending > 0) {
        await inventory.enterStockCount(id, {
          lines: Object.entries(drafts).map(([itemId, value]) => ({
            itemId,
            countedQuantity: value === '' ? null : Number(value),
          })),
        });
        setDrafts({});
      }
      const applied = await inventory.applyStockCount(id);
      notify.success(`Écarts appliqués : ${applied.varianceUnits} unité(s)`);
      setConfirmApply(false);
      invalidate();
      void session.refetch();
    } catch (error) {
      notify.error(message(error, "L'application a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!id) return;
    setBusy(true);
    try {
      await inventory.cancelStockCount(id);
      notify.success('Session annulée');
      invalidate();
      void session.refetch();
    } catch (error) {
      notify.error(message(error, "L'annulation a échoué"));
    } finally {
      setBusy(false);
    }
  }

  if (session.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (session.error || !data) {
    return (
      <EmptyState
        title="Session introuvable"
        description={(session.error as Error | null)?.message ?? 'Cette session n’existe plus.'}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/inventory/counts')}>
            Retour aux inventaires
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
              onClick={() => navigate('/inventory/counts')}
              aria-label="Retour"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {data.name}
            <Badge tone={COUNT_STATUS_TONES[data.status] ?? 'neutral'}>
              {COUNT_STATUS_LABELS[data.status] ?? data.status}
            </Badge>
          </span>
        }
        description={`${data.locationName} · ${data.itemCount} référence(s)`}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4" />
                  Rapport d’écarts
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Format</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() =>
                    void inventory
                      .downloadStockCountReport(data.id, data.name, 'csv')
                      .catch((error) => notify.error(message(error, "L'export a échoué")))
                  }
                >
                  CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void inventory
                      .downloadStockCountReport(data.id, data.name, 'xlsx')
                      .catch((error) => notify.error(message(error, "L'export a échoué")))
                  }
                >
                  Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {open ? (
              <>
                <Button variant="ghost" size="sm" loading={busy} onClick={() => void cancel()}>
                  <Ban className="h-4 w-4" />
                  Annuler la session
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={busy}
                  disabled={pending === 0}
                  onClick={() => void save()}
                >
                  <Save className="h-4 w-4" />
                  Enregistrer{pending > 0 ? ` (${pending})` : ''}
                </Button>
                <Button size="sm" onClick={() => setConfirmApply(true)}>
                  <Check className="h-4 w-4" />
                  Appliquer les écarts
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Références" value={data.itemCount} />
        <StatTile label="Comptées" value={data.countedCount} hint={`${pending} non enregistrée(s)`} />
        <StatTile
          label="Écart en unités"
          value={data.varianceUnits > 0 ? `+${data.varianceUnits}` : data.varianceUnits}
        />
        <StatTile label="Écart en valeur" value={formatDa(data.varianceValueMinor)} />
      </div>

      {data.status === 'APPLIED' ? (
        <Alert tone="success" title="Écarts appliqués">
          Les mouvements de stock ont été écrits ; la session est close.
        </Alert>
      ) : null}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <label className="relative max-w-sm">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Filtrer par SKU ou produit"
              className="ps-9"
              aria-label="Filtrer les lignes"
            />
          </label>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                  <th className="px-3 py-2 text-start font-medium">Article</th>
                  <th className="px-3 py-2 text-end font-medium">Attendu</th>
                  <th className="px-3 py-2 text-end font-medium">Compté</th>
                  <th className="px-3 py-2 text-end font-medium">Écart</th>
                  <th className="px-3 py-2 text-end font-medium">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const variance = varianceFor(item);
                  return (
                    <tr key={item.id} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2">
                        <p className="truncate font-medium text-ink">
                          {t(item.productName, 'fr')}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {item.sku}
                          {item.variantName ? ` · ${item.variantName}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums text-muted">
                        {item.expectedQuantity}
                      </td>
                      <td className="px-3 py-2 text-end">
                        {open ? (
                          <Input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            className="ms-auto w-24 text-end"
                            value={countedFor(item)}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{item.countedQuantity ?? '—'}</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-end tabular-nums',
                          variance === null || variance === 0
                            ? 'text-muted'
                            : variance > 0
                              ? 'text-success'
                              : 'text-danger',
                        )}
                      >
                        {variance === null ? '—' : variance > 0 ? `+${variance}` : variance}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums text-muted">
                        {item.varianceValueMinor === '0'
                          ? '—'
                          : formatDa(item.varianceValueMinor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Dialog open={confirmApply} onOpenChange={(next) => (next ? undefined : setConfirmApply(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Appliquer les écarts ?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted">
              Un mouvement de stock sera écrit pour chaque ligne comptée dont la quantité diffère
              du stock actuel. Les lignes non comptées ne sont pas touchées. Cette action clôt la
              session.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmApply(false)}>
              Annuler
            </Button>
            <Button loading={busy} onClick={() => void apply()}>
              Appliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
