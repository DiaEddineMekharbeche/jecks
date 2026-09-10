import { DeliveryType, t, type RateMatrixRow } from '@jecks/shared';
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
  Field,
  Input,
  MoneyInput,
  MultiSelect,
  PageHeader,
  Select,
  Skeleton,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { Layers, Plus, Save, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDa, message } from '@/lib/errors';
import * as delivery from './api';

/**
 * The price of every journey — PRD F-AD-60.
 *
 * One grid: 58 wilayas by two delivery types. Editing a cell stages it rather than
 * saving it, because a shop changes a whole column at once and 58 round trips would
 * leave the table half-updated if one failed.
 *
 * A cell inherited from a zone is shown greyed. Typing in it creates a wilaya-specific
 * rate, which is exactly the mental model: the zone is the default, the cell is the
 * exception.
 */

interface StagedCell {
  wilayaCode: number;
  deliveryType: DeliveryType;
  priceMinor: bigint;
}

export function RatesPage() {
  const [search, setSearch] = useState('');
  const [courierId, setCourierId] = useState('');
  const [staged, setStaged] = useState<Record<string, StagedCell>>({});
  const [busy, setBusy] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);

  const matrix = useQuery({
    queryKey: ['admin', 'rate-matrix', courierId],
    queryFn: () => delivery.rateMatrix(courierId || undefined),
  });

  const couriers = useQuery({
    queryKey: ['admin', 'couriers'],
    queryFn: delivery.listCouriers,
    staleTime: 300_000,
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return matrix.data ?? [];
    return (matrix.data ?? []).filter(
      (row) =>
        row.wilayaName.toLowerCase().includes(term) || String(row.wilayaCode).includes(term),
    );
  }, [matrix.data, search]);

  const stagedCount = Object.keys(staged).length;

  function stage(wilayaCode: number, deliveryType: DeliveryType, priceMinor: bigint | null) {
    const key = `${wilayaCode}-${deliveryType}`;
    setStaged((current) => {
      if (priceMinor === null) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: { wilayaCode, deliveryType, priceMinor } };
    });
  }

  async function save() {
    setBusy(true);
    try {
      const result = await delivery.bulkRates({
        cells: Object.values(staged).map((cell) => ({
          wilayaCode: cell.wilayaCode,
          deliveryType: cell.deliveryType,
          courierId: courierId || null,
          price: cell.priceMinor.toString(),
        })),
      });
      notify.success(`${result.written} tarif(s) enregistrés`);
      setStaged({});
      await matrix.refetch();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tarifs de livraison"
        description="Ce que paie le client, par wilaya et par type de remise."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setZonesOpen(true)}>
              <Layers className="h-4 w-4" />
              Zones
            </Button>
            <Button size="sm" loading={busy} disabled={stagedCount === 0} onClick={() => void save()}>
              <Save className="h-4 w-4" />
              Enregistrer ({stagedCount})
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filtrer par wilaya"
            className="ps-9"
            aria-label="Filtrer les wilayas"
          />
        </label>
        <Field label="Transporteur" className="w-[220px]">
          <Select
            value={courierId}
            onValueChange={(value) => {
              setCourierId(value);
              setStaged({});
            }}
            options={[
              { value: '', label: 'Tarif par défaut' },
              ...(couriers.data ?? []).map((courier) => ({
                value: courier.id,
                label: courier.name,
              })),
            ]}
          />
        </Field>
      </div>

      {stagedCount > 0 ? (
        <Alert tone="warning" title={`${stagedCount} cellule(s) modifiée(s)`}>
          Rien n’est enregistré tant que vous n’avez pas cliqué sur Enregistrer.
        </Alert>
      ) : null}

      {matrix.isLoading ? (
        <Skeleton className="h-96" label="Chargement de la grille" />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 text-start font-medium">Wilaya</th>
                  <th className="px-4 py-3 text-start font-medium">Zone</th>
                  <th className="px-4 py-3 text-end font-medium">À domicile</th>
                  <th className="px-4 py-3 text-end font-medium">Stop desk</th>
                  <th className="px-4 py-3 text-end font-medium">Marge domicile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <MatrixRow
                    key={row.wilayaCode}
                    row={row}
                    staged={staged}
                    onStage={stage}
                  />
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <ZonesDialog open={zonesOpen} onClose={() => setZonesOpen(false)} />
    </div>
  );
}

function MatrixRow({
  row,
  staged,
  onStage,
}: {
  row: RateMatrixRow;
  staged: Record<string, StagedCell>;
  onStage: (wilayaCode: number, type: DeliveryType, price: bigint | null) => void;
}) {
  const homeKey = `${row.wilayaCode}-${DeliveryType.HOME}`;
  const deskKey = `${row.wilayaCode}-${DeliveryType.STOP_DESK}`;

  const homePrice = staged[homeKey]?.priceMinor ?? (row.home ? BigInt(row.home.priceMinor) : null);
  const homeCost = row.home ? BigInt(row.home.costMinor) : 0n;
  const margin = homePrice === null ? null : homePrice - homeCost;

  return (
    <tr className="hover:bg-elevated/50">
      <td className="px-4 py-2">
        <span className="font-medium">{String(row.wilayaCode).padStart(2, '0')}</span>
        <span className="ms-2 text-muted">{row.wilayaName}</span>
      </td>
      <td className="px-4 py-2 text-xs text-muted">{row.zoneName ? t(row.zoneName, 'fr') : '—'}</td>
      <td className="px-4 py-2">
        <Cell
          cell={row.home}
          staged={staged[homeKey]}
          onChange={(value) => onStage(row.wilayaCode, DeliveryType.HOME, value)}
        />
      </td>
      <td className="px-4 py-2">
        <Cell
          cell={row.stopDesk}
          staged={staged[deskKey]}
          onChange={(value) => onStage(row.wilayaCode, DeliveryType.STOP_DESK, value)}
        />
      </td>
      <td className="px-4 py-2 text-end">
        {margin === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className={cn('tabular-nums', margin < 0n ? 'text-danger' : 'text-muted')}>
            {formatDa(margin.toString())}
          </span>
        )}
      </td>
    </tr>
  );
}

