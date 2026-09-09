import {
  CollectionRuleField,
  RULE_OPERATORS_BY_FIELD,
  RuleOperator,
  format,
  money,
  slugify,
  t,
  type CollectionRule,
  type MerchandisingItem,
  type ProductRow,
  type Translated,
} from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Combobox,
  EmptyState,
  Field,
  Input,
  MultiSelect,
  PageHeader,
  Select,
  Skeleton,
  SwitchField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TranslatedInput,
  cn,
  notify,
} from '@jecks/ui';
import {
  ArrowLeft,
  EyeOff,
  GripVertical,
  ImageOff,
  ImagePlus,
  Loader2,
  Pin,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { previewUrl } from '@/lib/media';
import * as catalog from './api';
import { MediaPickerDialog } from './MediaPickerDialog';
import { message } from './ProductsListPage';
import {
  useBrands,
  useCatalogInvalidate,
  useCategoryTree,
  useCollection,
  useCollectionMembers,
  useTags,
} from './queries';
import { flattenTree } from './tree';

/**
 * Collection editor with the smart-rule builder — PRD F-AD-11 and F-AD-13.
 *
 * The preview under the builder calls the same rule translator the storefront calls, so
 * the products shown here are exactly the products shoppers will get. It runs against
 * unsaved rules, which is the whole point: an operator should see what a rule does
 * before committing to it, not after.
 */

const FIELD_LABELS: Record<string, string> = {
  TAG: 'Étiquette',
  CATEGORY: 'Catégorie',
  BRAND: 'Marque',
  PRICE: 'Prix',
  DISCOUNT: 'En promotion',
  STOCK: 'Stock',
  CREATED_AT: 'Date de publication',
  TITLE: 'Nom du produit',
};

const OPERATOR_LABELS: Record<string, string> = {
  EQUALS: 'est',
  NOT_EQUALS: "n'est pas",
  CONTAINS: 'contient',
  GREATER_THAN: 'supérieur à',
  LESS_THAN: 'inférieur à',
  IN: 'parmi',
};

export function CollectionEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invalidate = useCatalogInvalidate();
  const { data: collection, isLoading, error, refetch } = useCollection(id);

  const [name, setName] = useState<Translated>({});
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState<Translated>({});
  const [seoTitle, setSeoTitle] = useState<Translated>({});
  const [seoDescription, setSeoDescription] = useState<Translated>({});
  const [isSmart, setIsSmart] = useState(false);
  const [matchAll, setMatchAll] = useState(true);
  const [rules, setRules] = useState<CollectionRule[]>([]);
  const [published, setPublished] = useState(true);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!collection || seeded) return;
    setName(collection.name);
    setSlug(collection.slug);
    setDescription(collection.description ?? {});
    setSeoTitle(collection.seoTitle ?? {});
    setSeoDescription(collection.seoDescription ?? {});
    setIsSmart(collection.isSmart);
    setMatchAll(collection.matchAll);
    setRules(
      collection.rules.map((rule) => ({
        field: rule.field as CollectionRule['field'],
        operator: rule.operator as CollectionRule['operator'],
        value: rule.value,
      })),
    );
    setPublished(collection.published);
    setMediaId(collection.mediaId);
    setMediaUrl(collection.mediaUrl);
    setSeeded(true);
  }, [collection, seeded]);

  useEffect(() => {
    setSeeded(false);
    setDirty(false);
  }, [id]);

  const touch = useCallback(() => setDirty(true), []);

  async function save() {
    setSaving(true);
    try {
      await catalog.updateCollection(id, {
        name: clean(name),
        slug,
        description: clean(description),
        seoTitle: clean(seoTitle),
        seoDescription: clean(seoDescription),
        isSmart,
        matchAll,
        rules,
        published,
        mediaId,
      });
      notify.success('Collection enregistrée');
      setDirty(false);
      invalidate();
      void refetch();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !collection) {
    return error ? (
      <Alert tone="danger" title="Collection introuvable">
        {error.message}
      </Alert>
    ) : (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement de la collection" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t(name, 'fr') || 'Collection'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={isSmart ? 'brass' : 'neutral'}>
              {isSmart ? 'Automatique' : 'Manuelle'}
            </Badge>
            {!published ? (
              <Badge tone="neutral">
                <EyeOff className="h-2.5 w-2.5" aria-hidden />
                Masquée
              </Badge>
            ) : null}
            <span className="text-muted">/{slug}</span>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate('/catalog/collections')}>
              <ArrowLeft className="h-4 w-4" />
              Collections
            </Button>
            <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
              <Save className="h-4 w-4" />
              Enregistrer
            </Button>
          </>
        }
      />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">Général</TabsTrigger>
          <TabsTrigger value="products">{isSmart ? 'Règles' : 'Produits'}</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Identité</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-4">
                <Field label="Nom" required>
                  <TranslatedInput
                    value={name}
                    onChange={(value) => {
                      setName(value);
                      touch();
                    }}
                  />
                </Field>
                <Field label="URL" hint={`/collections/${slug}`}>
                  <Input
                    value={slug}
                    onChange={(event) => {
                      setSlug(slugify(event.target.value));
                      touch();
                    }}
                  />
                </Field>
                <Field label="Description">
                  <TranslatedInput
                    value={description}
                    onChange={(value) => {
                      setDescription(value);
                      touch();
                    }}
                    multiline
                    rows={4}
                    requiredLocale=""
                  />
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Affichage</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-4">
                <SwitchField
                  label="Visible sur la boutique"
                  checked={published}
                  onCheckedChange={(value) => {
                    setPublished(value);
                    touch();
                  }}
                />
                <SwitchField
                  label="Collection automatique"
                  description="Remplie par des règles. Les produits ajoutés à la main sont ignorés."
                  checked={isSmart}
                  onCheckedChange={(value) => {
                    setIsSmart(value);
                    if (value && rules.length === 0) {
                      setRules([{ field: 'STOCK', operator: 'GREATER_THAN', value: '0' }]);
                    }
                    touch();
                  }}
                />

                <Field label="Image">
                  <div className="flex items-center gap-3">
                    {mediaUrl ? (
                      <img
                        src={mediaUrl}
                        alt=""
                        className="h-16 w-16 rounded-xs border border-line object-cover"
                      />
                    ) : null}
                    <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                      <ImagePlus className="h-4 w-4" />
                      {mediaId ? 'Changer' : 'Choisir'}
                    </Button>
                    {mediaId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setMediaId(null);
                          setMediaUrl(null);
                          touch();
                        }}
                      >
                        Retirer
                      </Button>
                    ) : null}
                  </div>
                </Field>
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="products">
          {isSmart ? (
            <RuleBuilder
              rules={rules}
              matchAll={matchAll}
              onRulesChange={(next) => {
                setRules(next);
                touch();
              }}
              onMatchAllChange={(next) => {
                setMatchAll(next);
                touch();
              }}
            />
          ) : (
            <ManualMembers collectionId={id} />
          )}
        </TabsContent>

        <TabsContent value="seo">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Référencement</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <Field label="Titre SEO">
                <TranslatedInput
                  value={seoTitle}
                  onChange={(value) => {
                    setSeoTitle(value);
                    touch();
                  }}
                  requiredLocale=""
                />
              </Field>
              <Field label="Description SEO">
                <TranslatedInput
                  value={seoDescription}
                  onChange={(value) => {
                    setSeoDescription(value);
                    touch();
                  }}
                  multiline
                  rows={3}
                  requiredLocale=""
                />
              </Field>
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedIds={mediaId ? [mediaId] : []}
        multiple={false}
        kind="IMAGE"
        onConfirm={(media) => {
          const first = media[0];
          setMediaId(first?.id ?? null);
          setMediaUrl(first ? previewUrl(first, 200) : null);
          touch();
        }}
      />
    </div>
  );
}

