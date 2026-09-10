import { PromotionScope, PromotionType, t } from '@jecks/shared';
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
  PageHeader,
  Select,
  Skeleton,
  SwitchField,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Plus, Save, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api';
import { formatDa, message } from '@/lib/errors';
import { useCategoryTree, useCollections } from '@/features/catalog/queries';
import { flattenTree } from '@/features/catalog/tree';
import * as promotions from './api';
import type { PromotionDetail } from './api';
import {
  PROMOTION_SCOPE_LABELS,
  PROMOTION_STATE_LABELS,
  PROMOTION_STATE_TONES,
  PROMOTION_TYPE_HINTS,
  PROMOTION_TYPE_LABELS,
} from './labels';
import { SimulatorPanel } from './SimulatorPanel';

/**
 * The promotion editor — PRD F-AD-20/21.
 *
 * The form only shows the fields the chosen type actually uses: a percentage promotion
 * has no bundle price, and offering one invites a value that silently does nothing.
 *
 * The simulator beside it runs the live engine, so an owner sees what a shopper would
 * get before the promotion is ever public.
 */

interface FormState {
  name: string;
  description: string;
  type: PromotionType;
  scope: PromotionScope;
  code: string;
  percentOff: string;
  amountOffMinor: bigint | null;
  bundlePriceMinor: bigint | null;
  buyQuantity: string;
  getQuantity: string;
  getDiscountPercent: string;
  tiers: Array<{ minSubtotalMinor: bigint | null; percentOff: string }>;
  minSubtotalMinor: bigint | null;
  minQuantity: string;
  firstOrderOnly: boolean;
  wilayaCodes: string[];
  productIds: string[];
  collectionIds: string[];
  categoryIds: string[];
  usageLimitTotal: string;
  usageLimitPerCustomer: string;
  stackable: boolean;
  priority: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  showCountdown: boolean;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  type: PromotionType.PERCENTAGE,
  scope: PromotionScope.ORDER,
  code: '',
  percentOff: '10',
  amountOffMinor: null,
  bundlePriceMinor: null,
  buyQuantity: '2',
  getQuantity: '1',
  getDiscountPercent: '100',
  tiers: [{ minSubtotalMinor: null, percentOff: '5' }],
  minSubtotalMinor: null,
  minQuantity: '',
  firstOrderOnly: false,
  wilayaCodes: [],
  productIds: [],
  collectionIds: [],
  categoryIds: [],
  usageLimitTotal: '',
  usageLimitPerCustomer: '',
  stackable: false,
  priority: '100',
  startsAt: '',
  endsAt: '',
  active: true,
  showCountdown: false,
};