function Cell({
  cell,
  staged,
  onChange,
}: {
  cell: RateMatrixRow['home'];
  staged: StagedCell | undefined;
  onChange: (value: bigint | null) => void;
}) {
  const value = staged?.priceMinor ?? (cell ? BigInt(cell.priceMinor) : null);

  return (
    <div className="flex items-center justify-end gap-2">
      {cell?.inherited && !staged ? (
        <Badge tone="neutral" className="normal-case">
          zone
        </Badge>
      ) : null}
      <MoneyInput
        value={value ?? ''}
        onValueChange={onChange}
        className={cn(
          'w-[130px]',
          staged && 'border-brass',
          cell?.inherited && !staged && 'text-muted',
        )}
        aria-label="Prix"
      />
    </div>
  );
}

/** Zones exist so a price change covers a band of wilayas rather than 58 cells. */
function ZonesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const zones = useQuery({
    queryKey: ['admin', 'shipping-zones'],
    queryFn: delivery.listZones,
    enabled: open,
  });

  const [editing, setEditing] = useState<{ id?: string; name: string; codes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const payload = {
        name: { fr: editing.name },
        wilayaCodes: editing.codes.map(Number),
        position: 0,
      };
      if (editing.id) await delivery.updateZone(editing.id, payload);
      else await delivery.createZone(payload);
      notify.success('Zone enregistrée');
      setEditing(null);
      await zones.refetch();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Supprimer la zone « ${name} » ?`)) return;
    try {
      await delivery.deleteZone(id);
      notify.success('Zone supprimée');
      await zones.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Zones tarifaires</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Alert tone="info" title="Une wilaya, une zone">
            Une zone donne le prix par défaut de ses wilayas. Un tarif saisi directement dans la
            grille l’emporte toujours.
          </Alert>

          {editing ? (
            <Card>
              <CardHeader>
                <CardTitle>{editing.id ? 'Modifier la zone' : 'Nouvelle zone'}</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-3">
                <Field label="Nom" required>
                  <Input
                    value={editing.name}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    placeholder="Grand Sud"
                  />
                </Field>
                <Field label="Wilayas" required>
                  <MultiSelect
                    options={Array.from({ length: 58 }, (_, index) => ({
                      value: String(index + 1),
                      label: String(index + 1).padStart(2, '0'),
                    }))}
                    values={editing.codes}
                    onValuesChange={(values) => setEditing({ ...editing, codes: values })}
                    placeholder="Choisir"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={!editing.name.trim() || editing.codes.length === 0}
                    onClick={() => void save()}
                  >
                    Enregistrer
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Annuler
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setEditing({ name: '', codes: [] })}
            >
              <Plus className="h-4 w-4" />
              Nouvelle zone
            </Button>
          )}

          <ul className="divide-y divide-line rounded-md border border-line">
            {(zones.data ?? []).map((zone) => (
              <li key={zone.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t(zone.name, 'fr')}</p>
                  <p className="truncate text-xs text-muted">
                    {zone.wilayaCodes.length} wilaya(s) · {zone.rateCount} tarif(s)
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      id: zone.id,
                      name: t(zone.name, 'fr'),
                      codes: zone.wilayaCodes.map(String),
                    })
                  }
                >
                  Modifier
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Supprimer"
                  onClick={() => void remove(zone.id, t(zone.name, 'fr'))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
