import { AD_PLATFORMS, type AdPlatform } from '@jecks/shared';
import {
  Alert,
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
  MoneyInput,
  PageHeader,
  Select,
  Skeleton,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { dateFormatter, formatDa, message } from '@/lib/errors';
import * as finance from './api';

/**
 * Advertising spend and what it bought — PRD F-AD-73.
 *
 * Orders are attributed by the UTM source recorded at checkout. That is last-click
 * attribution and it is imperfect; it is also the only signal the shop actually holds,
 * and the screen says so rather than implying a model it does not have.
 */

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  google: 'Google',
  other: 'Autre',
};

export function AdSpendPage() {
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  });
  const [adding, setAdding] = useState(false);

  const summary = useQuery({
    queryKey: ['admin', 'ad-spend', 'summary', from, to],
    queryFn: () => finance.adSpendSummary({ from, to }),
  });

  const rows = useQuery({
    queryKey: ['admin', 'ad-spend', from, to],
    queryFn: () => finance.listAdSpend({ from, to }),
  });

  async function remove(id: string) {
    if (!window.confirm('Supprimer cette ligne de dépense publicitaire ?')) return;
    try {
      await finance.deleteAdSpend(id);
      notify.success('Ligne supprimée');
      await Promise.all([rows.refetch(), summary.refetch()]);
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  const data = summary.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Publicité"
        description="Ce qui a été dépensé, et ce que cela a rapporté."
        actions={
          <>
            <Field label="Du" className="w-[150px]">
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="Au" className="w-[150px]">
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Saisir une dépense
            </Button>
          </>
        }
      />

      {summary.isLoading ? (
        <Skeleton className="h-64" label="Chargement de la publicité" />
      ) : !data ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Dépensé" value={formatDa(data.totalMinor)} />
            <Tile
              label="CA attribué"
              value={formatDa(data.revenueMinor)}
              hint={`${data.orders} commande(s) livrée(s)`}
            />
            <Tile
              label="ROAS"
              value={data.roas === null ? '—' : `${data.roas}×`}
              hint="CA par dinar dépensé"
              tone={data.roas !== null && data.roas < 2 ? 'danger' : 'success'}
            />
            <Tile
              label="Coût par commande"
              value={data.costPerOrderMinor ? formatDa(data.costPerOrderMinor) : '—'}
            />
          </div>

          <Alert tone="info" title="Attribution au dernier clic">
            Une commande est rattachée à la plateforme enregistrée dans son UTM au moment du
            checkout. Le trafic organique n’est jamais compté dans une campagne.
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Dépense contre chiffre d’affaires</CardTitle>
            </CardHeader>
            <CardBody className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.series.map((point) => ({
                    date: point.date.slice(5),
                    spend: Number(point.amountMinor) / 100,
                    revenue: Number(point.revenueMinor) / 100,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-line)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="spend"
                    name="Dépense"
                    stroke="var(--color-danger)"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="CA livré"
                    stroke="var(--color-success)"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Par plateforme</CardTitle>
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-2 text-start font-medium">Plateforme</th>
                    <th className="px-4 py-2 text-end font-medium">Dépensé</th>
                    <th className="px-4 py-2 text-end font-medium">Impressions</th>
                    <th className="px-4 py-2 text-end font-medium">Clics</th>
                    <th className="px-4 py-2 text-end font-medium">Commandes</th>
                    <th className="px-4 py-2 text-end font-medium">CA</th>
                    <th className="px-4 py-2 text-end font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.byPlatform.map((row) => (
                    <tr key={row.platform}>
                      <td className="px-4 py-2">{PLATFORM_LABELS[row.platform] ?? row.platform}</td>
                      <td className="px-4 py-2 text-end tabular-nums">
                        {formatDa(row.amountMinor)}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums text-muted">
                        {row.impressions.toLocaleString('fr-DZ')}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums text-muted">
                        {row.clicks.toLocaleString('fr-DZ')}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums">{row.orders}</td>
                      <td className="px-4 py-2 text-end tabular-nums">
                        {formatDa(row.revenueMinor)}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-end tabular-nums',
                          row.roas !== null && row.roas < 2 && 'text-danger',
                          row.roas !== null && row.roas >= 4 && 'text-success',
                        )}
                      >
                        {row.roas === null ? '—' : `${row.roas}×`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lignes saisies</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {rows.isLoading ? (
            <Skeleton className="m-4 h-24" label="Chargement des lignes" />
          ) : (rows.data ?? []).length === 0 ? (
            <EmptyState
              className="border-0"
              title="Aucune dépense saisie"
              description="Reportez ici le montant dépensé chaque jour, plateforme par plateforme."
            />
          ) : (
            <ul className="divide-y divide-line">
              {rows.data!.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <span className="w-24 text-sm text-muted">
                    {dateFormatter.format(new Date(row.spentOn))}
                  </span>
                  <span className="w-28 text-sm">
                    {PLATFORM_LABELS[row.platform] ?? row.platform}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {row.campaign || 'sans campagne'}
                  </span>
                  <span className="text-sm tabular-nums">{formatDa(row.amountMinor)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Supprimer"
                    onClick={() => void remove(row.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <AdSpendDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          void rows.refetch();
          void summary.refetch();
        }}
      />
    </div>
  );
}

function AdSpendDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [platform, setPlatform] = useState<AdPlatform>('facebook');
  const [campaign, setCampaign] = useState('');
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState<bigint | null>(null);
  const [impressions, setImpressions] = useState('');
  const [clicks, setClicks] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await finance.saveAdSpend({
        platform,
        campaign: campaign.trim() || null,
        spentOn,
        amount: (amount ?? 0n).toString(),
        impressions: impressions ? Number(impressions) : null,
        clicks: clicks ? Number(clicks) : null,
      });
      notify.success('Dépense enregistrée');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dépense publicitaire</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plateforme" required>
              <Select
                value={platform}
                onValueChange={(value) => setPlatform(value as AdPlatform)}
                options={AD_PLATFORMS.map((value) => ({
                  value,
                  label: PLATFORM_LABELS[value] ?? value,
                }))}
              />
            </Field>
            <Field label="Jour" required>
              <Input
                type="date"
                value={spentOn}
                onChange={(event) => setSpentOn(event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Campagne"
            hint="Le même jour et la même campagne remplacent la ligne au lieu de s’y ajouter."
          >
            <Input
              value={campaign}
              onChange={(event) => setCampaign(event.target.value)}
              placeholder="rentree-2026"
            />
          </Field>

          <Field label="Montant" required>
            <MoneyInput value={amount ?? ''} onValueChange={setAmount} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Impressions">
              <Input
                type="number"
                min={0}
                value={impressions}
                onChange={(event) => setImpressions(event.target.value)}
              />
            </Field>
            <Field label="Clics">
              <Input
                type="number"
                min={0}
                value={clicks}
                onChange={(event) => setClicks(event.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!amount} onClick={() => void submit()}>
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
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
