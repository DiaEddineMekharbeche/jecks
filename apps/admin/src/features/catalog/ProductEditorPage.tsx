import { ProductStatus, slugify, t, type ProductDetail, type Translated } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Combobox,
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
import { ArrowLeft, Copy, ExternalLink, Loader2, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as catalog from './api';
import { message } from './ProductsListPage';
import { ProductMediaTab } from './ProductMediaTab';
import { ProductVariantsTab } from './ProductVariantsTab';
import {
  useAttributes,
  useBrands,
  useCatalogInvalidate,
  useCategoryTree,
  useCollections,
  useProduct,
  useSizeGuides,
  useTags,
} from './queries';
import { flattenTree } from './tree';

/**
 * Product editor — PRD F-AD-10.
 *
 * Seven tabs over one entity, one save. The tabs are a view concern: the whole product
 * is held in local state and written with a single PATCH, so an operator who edits the
 * name on General and the SEO title on SEO does not have to remember to save twice.
 *
 * A draft autosaves. An active product does not — see DECISIONS D37: a product on the
 * storefront must change when someone decides it changes, not while they are still
 * typing.
 */

const AUTOSAVE_DELAY_MS = 1_500;

interface EditorForm {
  name: Translated;
  slug: string;
  shortDescription: Translated;
  description: Translated;
  status: ProductStatus;
  brandId: string | null;
  categoryId: string | null;
  sizeGuideId: string | null;
  styleLabel: string;
  collectionIds: string[];
  tagIds: string[];
  relatedProductIds: string[];
  mediaIds: string[];
  attributes: Array<{ key: string; value: Translated }>;
  seoTitle: Translated;
  seoDescription: Translated;
  publishedAt: string | null;
  lowStockThreshold: number;
  allowBackorder: boolean;
  trackInventory: boolean;
  shippingClass: string;
}

export function ProductEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';

  return isNew ? <NewProductPage /> : <ExistingProductEditor id={id!} />;
}

// --- create -----------------------------------------------------------------

/**
 * Creating asks for the four things a product cannot exist without. Everything else is
 * a decision better made against a saved product, where the option matrix, the gallery
 * and the margin are all live.
 */
function NewProductPage() {
  const navigate = useNavigate();
  const invalidate = useCatalogInvalidate();

  const [name, setName] = useState<Translated>({ fr: '' });
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [sku, setSku] = useState('');
  const [skuTouched, setSkuTouched] = useState(false);
  const [price, setPrice] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const derivedSlug = slugTouched ? slug : slugify(name.fr ?? '');
  const derivedSku = skuTouched
    ? sku
    : slugify(name.fr ?? '')
        .toUpperCase()
        .replace(/-/g, '-')
        .slice(0, 40) || '';

  async function submit() {
    setSaving(true);
    setFieldErrors({});
    try {
      const created = await catalog.createProduct({
        name: {
          fr: name.fr ?? '',
          ...(name.ar ? { ar: name.ar } : {}),
          ...(name.en ? { en: name.en } : {}),
        },
        slug: derivedSlug,
        status: ProductStatus.DRAFT,
        variants: [
          {
            sku: derivedSku,
            price: toMinor(price),
            costPrice: '0',
            weightGrams: 0,
            optionValueIds: [],
            mediaIds: [],
            position: 0,
            active: true,
          },
        ],
      });
      notify.success('Produit créé');
      invalidate();
      navigate(`/catalog/products/${created.id}`, { replace: true });
    } catch (error) {
      const errors =
        error instanceof Error && 'fieldErrors' in error
          ? (error as { fieldErrors: Record<string, string> }).fieldErrors
          : {};
      setFieldErrors(errors);
      notify.error(message(error, 'La création a échoué'));
    } finally {
      setSaving(false);
    }
  }

  const ready =
    (name.fr ?? '').trim().length > 0 && derivedSlug.length > 0 && derivedSku.length >= 2;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Nouveau produit"
        description="Le nom, l’URL, un premier SKU et un prix. Le reste s’ajoute ensuite."
        actions={
          <Button variant="ghost" size="sm" onClick={() => history.back()}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        }
      />

      <Card className="max-w-2xl">
        <CardBody className="flex flex-col gap-4">
          <Field label="Nom" required error={fieldErrors['name.fr']}>
            <TranslatedInput
              value={name}
              onChange={setName}
              placeholder="Casquette trucker noire"
            />
          </Field>

          <Field
            label="URL"
            hint={`/produits/${derivedSlug || '…'}`}
            error={fieldErrors.slug}
            required
          >
            <Input
              value={derivedSlug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(slugify(event.target.value));
              }}
              placeholder="casquette-trucker-noire"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="SKU de la première variante"
              required
              error={fieldErrors['variants.0.sku']}
            >
              <Input
                value={derivedSku}
                onChange={(event) => {
                  setSkuTouched(true);
                  setSku(event.target.value.toUpperCase());
                }}
                placeholder="CASQUETTE-TRUCKER-NOIRE"
              />
            </Field>

            <Field label="Prix de vente (DA)" required error={fieldErrors['variants.0.price']}>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="2900"
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center gap-2">
        <Button loading={saving} disabled={!ready} onClick={() => void submit()}>
          Créer le brouillon
        </Button>
        <span className="text-sm text-muted">
          Le produit est créé en brouillon; il n’apparaît pas sur la boutique.
        </span>
      </div>
    </div>
  );
}