export function PromotionEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const collections = useCollections();
  const categories = useCategoryTree();

  const query = useQuery({
    queryKey: ['admin', 'promotion', id],
    queryFn: () => promotions.getPromotion(id!),
    enabled: Boolean(id) && !isNew,
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);
  const [codesOpen, setCodesOpen] = useState(false);

  const loaded = query.data;
  if (!isNew && loaded && seeded !== loaded.id) {
    setSeeded(loaded.id);
    setForm(fromDetail(loaded));
  }

  const patch = (values: Partial<FormState>) => setForm((current) => ({ ...current, ...values }));

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const payload = toPayload(form);
      const saved = isNew
        ? await promotions.createPromotion(payload)
        : await promotions.updatePromotion(id!, payload);
      notify.success(isNew ? 'Promotion créée' : 'Promotion mise à jour');
      navigate(`/promotions/${saved.id}`, { replace: true });
      setSeeded(null);
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  if (!isNew && query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!isNew && query.error) {
    return (
      <EmptyState
        title="Promotion introuvable"
        description={(query.error as Error).message}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/promotions')}>
            Retour aux promotions
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Retour"
              onClick={() => navigate('/promotions')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {isNew ? 'Nouvelle promotion' : (loaded?.name ?? '')}
            {loaded ? (
              <Badge tone={PROMOTION_STATE_TONES[loaded.state] ?? 'neutral'}>
                {PROMOTION_STATE_LABELS[loaded.state] ?? loaded.state}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            {loaded && !loaded.code ? (
              <Button variant="outline" size="sm" onClick={() => setCodesOpen(true)}>
                <Wand2 className="h-4 w-4" />
                Générer des codes
              </Button>
            ) : null}
            <Button size="sm" loading={busy} disabled={!form.name.trim()} onClick={() => void save()}>
              <Save className="h-4 w-4" />
              Enregistrer
            </Button>
          </>
        }
      />

      {loaded ? <PerformanceStrip id={loaded.id} /> : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_400px] xl:items-start">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>L’essentiel</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <Field label="Nom" required error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  placeholder="Bienvenue -10 %"
                />
              </Field>

              <Field label="Description interne" error={errors.description}>
                <Textarea
                  rows={2}
                  value={form.description}
                  onChange={(event) => patch({ description: event.target.value })}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type" hint={PROMOTION_TYPE_HINTS[form.type]}>
                  <Select
                    value={form.type}
                    onValueChange={(value) => patch({ type: value as PromotionType })}
                    options={Object.values(PromotionType).map((type) => ({
                      value: type,
                      label: PROMOTION_TYPE_LABELS[type] ?? type,
                    }))}
                  />
                </Field>

                <Field label="Portée">
                  <Select
                    value={form.scope}
                    onValueChange={(value) => patch({ scope: value as PromotionScope })}
                    options={Object.values(PromotionScope).map((scope) => ({
                      value: scope,
                      label: PROMOTION_SCOPE_LABELS[scope] ?? scope,
                    }))}
                  />
                </Field>
              </div>

              <Field
                label="Code"
                hint="Laissez vide pour une remise automatique, appliquée sans code."
                error={errors.code}
              >
                <Input
                  value={form.code}
                  onChange={(event) =>
                    patch({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })
                  }
                  placeholder="BIENVENUE10"
                  className="font-mono"
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>La remise</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <ValueFields form={form} patch={patch} errors={errors} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conditions</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Montant minimum du panier">
                  <MoneyInput
                    value={form.minSubtotalMinor ?? ''}
                    onValueChange={(value) => patch({ minSubtotalMinor: value })}
                  />
                </Field>
                <Field label="Quantité minimum">
                  <Input
                    type="number"
                    min={1}
                    value={form.minQuantity}
                    onChange={(event) => patch({ minQuantity: event.target.value })}
                  />
                </Field>
              </div>

              <Field
                label="Collections concernées"
                hint="Vide = toute la boutique. Le minimum se mesure alors sur les seules lignes concernées."
              >
                <MultiSelect
                  options={(collections.data ?? []).map((collection) => ({
                    value: collection.id,
                    label: t(collection.name, 'fr'),
                  }))}
                  values={form.collectionIds}
                  onValuesChange={(values) => patch({ collectionIds: values })}
                  placeholder="Toutes"
                />
              </Field>

              <Field label="Catégories concernées">
                <MultiSelect
                  options={flattenTree(categories.data ?? []).map((node) => ({
                    value: node.id,
                    label: `${'— '.repeat(node.depth)}${t(node.name, 'fr')}`,
                  }))}
                  values={form.categoryIds}
                  onValuesChange={(values) => patch({ categoryIds: values })}
                  placeholder="Toutes"
                />
              </Field>

              <Field label="Wilayas" hint="Vide = les 58 wilayas.">
                <MultiSelect
                  options={Array.from({ length: 58 }, (_, index) => ({
                    value: String(index + 1),
                    label: String(index + 1).padStart(2, '0'),
                  }))}
                  values={form.wilayaCodes}
                  onValuesChange={(values) => patch({ wilayaCodes: values })}
                  placeholder="Toutes"
                />
              </Field>

              <SwitchField
                label="Première commande seulement"
                description="Réservée aux clients qui n’ont encore rien reçu."
                checked={form.firstOrderOnly}
                onCheckedChange={(checked) => patch({ firstOrderOnly: checked })}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Limites et priorité</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Utilisations maximum" hint="Toutes commandes confondues">
                  <Input
                    type="number"
                    min={1}
                    value={form.usageLimitTotal}
                    onChange={(event) => patch({ usageLimitTotal: event.target.value })}
                    placeholder="illimité"
                  />
                </Field>
                <Field label="Par client">
                  <Input
                    type="number"
                    min={1}
                    value={form.usageLimitPerCustomer}
                    onChange={(event) => patch({ usageLimitPerCustomer: event.target.value })}
                    placeholder="illimité"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Début">
                  <Input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(event) => patch({ startsAt: event.target.value })}
                  />
                </Field>
                <Field label="Fin">
                  <Input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(event) => patch({ endsAt: event.target.value })}
                  />
                </Field>
              </div>

              <Field
                label="Priorité"
                hint="La plus haute s’applique en premier. À égalité, la plus avantageuse gagne."
              >
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  className="max-w-[140px]"
                  value={form.priority}
                  onChange={(event) => patch({ priority: event.target.value })}
                />
              </Field>

              <SwitchField
                label="Cumulable"
                description="Sinon, cette promotion bloque toutes celles de priorité inférieure."
                checked={form.stackable}
                onCheckedChange={(checked) => patch({ stackable: checked })}
              />

              <SwitchField
                label="Compte à rebours en vitrine"
                description="Affiche le temps restant sur la page d’accueil."
                checked={form.showCountdown}
                onCheckedChange={(checked) => patch({ showCountdown: checked })}
              />

              <SwitchField
                label="Active"
                checked={form.active}
                onCheckedChange={(checked) => patch({ active: checked })}
              />
            </CardBody>
          </Card>
        </div>

        <div className="xl:sticky xl:top-4">
          <SimulatorPanel initialCode={form.code || undefined} />
        </div>
      </div>

      {loaded ? (
        <CodesDialog
          promotion={loaded}
          open={codesOpen}
          onClose={() => setCodesOpen(false)}
          onDone={() => {
            setCodesOpen(false);
            void query.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

// --- the value fields, per type ---------------------------------------------

function ValueFields({
  form,
  patch,
  errors,
}: {
  form: FormState;
  patch: (values: Partial<FormState>) => void;
  errors: Record<string, string>;
}) {
  switch (form.type) {
    case PromotionType.PERCENTAGE:
      return (
        <Field label="Pourcentage de remise" required error={errors.percentOff}>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.5"
              className="max-w-[140px]"
              value={form.percentOff}
              onChange={(event) => patch({ percentOff: event.target.value })}
            />
            <span className="text-sm text-muted">%</span>
          </div>
        </Field>
      );

    case PromotionType.FIXED_AMOUNT:
      return (
        <Field label="Montant retiré" required error={errors.amountOff}>
          <MoneyInput
            value={form.amountOffMinor ?? ''}
            onValueChange={(value) => patch({ amountOffMinor: value })}
          />
        </Field>
      );

    case PromotionType.FREE_SHIPPING:
      return (
        <Alert tone="info" title="Rien à configurer">
          La livraison sera offerte dès que les conditions ci-dessous sont remplies.
        </Alert>
      );

    case PromotionType.BUNDLE_PRICE:
      return (
        <Field
          label="Prix du lot"
          required
          hint="La différence avec le total des articles concernés devient la remise."
          error={errors.bundlePrice}
        >
          <MoneyInput
            value={form.bundlePriceMinor ?? ''}
            onValueChange={(value) => patch({ bundlePriceMinor: value })}
          />
        </Field>
      );

    case PromotionType.BUY_X_GET_Y:
      return (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Acheter" required>
            <Input
              type="number"
              min={1}
              value={form.buyQuantity}
              onChange={(event) => patch({ buyQuantity: event.target.value })}
            />
          </Field>
          <Field label="Offert" required>
            <Input
              type="number"
              min={1}
              value={form.getQuantity}
              onChange={(event) => patch({ getQuantity: event.target.value })}
            />
          </Field>
          <Field label="Remise sur l’offert" hint="100 % = gratuit">
            <Input
              type="number"
              min={0}
              max={100}
              value={form.getDiscountPercent}
              onChange={(event) => patch({ getDiscountPercent: event.target.value })}
            />
          </Field>
        </div>
      );

    case PromotionType.TIERED:
      return (
        <div className="flex flex-col gap-3">
          {form.tiers.map((tier, index) => (
            <div key={index} className="flex items-end gap-2">
              <Field label={index === 0 ? 'À partir de' : ''} className="flex-1">
                <MoneyInput
                  value={tier.minSubtotalMinor ?? ''}
                  onValueChange={(value) =>
                    patch({
                      tiers: form.tiers.map((entry, position) =>
                        position === index ? { ...entry, minSubtotalMinor: value } : entry,
                      ),
                    })
                  }
                />
              </Field>
              <Field label={index === 0 ? 'Remise' : ''} className="w-32">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={tier.percentOff}
                  onChange={(event) =>
                    patch({
                      tiers: form.tiers.map((entry, position) =>
                        position === index ? { ...entry, percentOff: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Retirer ce palier"
                disabled={form.tiers.length === 1}
                onClick={() =>
                  patch({ tiers: form.tiers.filter((_, position) => position !== index) })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              patch({ tiers: [...form.tiers, { minSubtotalMinor: null, percentOff: '10' }] })
            }
          >
            <Plus className="h-4 w-4" />
            Ajouter un palier
          </Button>
        </div>
      );

    default:
      return null;
  }
}

// --- performance ------------------------------------------------------------

function PerformanceStrip({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['admin', 'promotion', id, 'performance'],
    queryFn: () => promotions.getPerformance(id),
    staleTime: 60_000,
  });

  const data = query.data;
  if (!data || data.uses === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Tile label="Utilisations" value={String(data.uses)} hint={`${data.customers} client(s)`} />
      <Tile label="Commandes livrées" value={String(data.deliveredUses)} />
      <Tile label="Remise accordée" value={formatDa(data.grantedMinor)} />
      <Tile label="Chiffre d’affaires" value={formatDa(data.revenueMinor)} hint="livré uniquement" />
      <Tile
        label="Marge nette"
        value={formatDa(data.marginMinor)}
        tone={BigInt(data.marginMinor) >= 0n ? 'success' : 'danger'}
      />
    </div>
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

// --- bulk codes -------------------------------------------------------------

function CodesDialog({
  promotion,
  open,
  onClose,
  onDone,
}: {
  promotion: PromotionDetail;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [count, setCount] = useState('100');
  const [prefix, setPrefix] = useState('');
  const [length, setLength] = useState('8');
  const [usageLimitPerCode, setUsageLimitPerCode] = useState('1');
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<string[] | null>(null);

  async function submit() {
    setBusy(true);
    try {
      const result = await promotions.generateCodes(promotion.id, {
        promotionId: promotion.id,
        count: Number(count),
        prefix,
        length: Number(length),
        usageLimitPerCode: Number(usageLimitPerCode),
      });
      setGenerated(result.codes);
      notify.success(`${result.created} code(s) générés`);
      onDone();
    } catch (error) {
      notify.error(message(error, 'La génération a échoué'));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([(generated ?? []).join('\n')], { type: 'text/plain;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `codes-${promotion.name.toLowerCase().replace(/\s+/g, '-')}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Générer des codes uniques</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {generated ? (
            <>
              <Alert tone="success" title={`${generated.length} codes prêts`}>
                Chacun est utilisable {usageLimitPerCode} fois. Téléchargez-les maintenant : ils ne
                seront plus regroupés ailleurs.
              </Alert>
              <pre className="max-h-48 overflow-auto rounded-sm bg-elevated p-3 font-mono text-xs">
                {generated.slice(0, 40).join('\n')}
                {generated.length > 40 ? `\n… et ${generated.length - 40} autres` : ''}
              </pre>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Combien">
                  <Input
                    type="number"
                    min={1}
                    max={5000}
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                  />
                </Field>
                <Field label="Utilisations par code">
                  <Input
                    type="number"
                    min={1}
                    value={usageLimitPerCode}
                    onChange={(event) => setUsageLimitPerCode(event.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Préfixe" hint="Majuscules et chiffres">
                  <Input
                    value={prefix}
                    onChange={(event) =>
                      setPrefix(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="INSTA"
                    className="font-mono"
                  />
                </Field>
                <Field label="Longueur" hint="Sans le préfixe">
                  <Input
                    type="number"
                    min={4}
                    max={16}
                    value={length}
                    onChange={(event) => setLength(event.target.value)}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted">
                Les codes n’utilisent ni 0/O ni 1/I : ils sont lus sur un écran et tapés à la main.
              </p>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          {generated ? (
            <Button onClick={download}>
              <Download className="h-4 w-4" />
              Télécharger
            </Button>
          ) : (
            <Button loading={busy} onClick={() => void submit()}>
              <Wand2 className="h-4 w-4" />
              Générer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- shape conversion -------------------------------------------------------

function fromDetail(detail: PromotionDetail): FormState {
  return {
    name: detail.name,
    description: detail.description ?? '',
    type: detail.type as PromotionType,
    scope: detail.scope as PromotionScope,
    code: detail.code ?? '',
    percentOff: detail.percentOff === null ? '' : String(detail.percentOff),
    amountOffMinor: detail.amountOffMinor ? BigInt(detail.amountOffMinor) : null,
    bundlePriceMinor: detail.bundlePriceMinor ? BigInt(detail.bundlePriceMinor) : null,
    buyQuantity: String(detail.buyXGetY?.buyQuantity ?? 2),
    getQuantity: String(detail.buyXGetY?.getQuantity ?? 1),
    getDiscountPercent: String(detail.buyXGetY?.getDiscountPercent ?? 100),
    tiers:
      detail.tiers.length > 0
        ? detail.tiers.map((tier) => ({
            minSubtotalMinor: BigInt(tier.minSubtotalMinor),
            percentOff: String(tier.percentOff),
          }))
        : [{ minSubtotalMinor: null, percentOff: '5' }],
    minSubtotalMinor: detail.minSubtotalMinor ? BigInt(detail.minSubtotalMinor) : null,
    minQuantity: detail.minQuantity === null ? '' : String(detail.minQuantity),
    firstOrderOnly: detail.firstOrderOnly,
    wilayaCodes: detail.wilayaCodes.map(String),
    productIds: detail.productIds,
    collectionIds: detail.collectionIds,
    categoryIds: detail.categoryIds,
    usageLimitTotal: detail.usageLimitTotal === null ? '' : String(detail.usageLimitTotal),
    usageLimitPerCustomer:
      detail.usageLimitPerCustomer === null ? '' : String(detail.usageLimitPerCustomer),
    stackable: detail.stackable,
    priority: String(detail.priority),
    startsAt: detail.startsAt ? detail.startsAt.slice(0, 16) : '',
    endsAt: detail.endsAt ? detail.endsAt.slice(0, 16) : '',
    active: detail.active,
    showCountdown: detail.showCountdown,
  };
}

/**
 * Sends only the fields the chosen type uses.
 *
 * The API's schema requires exactly one value per type, so sending a stale bundle price
 * alongside a percentage would fail validation for a field the owner never saw.
 */
function toPayload(form: FormState): Record<string, unknown> {
  const number = (value: string) => (value.trim() === '' ? undefined : Number(value));

  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    type: form.type,
    scope: form.scope,
    code: form.code.trim() || null,

    percentOff: form.type === PromotionType.PERCENTAGE ? Number(form.percentOff) : undefined,
    amountOff:
      form.type === PromotionType.FIXED_AMOUNT
        ? (form.amountOffMinor ?? 0n).toString()
        : undefined,
    bundlePrice:
      form.type === PromotionType.BUNDLE_PRICE
        ? (form.bundlePriceMinor ?? 0n).toString()
        : undefined,
    buyXGetY:
      form.type === PromotionType.BUY_X_GET_Y
        ? {
            buyQuantity: Number(form.buyQuantity),
            getQuantity: Number(form.getQuantity),
            getDiscountPercent: Number(form.getDiscountPercent),
          }
        : undefined,
    tiers:
      form.type === PromotionType.TIERED
        ? form.tiers.map((tier) => ({
            minSubtotal: (tier.minSubtotalMinor ?? 0n).toString(),
            percentOff: Number(tier.percentOff),
          }))
        : [],

    conditions: {
      minSubtotal: form.minSubtotalMinor ? form.minSubtotalMinor.toString() : undefined,
      minQuantity: number(form.minQuantity),
      productIds: form.productIds,
      variantIds: [],
      collectionIds: form.collectionIds,
      categoryIds: form.categoryIds,
      customerGroupIds: [],
      wilayaCodes: form.wilayaCodes.map(Number),
      firstOrderOnly: form.firstOrderOnly,
    },

    usageLimitTotal: number(form.usageLimitTotal) ?? null,
    usageLimitPerCustomer: number(form.usageLimitPerCustomer) ?? null,
    stackable: form.stackable,
    priority: Number(form.priority),
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    active: form.active,
    showCountdown: form.showCountdown,
  };
}
