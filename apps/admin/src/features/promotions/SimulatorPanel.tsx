import { t } from '@jecks/shared';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Combobox,
  Field,
  Input,
  MoneyInput,
  Select,
  cn,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Minus, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { formatDa, message } from '@/lib/errors';
import * as promotions from './api';
import type { SimulationResult } from './api';
import { REJECTION_LABELS } from './labels';

/**
 * The promotion simulator — PRD F-AD-21.
 *
 * It calls the same engine checkout calls, so what it shows is what a shopper would be
 * charged. Nothing here is computed in the browser: a second implementation of the
 * discount rules would eventually disagree with the first one.
 */

interface CartRow {
  variantId: string;
  sku: string;
  label: string;
  unitPriceMinor: string;
  quantity: number;
}

export function SimulatorPanel({
  initialCode,
  className,
}: {
  initialCode?: string;
  className?: string;
}) {
  const [rows, setRows] = useState<CartRow[]>([]);
  const [codes, setCodes] = useState<string>(initialCode ?? '');
  const [wilayaCode, setWilayaCode] = useState<string>('16');
  const [shippingMinor, setShippingMinor] = useState<bigint | null>(50000n);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const variants = useQuery({
    queryKey: ['admin', 'variant-search', search],
    queryFn: () => promotions.searchVariants(search),
    enabled: search.trim().length >= 2,
    staleTime: 30_000,
  });

  function addVariant(variantId: string) {
    const found = (variants.data ?? []).find((variant) => variant.id === variantId);
    if (!found) return;
    setRows((current) => {
      if (current.some((row) => row.variantId === variantId)) {
        return current.map((row) =>
          row.variantId === variantId ? { ...row, quantity: Math.min(99, row.quantity + 1) } : row,
        );
      }
      const suffix = found.variantName ? ` — ${found.variantName}` : '';
      return [
        ...current,
        {
          variantId,
          sku: found.sku,
          label: `${t(found.productName, 'fr')}${suffix}`,
          unitPriceMinor: found.priceMinor,
          quantity: 1,
        },
      ];
    });
    setSearch('');
  }

  function step(variantId: string, delta: number) {
    setRows((current) =>
      current
        .map((row) =>
          row.variantId === variantId
            ? { ...row, quantity: Math.max(0, Math.min(99, row.quantity + delta)) }
            : row,
        )
        .filter((row) => row.quantity > 0),
    );
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await promotions.simulate({
          variantIds: rows.map((row) => ({ variantId: row.variantId, quantity: row.quantity })),
          codes: codes
            .split(/[\s,]+/)
            .map((code) => code.trim().toUpperCase())
            .filter(Boolean)
            .slice(0, 5),
          wilayaCode: wilayaCode ? Number(wilayaCode) : null,
          shippingMinor: (shippingMinor ?? 0n).toString(),
        }),
      );
    } catch (caught) {
      setResult(null);
      setError(message(caught, 'La simulation a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-brass" />
          Simulateur
        </CardTitle>
        {rows.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRows([]);
              setResult(null);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Vider
          </Button>
        ) : null}
      </CardHeader>

      <CardBody className="flex flex-col gap-4">
        <Field label="Ajouter un article" hint="Tapez un SKU ou un nom de produit.">
          <Combobox
            options={(variants.data ?? []).map((variant) => ({
              value: variant.id,
              label: `${variant.sku} — ${t(variant.productName, 'fr')}`,
              description: variant.variantName ?? undefined,
            }))}
            value={null}
            onValueChange={(value) => {
              if (value) addVariant(value);
            }}
            onSearchChange={setSearch}
            loading={variants.isFetching}
            clearable={false}
            placeholder="Rechercher une variante"
            emptyMessage={
              search.trim().length < 2 ? 'Tapez au moins 2 caractères' : 'Aucune variante'
            }
          />
        </Field>

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
            Construisez un panier pour voir la remise que ce réglage accorde.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {rows.map((row) => {
              const line = result?.lines.find((entry) => entry.id === row.variantId);
              const discounted = line ? BigInt(line.discountMinor) : 0n;
              return (
                <li key={row.variantId} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{row.label}</p>
                    <p className="font-mono text-xs text-muted">
                      {row.sku} · {formatDa(row.unitPriceMinor)}
                      {discounted > 0n ? (
                        <span className="ms-1 text-success">−{formatDa(line!.discountMinor)}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Retirer une unité"
                      onClick={() => step(row.variantId, -1)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{row.quantity}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Ajouter une unité"
                      onClick={() => step(row.variantId, 1)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Field label="Codes à tester" hint="Séparés par un espace ou une virgule.">
          <Input
            value={codes}
            onChange={(event) => setCodes(event.target.value.toUpperCase())}
            placeholder="BIENVENUE10"
            className="font-mono"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Wilaya">
            <Select
              value={wilayaCode}
              onValueChange={setWilayaCode}
              options={Array.from({ length: 58 }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1).padStart(2, '0'),
              }))}
            />
          </Field>
          <Field label="Frais de livraison">
            <MoneyInput
              value={shippingMinor ?? ''}
              onValueChange={(value) => setShippingMinor(value)}
            />
          </Field>
        </div>

        <Button loading={busy} disabled={rows.length === 0} onClick={() => void run()}>
          Simuler
        </Button>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {result ? <Outcome result={result} /> : null}
      </CardBody>
    </Card>
  );
}

function Outcome({ result }: { result: SimulationResult }) {
  const freeShipping = result.applied.some((entry) => entry.freeShipping);

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      {result.applied.length === 0 && result.rejected.length === 0 ? (
        <p className="text-sm text-muted">Aucune promotion ne s’applique à ce panier.</p>
      ) : null}

      {result.applied.map((entry) => (
        <div
          key={entry.promotionId}
          className="flex items-center justify-between gap-2 rounded-md bg-success/10 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{entry.name}</p>
            {entry.code ? <p className="font-mono text-xs text-muted">{entry.code}</p> : null}
          </div>
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-success">
            {entry.freeShipping && BigInt(entry.amountMinor) === 0n
              ? 'livraison offerte'
              : `−${formatDa(entry.amountMinor)}`}
          </span>
        </div>
      ))}

      {result.rejected.map((entry, index) => (
        <div
          key={`${entry.code}-${index}`}
          className="flex items-start justify-between gap-2 rounded-md bg-danger/10 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">{entry.code || '—'}</p>
            <p className="text-xs text-muted">{entry.message}</p>
          </div>
          <Badge tone="danger" className="whitespace-nowrap">
            <X className="h-3 w-3" />
            {REJECTION_LABELS[entry.reason as keyof typeof REJECTION_LABELS] ?? entry.reason}
          </Badge>
        </div>
      ))}

      <dl className="flex flex-col gap-1.5 text-sm">
        <TotalRow label="Sous-total" value={formatDa(result.subtotalMinor)} />
        {BigInt(result.discountMinor) > 0n ? (
          <TotalRow label="Remise" value={`−${formatDa(result.discountMinor)}`} tone="success" />
        ) : null}
        <TotalRow
          label="Livraison"
          value={freeShipping ? 'offerte' : formatDa(result.shippingMinor)}
          tone={freeShipping ? 'success' : undefined}
        />
        <TotalRow label="Total" value={formatDa(result.totalMinor)} strong />
      </dl>
    </div>
  );
}

function TotalRow({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'success';
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2',
        strong && 'border-t border-line pt-1.5 text-base font-semibold',
      )}
    >
      <dt className={cn(!strong && 'text-muted')}>{label}</dt>
      <dd className={cn('tabular-nums', tone === 'success' && 'text-success')}>{value}</dd>
    </div>
  );
}
