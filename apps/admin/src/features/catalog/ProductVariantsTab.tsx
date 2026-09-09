import {
  format,
  marginPercent,
  money,
  slugify,
  t,
  type ProductDetail,
  type Translated,
  type VariantDto,
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
  EmptyState,
  Field,
  Input,
  MoneyInput,
  MultiSelect,
  Switch,
  cn,
  notify,
} from '@jecks/ui';
import { CalendarClock, Grid3x3, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import * as catalog from './api';
import { message } from './ProductsListPage';

/**
 * Variants & pricing — PRD F-AD-10.
 *
 * The option builder writes the matrix; the grid edits it. Regenerating never destroys
 * a combination that still applies: an existing variant keeps its SKU, price, cost and
 * stock, and one that no longer matches is deactivated rather than deleted, because it
 * may sit on an order from last month.
 *
 * Margin is shown per row and recomputed as you type, from `@jecks/shared/money` — the
 * same function the P&L will use, so the number on this screen and the number in the
 * report can never disagree.
 */

interface EditableVariant {
  id?: string;
  sku: string;
  barcode: string;
  price: bigint;
  compareAtPrice: bigint | null;
  costPrice: bigint;
  weightGrams: number;
  optionValueIds: string[];
  mediaIds: string[];
  active: boolean;
  stock: number;
}

export function ProductVariantsTab({
  product,
  onSaved,
}: {
  product: ProductDetail;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<EditableVariant[]>(() => product.variants.map(toEditable));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // A regenerate or an external save replaces the grid; local edits are only kept while
  // the server copy has not moved under them.
  useEffect(() => {
    setRows(product.variants.map(toEditable));
    setDirty(false);
  }, [product.variants]);

  const optionValueNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const option of product.options) {
      for (const value of option.values) names.set(value.id, t(value.name, 'fr'));
    }
    return names;
  }, [product.options]);

  function patchRow(index: number, changes: Partial<EditableVariant>) {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...changes } : row)),
    );
    setDirty(true);
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        sku: `${product.slug.toUpperCase()}-${current.length + 1}`,
        barcode: '',
        price: current[0]?.price ?? 0n,
        compareAtPrice: null,
        costPrice: current[0]?.costPrice ?? 0n,
        weightGrams: current[0]?.weightGrams ?? 0,
        optionValueIds: [],
        mediaIds: [],
        active: true,
        stock: 0,
      },
    ]);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await catalog.saveVariants(
        product.id,
        rows.map((row, position) => ({
          ...(row.id ? { id: row.id } : {}),
          sku: row.sku.trim(),
          ...(row.barcode.trim() ? { barcode: row.barcode.trim() } : {}),
          price: row.price.toString(),
          ...(row.compareAtPrice === null ? {} : { compareAtPrice: row.compareAtPrice.toString() }),
          costPrice: row.costPrice.toString(),
          weightGrams: row.weightGrams,
          optionValueIds: row.optionValueIds,
          mediaIds: row.mediaIds,
          position,
          active: row.active,
        })),
      );
      notify.success('Variantes enregistrées');
      setDirty(false);
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'enregistrement des variantes a échoué"));
    } finally {
      setSaving(false);
    }
  }

  const pending = product.priceSchedules.filter((schedule) => !schedule.appliedAt);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setBuilderOpen(true)}>
          <Grid3x3 className="h-4 w-4" />
          {product.options.length > 0 ? 'Modifier les options' : 'Générer les variantes'}
        </Button>
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" />
          Ajouter une variante
        </Button>
        <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
          <CalendarClock className="h-4 w-4" />
          Programmer un prix
        </Button>
        <Button
          size="sm"
          className="ms-auto"
          loading={saving}
          disabled={!dirty}
          onClick={() => void save()}
        >
          <Save className="h-4 w-4" />
          Enregistrer les variantes
        </Button>
      </div>

      {product.options.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {product.options.map((option) => (
            <span key={option.id} className="rounded-xs border border-line px-2 py-1">
              <span className="text-ink">{t(option.name, 'fr')}</span>
              <span className="ms-1.5">{option.values.length} valeurs</span>
            </span>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Aucune variante"
          description="Un produit a besoin d’au moins une variante pour être vendable."
          action={
            <Button size="sm" onClick={addRow}>
              <Plus className="h-4 w-4" />
              Ajouter une variante
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xs border border-line">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-base text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 text-start">Variante</th>
                <th className="px-3 py-2 text-start">SKU</th>
                <th className="px-3 py-2 text-end">Prix</th>
                <th className="px-3 py-2 text-end">Barré</th>
                <th className="px-3 py-2 text-end">Revient</th>
                <th className="px-3 py-2 text-end">Marge</th>
                <th className="px-3 py-2 text-end">Poids (g)</th>
                <th className="px-3 py-2 text-end">Stock</th>
                <th className="px-3 py-2 text-center">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <VariantRow
                  key={row.id ?? `new-${index}`}
                  row={row}
                  optionValueNames={optionValueNames}
                  onChange={(changes) => patchRow(index, changes)}
                  onRemove={() => {
                    setRows((current) => current.filter((_, position) => position !== index));
                    setDirty(true);
                  }}
                  canRemove={rows.length > 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Changements de prix programmés</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {pending.map((schedule) => (
              <div
                key={schedule.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xs border border-line px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{schedule.sku}</span> passe à{' '}
                  <span className="tabular-nums">{format(money(BigInt(schedule.price)))}</span> le{' '}
                  {new Date(schedule.startsAt).toLocaleString('fr-DZ')}
                  {schedule.endsAt
                    ? `, jusqu’au ${new Date(schedule.endsAt).toLocaleString('fr-DZ')}`
                    : ''}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await catalog.cancelPriceSchedule(product.id, schedule.id);
                      notify.success('Programmation annulée');
                      onSaved();
                    } catch (error) {
                      notify.error(message(error, "L'annulation a échoué"));
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  Annuler
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <OptionBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        product={product}
        onDone={onSaved}
      />

      <SchedulePriceDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        product={product}
        onDone={onSaved}
      />
    </div>
  );
}

// --- grid row ---------------------------------------------------------------

function VariantRow({
  row,
  optionValueNames,
  onChange,
  onRemove,
  canRemove,
}: {
  row: EditableVariant;
  optionValueNames: Map<string, string>;
  onChange: (changes: Partial<EditableVariant>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const margin = marginPercent(money(row.price), money(row.costPrice));
  const label =
    row.optionValueIds
      .map((id) => optionValueNames.get(id) ?? '')
      .filter(Boolean)
      .join(' / ') || 'Variante par défaut';

  return (
    <tr className={cn('border-t border-line', !row.active && 'opacity-60')}>
      <td className="px-3 py-2">
        <span className="whitespace-nowrap">{label}</span>
      </td>
      <td className="px-3 py-2">
        <Input
          className="h-9 w-44"
          value={row.sku}
          onChange={(event) => onChange({ sku: event.target.value.toUpperCase() })}
          aria-label={`SKU de ${label}`}
        />
      </td>
      <td className="px-3 py-2">
        <MoneyInput
          className="w-32"
          value={row.price}
          onValueChange={(value) => onChange({ price: value ?? 0n })}
          aria-label={`Prix de ${label}`}
        />
      </td>
      <td className="px-3 py-2">
        <MoneyInput
          className="w-32"
          value={row.compareAtPrice}
          onValueChange={(value) => onChange({ compareAtPrice: value })}
          aria-label={`Prix barré de ${label}`}
        />
      </td>
      <td className="px-3 py-2">
        <MoneyInput
          className="w-32"
          value={row.costPrice}
          onValueChange={(value) => onChange({ costPrice: value ?? 0n })}
          aria-label={`Prix de revient de ${label}`}
        />
      </td>
      <td className="px-3 py-2 text-end">
        <MarginBadge margin={margin} />
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          min={0}
          className="h-9 w-24 text-end"
          value={row.weightGrams}
          onChange={(event) =>
            onChange({ weightGrams: Math.max(0, Number(event.target.value) || 0) })
          }
          aria-label={`Poids de ${label}`}
        />
      </td>
      <td className="px-3 py-2 text-end tabular-nums text-muted">{row.id ? row.stock : '—'}</td>
      <td className="px-3 py-2 text-center">
        <Switch
          checked={row.active}
          onCheckedChange={(active) => onChange({ active })}
          aria-label={`Activer ${label}`}
        />
      </td>
      <td className="px-3 py-2 text-end">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label={`Retirer ${label}`}
          title={canRemove ? undefined : 'Un produit garde au moins une variante'}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function MarginBadge({ margin }: { margin: number | null }) {
  if (margin === null) return <span className="text-xs text-muted">—</span>;
  const tone = margin < 0 ? 'danger' : margin < 20 ? 'warning' : 'success';
  return <Badge tone={tone}>{margin.toFixed(1)} %</Badge>;
}

// --- option builder ---------------------------------------------------------

interface OptionDraft {
  name: Translated;
  values: Array<{ name: Translated; swatchHex?: string }>;
}

function OptionBuilderDialog({
  open,
  onOpenChange,
  product,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDetail;
  onDone: () => void;
}) {
  const [options, setOptions] = useState<OptionDraft[]>(() => toDrafts(product));
  const [skuPrefix, setSkuPrefix] = useState(
    () => slugify(product.slug).toUpperCase().slice(0, 24) || 'SKU',
  );
  const [price, setPrice] = useState<bigint>(() =>
    product.variants[0] ? BigInt(product.variants[0].price) : 0n,
  );
  const [costPrice, setCostPrice] = useState<bigint>(() =>
    product.variants[0] ? BigInt(product.variants[0].costPrice) : 0n,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setOptions(toDrafts(product));
  }, [open, product]);

  const combinations = options.reduce(
    (total, option) => total * Math.max(option.values.filter((value) => value.name.fr).length, 0),
    options.length > 0 ? 1 : 0,
  );

  function setOption(index: number, changes: Partial<OptionDraft>) {
    setOptions((current) =>
      current.map((option, position) => (position === index ? { ...option, ...changes } : option)),
    );
  }

  async function generate() {
    setSaving(true);
    try {
      await catalog.generateVariants(product.id, {
        skuPrefix,
        price: price.toString(),
        costPrice: costPrice.toString(),
        weightGrams: product.variants[0]?.weightGrams ?? 0,
        options: options.map((option, index) => ({
          name: {
            fr: option.name.fr ?? '',
            ...(option.name.ar ? { ar: option.name.ar } : {}),
            ...(option.name.en ? { en: option.name.en } : {}),
          },
          position: index,
          values: option.values
            .filter((value) => (value.name.fr ?? '').trim() !== '')
            .map((value, valueIndex) => ({
              name: { fr: value.name.fr ?? '' },
              ...(value.swatchHex ? { swatchHex: value.swatchHex } : {}),
              position: valueIndex,
            })),
        })),
      });
      notify.success(`${combinations} variantes générées`);
      onOpenChange(false);
      onDone();
    } catch (error) {
      notify.error(message(error, 'La génération a échoué'));
    } finally {
      setSaving(false);
    }
  }

  const valid =
    options.length > 0 &&
    options.every(
      (option) =>
        (option.name.fr ?? '').trim() !== '' &&
        option.values.some((value) => (value.name.fr ?? '').trim() !== ''),
    ) &&
    combinations > 0 &&
    combinations <= 300;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Options et variantes</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          <Alert tone="info" title="Ce qui est préservé">
            Une combinaison déjà existante garde son SKU, son prix, son coût et son stock. Une
            combinaison qui disparaît est désactivée, jamais supprimée : elle peut figurer sur une
            commande passée.
          </Alert>

          {options.map((option, index) => (
            <div key={index} className="rounded-xs border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <Field label={`Option ${index + 1}`} className="flex-1">
                  <Input
                    value={option.name.fr ?? ''}
                    onChange={(event) => setOption(index, { name: { fr: event.target.value } })}
                    placeholder="Couleur"
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-6"
                  onClick={() =>
                    setOptions((current) => current.filter((_, position) => position !== index))
                  }
                  aria-label={`Supprimer l’option ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <Field
                label="Valeurs"
                hint="Séparez par des virgules. Ex. : Noir, Blanc, Bleu marine"
                className="mt-3"
              >
                <Input
                  value={option.values.map((value) => value.name.fr ?? '').join(', ')}
                  onChange={(event) =>
                    setOption(index, {
                      values: event.target.value
                        .split(',')
                        .map((piece) => ({ name: { fr: piece.trim() } }))
                        .filter((value) => value.name.fr !== ''),
                    })
                  }
                  placeholder="Noir, Blanc, Bleu marine"
                />
              </Field>
            </div>
          ))}

          {options.length < 3 ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setOptions((current) => [...current, { name: { fr: '' }, values: [] }])
              }
            >
              <Plus className="h-4 w-4" />
              Ajouter une option
            </Button>
          ) : (
            <p className="text-sm text-muted">Trois options au maximum.</p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Préfixe SKU" hint="Les valeurs d’options sont ajoutées derrière.">
              <Input
                value={skuPrefix}
                onChange={(event) => setSkuPrefix(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Prix des nouvelles variantes">
              <MoneyInput value={price} onValueChange={(value) => setPrice(value ?? 0n)} />
            </Field>
            <Field label="Prix de revient">
              <MoneyInput value={costPrice} onValueChange={(value) => setCostPrice(value ?? 0n)} />
            </Field>
          </div>

          <p className={cn('text-sm', combinations > 300 ? 'text-danger' : 'text-muted')}>
            {combinations} combinaison{combinations > 1 ? 's' : ''}
            {combinations > 300 ? ' — au-delà de 300, découpez le produit.' : '.'}
          </p>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button loading={saving} disabled={!valid} onClick={() => void generate()}>
            Générer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- scheduled prices -------------------------------------------------------

function SchedulePriceDialog({
  open,
  onOpenChange,
  product,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDetail;
  onDone: () => void;
}) {
  const [variantIds, setVariantIds] = useState<string[]>([]);
  const [price, setPrice] = useState<bigint>(0n);
  const [compareAtPrice, setCompareAtPrice] = useState<bigint | null>(null);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await catalog.schedulePrice(product.id, {
        variantIds,
        price: price.toString(),
        ...(compareAtPrice === null ? {} : { compareAtPrice: compareAtPrice.toString() }),
        startsAt: new Date(startsAt).toISOString(),
        ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
      });
      notify.success('Changement de prix programmé');
      onOpenChange(false);
      onDone();
    } catch (error) {
      notify.error(message(error, 'La programmation a échoué'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Programmer un prix</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Le prix change tout seul à la date de début. Avec une date de fin, il revient
            automatiquement à sa valeur actuelle — de quoi lancer une vente flash sans veiller.
          </p>

          <Field label="Variantes" required>
            <MultiSelect
              options={product.variants.map((variant) => ({
                value: variant.id,
                label: `${variant.sku} — ${format(money(BigInt(variant.price)))}`,
              }))}
              values={variantIds}
              onValuesChange={setVariantIds}
              placeholder="Choisir les variantes"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nouveau prix" required>
              <MoneyInput value={price} onValueChange={(value) => setPrice(value ?? 0n)} />
            </Field>
            <Field label="Prix barré">
              <MoneyInput value={compareAtPrice} onValueChange={setCompareAtPrice} />
            </Field>
            <Field label="Début" required>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </Field>
            <Field label="Fin" hint="Vide = définitif.">
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            loading={saving}
            disabled={variantIds.length === 0 || !startsAt}
            onClick={() => void submit()}
          >
            Programmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- mapping ----------------------------------------------------------------

function toEditable(variant: VariantDto): EditableVariant {
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode ?? '',
    price: BigInt(variant.price),
    compareAtPrice: variant.compareAtPrice === null ? null : BigInt(variant.compareAtPrice),
    costPrice: BigInt(variant.costPrice),
    weightGrams: variant.weightGrams,
    optionValueIds: variant.optionValueIds,
    mediaIds: variant.mediaIds,
    active: variant.active,
    stock: variant.stock,
  };
}

function toDrafts(product: ProductDetail): OptionDraft[] {
  if (product.options.length === 0) {
    return [{ name: { fr: 'Couleur' }, values: [] }];
  }
  return product.options.map((option) => ({
    name: option.name,
    values: option.values.map((value) => ({
      name: value.name,
      ...(value.swatchHex ? { swatchHex: value.swatchHex } : {}),
    })),
  }));
}