// --- rule builder -----------------------------------------------------------

function RuleBuilder({
  rules,
  matchAll,
  onRulesChange,
  onMatchAllChange,
}: {
  rules: CollectionRule[];
  matchAll: boolean;
  onRulesChange: (rules: CollectionRule[]) => void;
  onMatchAllChange: (matchAll: boolean) => void;
}) {
  const [preview, setPreview] = useState<{ total: number; products: ProductRow[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The preview follows the rules as they are edited, debounced so a half-typed price
  // does not produce a stream of failing requests.
  useEffect(() => {
    if (rules.length === 0) {
      setPreview({ total: 0, products: [] });
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await catalog.previewCollection({ rules, matchAll, limit: 12 });
        if (!cancelled) {
          setPreview(result);
          setPreviewError(null);
        }
      } catch (error) {
        if (!cancelled) setPreviewError(message(error, "L'aperçu a échoué"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rules, matchAll]);

  function patch(index: number, changes: Partial<CollectionRule>) {
    onRulesChange(
      rules.map((rule, position) => (position === index ? { ...rule, ...changes } : rule)),
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Règles</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <Field label="Un produit entre dans la collection quand">
            <Select
              value={matchAll ? 'all' : 'any'}
              onValueChange={(value) => onMatchAllChange(value === 'all')}
              options={[
                { value: 'all', label: 'toutes les règles sont vraies' },
                { value: 'any', label: 'au moins une règle est vraie' },
              ]}
            />
          </Field>

          {rules.map((rule, index) => (
            <RuleRow
              key={index}
              rule={rule}
              onChange={(changes) => patch(index, changes)}
              onRemove={() => onRulesChange(rules.filter((_, position) => position !== index))}
              canRemove={rules.length > 1}
            />
          ))}

          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              onRulesChange([...rules, { field: 'TAG', operator: 'EQUALS', value: '' }])
            }
          >
            <Plus className="h-4 w-4" />
            Ajouter une règle
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Aperçu</CardTitle>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Calcul en cours" />
          ) : preview ? (
            <span className="text-sm text-muted">
              {preview.total} produit{preview.total > 1 ? 's' : ''}
            </span>
          ) : null}
        </CardHeader>
        <CardBody>
          {previewError ? (
            <Alert tone="danger" title="Règle invalide">
              {previewError}
            </Alert>
          ) : !preview || preview.products.length === 0 ? (
            <EmptyState
              title="Aucun produit"
              description="Aucun produit publié ne correspond à ces règles pour l’instant."
            />
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {preview.products.map((product) => (
                  <li key={product.id} className="rounded-xs border border-line p-2">
                    {product.thumbnailUrl ? (
                      <img
                        src={product.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="mb-2 aspect-square w-full rounded-xs object-cover"
                      />
                    ) : (
                      <div className="mb-2 flex aspect-square w-full items-center justify-center rounded-xs bg-base">
                        <ImageOff className="h-5 w-5 text-muted" aria-hidden />
                      </div>
                    )}
                    <p className="truncate text-xs">{t(product.name, 'fr')}</p>
                    <p className="truncate text-xs tabular-nums text-muted">
                      {format(money(BigInt(product.minPrice)))}
                    </p>
                  </li>
                ))}
              </ul>
              {preview.total > preview.products.length ? (
                <p className="mt-3 text-sm text-muted">
                  et {preview.total - preview.products.length} autre
                  {preview.total - preview.products.length > 1 ? 's' : ''}.
                </p>
              ) : null}
            </>
          )}

          <p className="mt-4 text-xs text-muted">
            L’aperçu ne compte que les produits publiés et en ligne, comme la boutique.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
  canRemove,
}: {
  rule: CollectionRule;
  onChange: (changes: Partial<CollectionRule>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const tags = useTags();
  const brands = useBrands();
  const categories = useCategoryTree();

  const operators = RULE_OPERATORS_BY_FIELD[rule.field as CollectionRuleField] ?? [];

  const options = useMemo(() => {
    if (rule.field === 'TAG') {
      return (tags.data ?? []).map((tag) => ({ value: tag.slug, label: t(tag.name, 'fr') }));
    }
    if (rule.field === 'BRAND') {
      return (brands.data ?? []).map((brand) => ({ value: brand.slug, label: brand.name }));
    }
    if (rule.field === 'CATEGORY') {
      return flattenTree(categories.data ?? []).map((node) => ({
        value: node.slug,
        label: `${'— '.repeat(node.depth)}${t(node.name, 'fr')}`,
      }));
    }
    return [];
  }, [rule.field, tags.data, brands.data, categories.data]);

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xs border border-line p-3">
      <Field label="Champ" className="min-w-40 flex-1">
        <Select
          value={rule.field}
          onValueChange={(value) => {
            const field = value as CollectionRuleField;
            const allowed = RULE_OPERATORS_BY_FIELD[field] ?? [];
            // Changing the field can strand an operator that no longer applies, so it
            // is reset to the first one that does.
            onChange({
              field,
              operator: (allowed[0] ?? 'EQUALS') as RuleOperator,
              value: field === 'DISCOUNT' ? '0' : '',
            });
          }}
          options={Object.values(CollectionRuleField).map((field) => ({
            value: field,
            label: FIELD_LABELS[field] ?? field,
          }))}
        />
      </Field>

      <Field label="Condition" className="min-w-36 flex-1">
        <Select
          value={rule.operator}
          onValueChange={(value) => onChange({ operator: value as RuleOperator })}
          options={operators.map((operator) => ({
            value: operator,
            label: OPERATOR_LABELS[operator] ?? operator,
          }))}
          disabled={rule.field === 'DISCOUNT'}
        />
      </Field>

      <Field label="Valeur" className="min-w-44 flex-1">
        <RuleValueInput rule={rule} options={options} onChange={onChange} />
      </Field>

      <Button
        variant="ghost"
        size="sm"
        className="mb-1"
        disabled={!canRemove}
        onClick={onRemove}
        aria-label="Supprimer la règle"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function RuleValueInput({
  rule,
  options,
  onChange,
}: {
  rule: CollectionRule;
  options: Array<{ value: string; label: string }>;
  onChange: (changes: Partial<CollectionRule>) => void;
}) {
  if (rule.field === 'DISCOUNT') {
    return <Input value="tout produit en promotion" disabled />;
  }

  if (rule.field === 'PRICE') {
    return (
      <Input
        type="number"
        min={0}
        step="0.01"
        // Prices travel in centimes; operators think in dinars.
        value={rule.value ? String(Number(rule.value) / 100) : ''}
        onChange={(event) =>
          onChange({ value: String(Math.round((Number(event.target.value) || 0) * 100)) })
        }
        placeholder="2900"
      />
    );
  }

  if (rule.field === 'STOCK') {
    return (
      <Input
        type="number"
        min={0}
        value={rule.value}
        onChange={(event) => onChange({ value: event.target.value })}
        placeholder="0"
      />
    );
  }

  if (rule.field === 'CREATED_AT') {
    return (
      <Select
        value={rule.value}
        onValueChange={(value) => onChange({ value })}
        options={[
          { value: '-7d', label: 'les 7 derniers jours' },
          { value: '-30d', label: 'les 30 derniers jours' },
          { value: '-90d', label: 'les 90 derniers jours' },
          { value: '-365d', label: 'la dernière année' },
        ]}
        placeholder="Choisir une période"
      />
    );
  }

  if (rule.operator === 'IN' && options.length > 0) {
    return (
      <MultiSelect
        options={options}
        values={rule.value ? rule.value.split(',').map((piece) => piece.trim()) : []}
        onValuesChange={(values) => onChange({ value: values.join(',') })}
        placeholder="Choisir"
      />
    );
  }

  if (options.length > 0) {
    return (
      <Combobox
        options={options}
        value={rule.value || null}
        onValueChange={(value) => onChange({ value: value ?? '' })}
        placeholder="Choisir"
      />
    );
  }

  return (
    <Input
      value={rule.value}
      onChange={(event) => onChange({ value: event.target.value })}
      placeholder="trucker"
    />
  );
}

// --- manual members ---------------------------------------------------------

function ManualMembers({ collectionId }: { collectionId: string }) {
  const { data, isLoading, refetch } = useCollectionMembers(collectionId);
  const invalidate = useCatalogInvalidate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const members = data ?? [];

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await catalog.searchProducts(query.trim());
        if (!cancelled) setResults(rows);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function add(productIds: string[]) {
    setBusy(true);
    try {
      await catalog.addCollectionProducts(collectionId, productIds);
      notify.success('Produits ajoutés');
      void refetch();
      invalidate();
    } catch (error) {
      notify.error(message(error, "L'ajout a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(productId: string) {
    setBusy(true);
    try {
      await catalog.removeCollectionProducts(collectionId, [productId]);
      void refetch();
      invalidate();
    } catch (error) {
      notify.error(message(error, 'Le retrait a échoué'));
    } finally {
      setBusy(false);
    }
  }

  async function reorder(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const ids = members.map((member) => member.productId).filter((id) => id !== sourceId);
    const index = ids.indexOf(targetId);
    ids.splice(index < 0 ? ids.length : index, 0, sourceId);

    setBusy(true);
    try {
      await catalog.reorderCollectionProducts(collectionId, ids);
      void refetch();
    } catch (error) {
      notify.error(message(error, 'Le réordonnancement a échoué'));
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(member: MerchandisingItem) {
    setBusy(true);
    try {
      await catalog.merchandiseCollection(collectionId, {
        items: [{ productId: member.productId, pinned: !member.pinned }],
      });
      void refetch();
    } catch (error) {
      notify.error(message(error, "L'épinglage a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Produits</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <Field label="Ajouter des produits">
          <MultiSelect
            options={results.map((row) => ({
              value: row.id,
              label: t(row.name, 'fr'),
              description: row.slug,
            }))}
            values={[]}
            onValuesChange={(values) => void add(values)}
            onSearchChange={setQuery}
            loading={searching}
            placeholder="Rechercher un produit…"
            emptyMessage={query.length < 2 ? 'Tapez au moins 2 lettres' : 'Aucun résultat'}
          />
        </Field>

        {isLoading ? (
          <Skeleton className="h-40 w-full" label="Chargement des produits" />
        ) : members.length === 0 ? (
          <EmptyState
            title="Collection vide"
            description="Recherchez des produits ci-dessus pour les ajouter."
          />
        ) : (
          <ul className={cn('flex flex-col', busy && 'opacity-60')}>
            {members.map((member) => (
              <li
                key={member.productId}
                draggable
                onDragStart={() => setDragging(member.productId)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging) void reorder(dragging, member.productId);
                  setDragging(null);
                }}
                className={cn(
                  'flex items-center gap-3 border-b border-line py-2 last:border-b-0',
                  dragging === member.productId && 'opacity-40',
                )}
              >
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted" aria-hidden />

                {member.thumbnailUrl ? (
                  <img
                    src={member.thumbnailUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-xs border border-line object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs border border-line">
                    <ImageOff className="h-4 w-4 text-muted" aria-hidden />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate">{t(member.name, 'fr')}</p>
                  <p className="truncate text-xs tabular-nums text-muted">
                    {format(money(BigInt(member.minPrice)))} · {member.totalStock} en stock
                  </p>
                </div>

                <Button
                  variant={member.pinned ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => void togglePin(member)}
                  aria-pressed={member.pinned}
                  aria-label={member.pinned ? 'Détacher' : 'Épingler en tête'}
                >
                  <Pin className={cn('h-3.5 w-3.5', member.pinned && 'fill-current')} />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(member.productId)}
                  aria-label={`Retirer ${t(member.name, 'fr')}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function clean(value: Translated): Translated {
  return Object.fromEntries(
    Object.entries(value).filter(([, text]) => (text ?? '').trim() !== ''),
  ) as Translated;
}