// --- edit -------------------------------------------------------------------

function ExistingProductEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const invalidate = useCatalogInvalidate();
  const { data: product, isLoading, error, refetch } = useProduct(id);

  const [form, setForm] = useState<EditorForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autosavedAt, setAutosavedAt] = useState<Date | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('general');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The server copy seeds the form once per product; later refetches must not discard
  // what the operator has typed since.
  useEffect(() => {
    if (product && !form) setForm(toForm(product));
  }, [product, form]);

  useEffect(() => {
    setForm(null);
    setDirty(false);
  }, [id]);

  const patch = useCallback((changes: Partial<EditorForm>) => {
    setForm((current) => (current ? { ...current, ...changes } : current));
    setDirty(true);
  }, []);

  const save = useCallback(
    async (silent = false) => {
      if (!form) return;
      setSaving(true);
      setFieldErrors({});
      try {
        await catalog.updateProduct(id, toPayload(form) as never);
        setDirty(false);
        if (silent) setAutosavedAt(new Date());
        else notify.success('Produit enregistré');
        invalidate();
      } catch (error) {
        const errors =
          error && typeof error === 'object' && 'fieldErrors' in error
            ? (error as { fieldErrors: Record<string, string> }).fieldErrors
            : {};
        setFieldErrors(errors);
        notify.error(message(error, "L'enregistrement a échoué"));
      } finally {
        setSaving(false);
      }
    },
    [form, id, invalidate],
  );

  // Autosave, drafts only. An active product is on the storefront; saving it while
  // someone is mid-sentence would publish half a thought.
  const autosaves = form?.status === ProductStatus.DRAFT;

  useEffect(() => {
    if (!dirty || !autosaves) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(true), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [dirty, autosaves, save]);

  // Unsaved changes must survive a mis-click on the browser's back button.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function leave() {
    if (
      dirty &&
      !window.confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?')
    ) {
      return;
    }
    navigate('/catalog/products');
  }

  if (isLoading || !form || !product) {
    return error ? (
      <Alert tone="danger" title="Produit introuvable">
        <div className="flex items-center gap-3">
          <span>{error.message}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Réessayer
          </Button>
        </div>
      </Alert>
    ) : (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement du produit" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t(form.name, 'fr') || 'Produit'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={form.status === ProductStatus.ACTIVE ? 'success' : 'neutral'}>
              {STATUS_LABELS[form.status]}
            </Badge>
            <span className="text-muted">/{form.slug}</span>
            {form.status === ProductStatus.ACTIVE ? (
              <a
                href={`${STOREFRONT_URL}/fr/produits/${form.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-brass hover:underline"
              >
                Voir sur la boutique
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={leave}>
              <ArrowLeft className="h-4 w-4" />
              Produits
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const copy = await catalog.duplicateProduct(id);
                  notify.success('Produit dupliqué');
                  invalidate();
                  navigate(`/catalog/products/${copy.id}`);
                } catch (error) {
                  notify.error(message(error, 'La duplication a échoué'));
                }
              }}
            >
              <Copy className="h-4 w-4" />
              Dupliquer
            </Button>
            <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
              <Save className="h-4 w-4" />
              Enregistrer
            </Button>
          </>
        }
      />

      <SaveState dirty={dirty} saving={saving} autosaves={autosaves} autosavedAt={autosavedAt} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">Général</TabsTrigger>
          <TabsTrigger value="media">
            Médias
            <span className="ms-1.5 text-xs opacity-70">{form.mediaIds.length}</span>
          </TabsTrigger>
          <TabsTrigger value="variants">
            Variantes & prix
            <span className="ms-1.5 text-xs opacity-70">{product.variants.length}</span>
          </TabsTrigger>
          <TabsTrigger value="inventory">Stock</TabsTrigger>
          <TabsTrigger value="shipping">Livraison</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="related">Associés</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralTab form={form} patch={patch} fieldErrors={fieldErrors} />
        </TabsContent>

        <TabsContent value="media">
          <ProductMediaTab
            product={product}
            mediaIds={form.mediaIds}
            onChange={(mediaIds) => patch({ mediaIds })}
          />
        </TabsContent>

        <TabsContent value="variants">
          <ProductVariantsTab
            product={product}
            onSaved={() => {
              invalidate();
              void refetch();
            }}
          />
        </TabsContent>

        <TabsContent value="inventory">
          <InventoryTab form={form} patch={patch} product={product} />
        </TabsContent>

        <TabsContent value="shipping">
          <ShippingTab form={form} patch={patch} product={product} />
        </TabsContent>

        <TabsContent value="seo">
          <SeoTab form={form} patch={patch} />
        </TabsContent>

        <TabsContent value="related">
          <RelatedTab form={form} patch={patch} productId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const STOREFRONT_URL =
  (import.meta.env.VITE_STOREFRONT_URL as string | undefined) ?? 'http://localhost:3000';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'En ligne',
  DRAFT: 'Brouillon',
  ARCHIVED: 'Archivé',
};

function SaveState({
  dirty,
  saving,
  autosaves,
  autosavedAt,
}: {
  dirty: boolean;
  saving: boolean;
  autosaves: boolean;
  autosavedAt: Date | null;
}) {
  if (saving) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Enregistrement…
      </p>
    );
  }
  if (dirty) {
    return (
      <p className="text-sm text-brass">
        {autosaves
          ? 'Modifications non enregistrées — sauvegarde automatique dans un instant.'
          : 'Modifications non enregistrées.'}
      </p>
    );
  }
  if (autosavedAt) {
    return (
      <p className="text-sm text-muted">
        Brouillon enregistré à {autosavedAt.toLocaleTimeString('fr-DZ')}.
      </p>
    );
  }
  return null;
}

// --- tabs -------------------------------------------------------------------

interface TabProps {
  form: EditorForm;
  patch: (changes: Partial<EditorForm>) => void;
  fieldErrors?: Record<string, string>;
}

function GeneralTab({ form, patch, fieldErrors = {} }: TabProps) {
  const categories = useCategoryTree();
  const brands = useBrands();
  const collections = useCollections();
  const tags = useTags();
  const attributes = useAttributes();
  const sizeGuides = useSizeGuides();

  const categoryOptions = useMemo(
    () =>
      flattenTree(categories.data ?? []).map((node) => ({
        value: node.id,
        label: `${'— '.repeat(node.depth)}${t(node.name, 'fr')}`,
      })),
    [categories.data],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Identité</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <Field label="Nom" required error={fieldErrors['name.fr']}>
              <TranslatedInput value={form.name} onChange={(name) => patch({ name })} />
            </Field>

            <Field label="URL" hint={`/produits/${form.slug}`} error={fieldErrors.slug} required>
              <Input
                value={form.slug}
                onChange={(event) => patch({ slug: slugify(event.target.value) })}
              />
            </Field>

            <Field label="Accroche" hint="Une phrase, affichée sous le titre sur la fiche produit.">
              <TranslatedInput
                value={form.shortDescription}
                onChange={(shortDescription) => patch({ shortDescription })}
                requiredLocale=""
              />
            </Field>

            <Field label="Description">
              <TranslatedInput
                value={form.description}
                onChange={(description) => patch({ description })}
                multiline
                rows={8}
                requiredLocale=""
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attributs</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {(attributes.data ?? []).length === 0 ? (
              <p className="text-sm text-muted">
                Aucun attribut défini. Créez-en dans l’onglet Attributs du catalogue.
              </p>
            ) : (
              (attributes.data ?? []).map((attribute) => {
                const current =
                  form.attributes.find((item) => item.key === attribute.key)?.value ?? {};
                return (
                  <Field key={attribute.id} label={t(attribute.name, 'fr')}>
                    {attribute.kind === 'select' && attribute.options ? (
                      <Select
                        value={current.fr ?? ''}
                        onValueChange={(value) =>
                          patch({
                            attributes: setAttribute(form.attributes, attribute.key, { fr: value }),
                          })
                        }
                        placeholder="Non renseigné"
                        options={[
                          { value: '', label: 'Non renseigné' },
                          ...attribute.options.map((option) => ({
                            value: option.fr ?? '',
                            label: option.fr ?? '',
                          })),
                        ]}
                      />
                    ) : (
                      <TranslatedInput
                        value={current}
                        onChange={(value) =>
                          patch({ attributes: setAttribute(form.attributes, attribute.key, value) })
                        }
                        requiredLocale=""
                      />
                    )}
                  </Field>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Publication</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <Field label="Statut">
              <Select
                value={form.status}
                onValueChange={(value) => patch({ status: value as ProductStatus })}
                options={[
                  { value: ProductStatus.DRAFT, label: 'Brouillon' },
                  { value: ProductStatus.ACTIVE, label: 'En ligne' },
                  { value: ProductStatus.ARCHIVED, label: 'Archivé' },
                ]}
              />
            </Field>

            <Field
              label="Publication programmée"
              hint="Laissez vide pour publier dès la mise en ligne. Une date future garde le produit invisible jusque-là."
            >
              <Input
                type="datetime-local"
                value={toLocalInput(form.publishedAt)}
                onChange={(event) =>
                  patch({
                    publishedAt: event.target.value
                      ? new Date(event.target.value).toISOString()
                      : null,
                  })
                }
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Classement</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <Field label="Catégorie">
              <Combobox
                options={categoryOptions}
                value={form.categoryId}
                onValueChange={(categoryId) => patch({ categoryId })}
                placeholder="Aucune"
              />
            </Field>

            <Field label="Marque">
              <Combobox
                options={(brands.data ?? []).map((brand) => ({
                  value: brand.id,
                  label: brand.name,
                }))}
                value={form.brandId}
                onValueChange={(brandId) => patch({ brandId })}
                placeholder="Aucune"
              />
            </Field>

            <Field
              label="Collections"
              hint="Les collections automatiques se remplissent par leurs règles."
            >
              <MultiSelect
                options={(collections.data ?? [])
                  .filter((collection) => !collection.isSmart)
                  .map((collection) => ({
                    value: collection.id,
                    label: t(collection.name, 'fr'),
                  }))}
                values={form.collectionIds}
                onValuesChange={(collectionIds) => patch({ collectionIds })}
                placeholder="Aucune"
              />
            </Field>

            <Field label="Étiquettes">
              <MultiSelect
                options={(tags.data ?? []).map((tag) => ({
                  value: tag.id,
                  label: t(tag.name, 'fr'),
                }))}
                values={form.tagIds}
                onValuesChange={(tagIds) => patch({ tagIds })}
                placeholder="Aucune"
              />
            </Field>

            <Field label="Style" hint="Court libellé affiché sur la vignette, ex. « Trucker ».">
              <Input
                value={form.styleLabel}
                onChange={(event) => patch({ styleLabel: event.target.value })}
              />
            </Field>

            <Field label="Guide des tailles">
              <Combobox
                options={(sizeGuides.data ?? []).map((guide) => ({
                  value: guide.id,
                  label: t(guide.name, 'fr'),
                }))}
                value={form.sizeGuideId}
                onValueChange={(sizeGuideId) => patch({ sizeGuideId })}
                placeholder="Aucun"
              />
            </Field>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function InventoryTab({ form, patch, product }: TabProps & { product: ProductDetail }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Suivi du stock</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <SwitchField
            label="Suivre les quantités"
            description="Désactivez pour un produit sans stock, comme une carte cadeau."
            checked={form.trackInventory}
            onCheckedChange={(trackInventory) => patch({ trackInventory })}
          />
          <SwitchField
            label="Autoriser la commande en rupture"
            description="Le client peut commander même à zéro; la commande attend le réapprovisionnement."
            checked={form.allowBackorder}
            onCheckedChange={(allowBackorder) => patch({ allowBackorder })}
          />
          <Field
            label="Seuil de stock bas"
            hint="En dessous, le produit remonte dans les alertes et dans le filtre « stock bas »."
          >
            <Input
              type="number"
              min={0}
              className="w-32"
              value={form.lowStockThreshold}
              onChange={(event) =>
                patch({ lowStockThreshold: Math.max(0, Number(event.target.value) || 0) })
              }
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>État actuel</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 text-sm">
          <Row label="Stock disponible" value={`${product.totalStock}`} />
          <Row label="Variantes" value={`${product.variants.length}`} />
          <Row
            label="Alertes « prévenez-moi »"
            value={`${product.stockNotificationCount}`}
            hint="Clients en attente d’un réapprovisionnement."
          />
          <p className="pt-2 text-xs text-muted">
            Les mouvements de stock, les emplacements et les réceptions arrivent au jalon M1.3.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function ShippingTab({ form, patch, product }: TabProps & { product: ProductDetail }) {
  const heaviest = product.variants.reduce((max, variant) => Math.max(max, variant.weightGrams), 0);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Livraison</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <Field
          label="Classe d’expédition"
          hint="Regroupe des produits qui partagent un tarif. Laissez vide pour le tarif standard."
        >
          <Input
            value={form.shippingClass}
            onChange={(event) => patch({ shippingClass: event.target.value })}
            placeholder="standard"
          />
        </Field>
        <p className="text-sm text-muted">
          Le poids est défini par variante, dans l’onglet Variantes & prix. Le plus lourd de ce
          produit pèse {heaviest} g.
        </p>
      </CardBody>
    </Card>
  );
}

function SeoTab({ form, patch }: TabProps) {
  const title = form.seoTitle.fr || t(form.name, 'fr');
  const description = form.seoDescription.fr || form.shortDescription.fr || '';

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Référencement</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <Field
            label="Titre SEO"
            hint={`${(form.seoTitle.fr ?? '').length}/60 caractères — vide reprend le nom du produit.`}
          >
            <TranslatedInput
              value={form.seoTitle}
              onChange={(seoTitle) => patch({ seoTitle })}
              requiredLocale=""
            />
          </Field>
          <Field
            label="Description SEO"
            hint={`${(form.seoDescription.fr ?? '').length}/160 caractères.`}
          >
            <TranslatedInput
              value={form.seoDescription}
              onChange={(seoDescription) => patch({ seoDescription })}
              multiline
              rows={4}
              requiredLocale=""
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aperçu Google</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="rounded-xs border border-line p-4">
            <p className="truncate text-xs text-muted">
              {STOREFRONT_URL.replace(/^https?:\/\//, '')} › produits › {form.slug}
            </p>
            <p
              className={cn(
                'mt-1 truncate text-base text-brass',
                title.length > 60 && 'text-danger',
              )}
            >
              {title || 'Titre du produit'}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-muted">
              {description || 'La description apparaîtra ici.'}
            </p>
          </div>
          {title.length > 60 ? (
            <p className="mt-2 text-xs text-danger">
              Google coupe généralement au-delà de 60 caractères.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

function RelatedTab({ form, patch, productId }: TabProps & { productId: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: string; label: string }>>([]);
  const [searching, setSearching] = useState(false);

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
        if (!cancelled) {
          setResults(
            rows
              .filter((row) => row.id !== productId)
              .map((row) => ({ id: row.id, label: t(row.name, 'fr') })),
          );
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, productId]);

  const options = useMemo(
    () => results.map((row) => ({ value: row.id, label: row.label })),
    [results],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Produits associés</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Affichés sous la fiche produit, dans l’ordre choisi ici.
          </p>
          <Field label="Ajouter">
            <MultiSelect
              options={options}
              values={form.relatedProductIds.filter((id) =>
                options.some((option) => option.value === id),
              )}
              onValuesChange={(values) =>
                patch({
                  relatedProductIds: [
                    ...new Set([
                      ...form.relatedProductIds.filter(
                        (id) => !options.some((option) => option.value === id),
                      ),
                      ...values,
                    ]),
                  ],
                })
              }
              onSearchChange={setQuery}
              loading={searching}
              placeholder="Rechercher un produit…"
              emptyMessage={query.length < 2 ? 'Tapez au moins 2 lettres' : 'Aucun résultat'}
            />
          </Field>

          {form.relatedProductIds.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {form.relatedProductIds.map((relatedId) => (
                <li
                  key={relatedId}
                  className="flex items-center justify-between rounded-xs border border-line px-3 py-2 text-sm"
                >
                  <RelatedRowLabel id={relatedId} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patch({
                        relatedProductIds: form.relatedProductIds.filter((id) => id !== relatedId),
                      })
                    }
                  >
                    Retirer
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Aucun produit associé.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lots</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted">
            Les lots partagent leur moteur de prix avec les promotions. Ils arrivent au jalon M3
            avec le reste de ce moteur, plutôt qu’en double ici.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function RelatedRowLabel({ id }: { id: string }) {
  const { data } = useProduct(id);
  return <span className="truncate">{data ? t(data.name, 'fr') : id.slice(0, 8)}</span>;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p>{label}</p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}

// --- mapping ----------------------------------------------------------------

function toForm(product: ProductDetail): EditorForm {
  return {
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription ?? {},
    description: product.description ?? {},
    status: product.status,
    brandId: product.brandId,
    categoryId: product.categoryId,
    sizeGuideId: product.sizeGuideId,
    styleLabel: product.styleLabel ?? '',
    collectionIds: product.collectionIds,
    tagIds: product.tagIds,
    relatedProductIds: product.relatedProductIds,
    mediaIds: product.media.map((item) => item.mediaId),
    attributes: product.attributes,
    seoTitle: product.seoTitle ?? {},
    seoDescription: product.seoDescription ?? {},
    publishedAt: product.publishedAt,
    lowStockThreshold: product.lowStockThreshold,
    allowBackorder: product.allowBackorder,
    trackInventory: product.trackInventory,
    shippingClass: product.shippingClass ?? '',
  };
}

/**
 * The translated schemas are strict, so an empty locale must be dropped rather than
 * sent as `""` — and an entirely empty field must be sent as `{}`, not omitted, or the
 * server keeps the old value the operator just cleared.
 */
function clean(value: Translated): Translated {
  return Object.fromEntries(
    Object.entries(value).filter(([, text]) => (text ?? '').trim() !== ''),
  ) as Translated;
}

function toPayload(form: EditorForm): Record<string, unknown> {
  return {
    name: clean(form.name),
    slug: form.slug,
    shortDescription: clean(form.shortDescription),
    description: clean(form.description),
    status: form.status,
    brandId: form.brandId,
    categoryId: form.categoryId,
    sizeGuideId: form.sizeGuideId,
    styleLabel: form.styleLabel,
    collectionIds: form.collectionIds,
    tagIds: form.tagIds,
    relatedProductIds: form.relatedProductIds,
    mediaIds: form.mediaIds,
    attributes: form.attributes
      .filter((attribute) => Object.keys(clean(attribute.value)).length > 0)
      .map((attribute) => ({ key: attribute.key, value: clean(attribute.value) })),
    seoTitle: clean(form.seoTitle),
    seoDescription: clean(form.seoDescription),
    publishedAt: form.publishedAt,
    lowStockThreshold: form.lowStockThreshold,
    allowBackorder: form.allowBackorder,
    trackInventory: form.trackInventory,
    shippingClass: form.shippingClass,
  };
}

function setAttribute(
  attributes: EditorForm['attributes'],
  key: string,
  value: Translated,
): EditorForm['attributes'] {
  const without = attributes.filter((attribute) => attribute.key !== key);
  return Object.keys(clean(value)).length === 0 ? without : [...without, { key, value }];
}

/** `datetime-local` wants a local wall-clock string, not an instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Dinars typed in the create form; centimes on the wire. */
function toMinor(dinars: string): string {
  const value = Number(dinars.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return '0';
  return String(Math.round(value * 100));
}

export const __editorInternals = { clean, toLocalInput, toMinor, setAttribute };
