import {
  slugify,
  t,
  type AttributeDto,
  type BrandDto,
  type SizeGuideDto,
  type TagDto,
  type Translated,
} from '@jecks/shared';
import {
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
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SwitchField,
  Textarea,
  TranslatedInput,
  cn,
  notify,
} from '@jecks/ui';
import { ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { previewUrl } from '@/lib/media';
import * as catalog from './api';
import { MediaPickerDialog } from './MediaPickerDialog';
import { message } from './ProductsListPage';
import {
  useAttributes,
  useCatalogInvalidate,
  useCategoryTree,
  useSizeGuides,
  useTags,
} from './queries';
import { useBrands } from './queries';
import { flattenTree } from './tree';

/**
 * The catalogue's small vocabularies — brands, tags, attributes, size guides
 * (PRD F-AD-11).
 *
 * Each is a flat list of tens of rows, so they share one layout rather than four
 * near-identical tables. What differs between them is the form, which is why the shell
 * takes the rows and the dialog as arguments instead of trying to generalise the fields
 * as well.
 */

function CrudShell<T>({
  title,
  description,
  items,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  onCreate,
  renderItem,
}: {
  title: string;
  description: string;
  items: T[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription: string;
  onCreate: () => void;
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" label="Chargement" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Liste indisponible"
          description={error.message}
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              Réessayer
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button size="sm" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(renderItem)}</div>
      )}
    </div>
  );
}

function EntityCard({
  title,
  subtitle,
  count,
  image,
  onEdit,
  onRemove,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  image?: string | null;
  onEdit: () => void;
  onRemove: () => void;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardBody className="flex items-start gap-3">
        {image ? (
          <img
            src={image}
            alt=""
            className="h-12 w-12 shrink-0 rounded-xs border border-line object-contain"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
          <p className="mt-1 text-xs tabular-nums text-muted">
            {count} produit{count > 1 ? 's' : ''}
          </p>
          {children}
        </div>

        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Modifier ${title}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Supprimer ${title}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// --- brands -----------------------------------------------------------------

export function BrandsPage() {
  const { data, isLoading, error, refetch } = useBrands();
  const invalidate = useCatalogInvalidate();
  const [editing, setEditing] = useState<BrandDto | 'new' | null>(null);

  async function remove(brand: BrandDto) {
    if (!window.confirm(`Supprimer « ${brand.name} » ?`)) return;
    try {
      await catalog.deleteBrand(brand.id);
      notify.success('Marque supprimée');
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <>
      <CrudShell<BrandDto>
        title="Marques"
        description="Les marques et sous-marques du catalogue, avec leur logo."
        items={data ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        emptyTitle="Aucune marque"
        emptyDescription="Créez une marque pour la proposer dans l’éditeur de produit."
        onCreate={() => setEditing('new')}
        renderItem={(brand) => (
          <EntityCard
            key={brand.id}
            title={brand.name}
            subtitle={`/${brand.slug}`}
            count={brand.productCount}
            image={brand.logoUrl}
            onEdit={() => setEditing(brand)}
            onRemove={() => void remove(brand)}
          />
        )}
      />

      <BrandDialog
        brand={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onDone={invalidate}
      />
    </>
  );
}

function BrandDialog({
  brand,
  open,
  onOpenChange,
  onDone,
}: {
  brand: BrandDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState<Translated>({});
  const [logoMediaId, setLogoMediaId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const key = brand?.id ?? 'new';
  if (open && seededFor !== key) {
    setSeededFor(key);
    setName(brand?.name ?? '');
    setSlug(brand?.slug ?? '');
    setDescription(brand?.description ?? {});
    setLogoMediaId(brand?.logoMediaId ?? null);
    setLogoUrl(brand?.logoUrl ?? null);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  async function submit() {
    setSaving(true);
    const payload = {
      name,
      slug: slug || slugify(name),
      description: clean(description),
      logoMediaId,
    };
    try {
      if (brand) await catalog.updateBrand(brand.id, payload);
      else await catalog.createBrand(payload);
      notify.success(brand ? 'Marque mise à jour' : 'Marque créée');
      onOpenChange(false);
      onDone();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{brand ? 'Modifier la marque' : 'Nouvelle marque'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="URL" hint={`/marques/${slug || slugify(name) || '…'}`}>
            <Input value={slug} onChange={(event) => setSlug(slugify(event.target.value))} />
          </Field>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="h-14 w-14 rounded-xs border border-line object-contain"
                />
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                <ImagePlus className="h-4 w-4" />
                {logoMediaId ? 'Changer' : 'Choisir'}
              </Button>
              {logoMediaId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLogoMediaId(null);
                    setLogoUrl(null);
                  }}
                >
                  Retirer
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Description">
            <TranslatedInput
              value={description}
              onChange={setDescription}
              multiline
              rows={3}
              requiredLocale=""
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button loading={saving} disabled={name.trim() === ''} onClick={() => void submit()}>
            {brand ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedIds={logoMediaId ? [logoMediaId] : []}
        multiple={false}
        kind="IMAGE"
        onConfirm={(media) => {
          const first = media[0];
          setLogoMediaId(first?.id ?? null);
          setLogoUrl(first ? previewUrl(first, 200) : null);
        }}
      />
    </Dialog>
  );
}

// --- tags -------------------------------------------------------------------

export function TagsPage() {
  const { data, isLoading, error, refetch } = useTags();
  const invalidate = useCatalogInvalidate();
  const [editing, setEditing] = useState<TagDto | 'new' | null>(null);

  async function remove(tag: TagDto) {
    if (
      !window.confirm(
        tag.productCount > 0
          ? `« ${t(tag.name, 'fr')} » est sur ${tag.productCount} produit(s). L’étiquette leur sera retirée. Continuer ?`
          : `Supprimer « ${t(tag.name, 'fr')} » ?`,
      )
    ) {
      return;
    }
    try {
      await catalog.deleteTag(tag.id);
      notify.success('Étiquette supprimée');
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <>
      <CrudShell<TagDto>
        title="Étiquettes"
        description="Utilisées par les filtres de la boutique et par les règles des collections automatiques."
        items={data ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        emptyTitle="Aucune étiquette"
        emptyDescription="Les étiquettes servent à filtrer et à alimenter les collections automatiques."
        onCreate={() => setEditing('new')}
        renderItem={(tag) => (
          <EntityCard
            key={tag.id}
            title={t(tag.name, 'fr')}
            subtitle={`#${tag.slug}`}
            count={tag.productCount}
            onEdit={() => setEditing(tag)}
            onRemove={() => void remove(tag)}
          />
        )}
      />

      <TagDialog
        tag={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onDone={invalidate}
      />
    </>
  );
}

function TagDialog({
  tag,
  open,
  onOpenChange,
  onDone,
}: {
  tag: TagDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState<Translated>({});
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const key = tag?.id ?? 'new';
  if (open && seededFor !== key) {
    setSeededFor(key);
    setName(tag?.name ?? {});
    setSlug(tag?.slug ?? '');
  }
  if (!open && seededFor !== null) setSeededFor(null);

  async function submit() {
    setSaving(true);
    const payload = { name: clean(name), slug: slug || slugify(name.fr ?? '') };
    try {
      if (tag) await catalog.updateTag(tag.id, payload);
      else await catalog.createTag(payload);
      notify.success(tag ? 'Étiquette mise à jour' : 'Étiquette créée');
      onOpenChange(false);
      onDone();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tag ? 'Modifier l’étiquette' : 'Nouvelle étiquette'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required>
            <TranslatedInput value={name} onChange={setName} placeholder="Nouveauté" />
          </Field>
          <Field label="Identifiant" hint="Utilisé dans les URL et dans les règles de collection.">
            <Input
              value={slug}
              onChange={(event) => setSlug(slugify(event.target.value))}
              placeholder={slugify(name.fr ?? '')}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            loading={saving}
            disabled={(name.fr ?? '').trim() === ''}
            onClick={() => void submit()}
          >
            {tag ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- attributes -------------------------------------------------------------

export function AttributesPage() {
  const { data, isLoading, error, refetch } = useAttributes();
  const invalidate = useCatalogInvalidate();
  const [editing, setEditing] = useState<AttributeDto | 'new' | null>(null);

  async function remove(attribute: AttributeDto) {
    if (!window.confirm(`Supprimer « ${t(attribute.name, 'fr')} » ?`)) return;
    try {
      await catalog.deleteAttribute(attribute.id);
      notify.success('Attribut supprimé');
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <>
      <CrudShell<AttributeDto>
        title="Attributs"
        description="Caractéristiques structurées — matière, fermeture, coupe — proposées dans chaque produit."
        items={data ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        emptyTitle="Aucun attribut"
        emptyDescription="Un attribut apparaît dans tous les produits et peut servir de filtre."
        onCreate={() => setEditing('new')}
        renderItem={(attribute) => (
          <EntityCard
            key={attribute.id}
            title={t(attribute.name, 'fr')}
            subtitle={attribute.key}
            count={attribute.productCount}
            onEdit={() => setEditing(attribute)}
            onRemove={() => void remove(attribute)}
          >
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Badge tone="neutral">{KIND_LABELS[attribute.kind] ?? attribute.kind}</Badge>
              {attribute.filterable ? <Badge tone="brass">Filtrable</Badge> : null}
            </div>
          </EntityCard>
        )}
      />

      <AttributeDialog
        attribute={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onDone={invalidate}
      />
    </>
  );
}

const KIND_LABELS: Record<string, string> = {
  text: 'Texte',
  number: 'Nombre',
  select: 'Liste de choix',
};

function AttributeDialog({
  attribute,
  open,
  onOpenChange,
  onDone,
}: {
  attribute: AttributeDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState<Translated>({});
  const [kind, setKind] = useState('text');
  const [optionsText, setOptionsText] = useState('');
  const [filterable, setFilterable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const seedKey = attribute?.id ?? 'new';
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setKey(attribute?.key ?? '');
    setName(attribute?.name ?? {});
    setKind(attribute?.kind ?? 'text');
    setOptionsText((attribute?.options ?? []).map((option) => option.fr ?? '').join(', '));
    setFilterable(attribute?.filterable ?? true);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  async function submit() {
    setSaving(true);
    const payload = {
      key: key || slugify(name.fr ?? '').replace(/-/g, '_'),
      name: clean(name),
      kind,
      filterable,
      position: attribute?.position ?? 0,
      ...(kind === 'select'
        ? {
            options: optionsText
              .split(',')
              .map((piece) => piece.trim())
              .filter(Boolean)
              .map((label) => ({ fr: label })),
          }
        : {}),
    };
    try {
      if (attribute) await catalog.updateAttribute(attribute.id, payload);
      else await catalog.createAttribute(payload);
      notify.success(attribute ? 'Attribut mis à jour' : 'Attribut créé');
      onOpenChange(false);
      onDone();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{attribute ? 'Modifier l’attribut' : 'Nouvel attribut'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required>
            <TranslatedInput value={name} onChange={setName} placeholder="Matière" />
          </Field>

          <Field
            label="Clé technique"
            hint={
              attribute
                ? 'La clé ne change plus : les imports et les filtres s’appuient dessus.'
                : 'Minuscules et underscores. Ex. : material'
            }
          >
            <Input
              value={key}
              disabled={Boolean(attribute)}
              onChange={(event) =>
                setKey(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
              }
              placeholder={slugify(name.fr ?? '').replace(/-/g, '_')}
            />
          </Field>

          <Field label="Type">
            <Select
              value={kind}
              onValueChange={setKind}
              options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>

          {kind === 'select' ? (
            <Field label="Valeurs possibles" hint="Séparées par des virgules." required>
              <Textarea
                rows={3}
                value={optionsText}
                onChange={(event) => setOptionsText(event.target.value)}
                placeholder="Coton, Polyester, Laine"
              />
            </Field>
          ) : null}

          <SwitchField
            label="Utilisable comme filtre"
            description="Apparaît dans le rail de filtres de la boutique."
            checked={filterable}
            onCheckedChange={setFilterable}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            loading={saving}
            disabled={
              (name.fr ?? '').trim() === '' || (kind === 'select' && optionsText.trim() === '')
            }
            onClick={() => void submit()}
          >
            {attribute ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- size guides ------------------------------------------------------------

export function SizeGuidesPage() {
  const { data, isLoading, error, refetch } = useSizeGuides();
  const invalidate = useCatalogInvalidate();
  const [editing, setEditing] = useState<SizeGuideDto | 'new' | null>(null);

  async function remove(guide: SizeGuideDto) {
    if (!window.confirm(`Supprimer « ${t(guide.name, 'fr')} » ?`)) return;
    try {
      await catalog.deleteSizeGuide(guide.id);
      notify.success('Guide supprimé');
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <>
      <CrudShell<SizeGuideDto>
        title="Guides des tailles"
        description="Un tableau de mesures par famille de produits, affiché depuis la fiche produit."
        items={data ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        emptyTitle="Aucun guide"
        emptyDescription="Un guide des tailles réduit les retours pour mauvaise taille."
        onCreate={() => setEditing('new')}
        renderItem={(guide) => (
          <EntityCard
            key={guide.id}
            title={t(guide.name, 'fr')}
            subtitle={guide.categoryName ? t(guide.categoryName, 'fr') : 'Toutes catégories'}
            count={guide.productCount}
            onEdit={() => setEditing(guide)}
            onRemove={() => void remove(guide)}
          />
        )}
      />

      <SizeGuideDialog
        guide={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onDone={invalidate}
      />
    </>
  );
}

function SizeGuideDialog({
  guide,
  open,
  onOpenChange,
  onDone,
}: {
  guide: SizeGuideDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const categories = useCategoryTree();

  const [name, setName] = useState<Translated>({});
  const [body, setBody] = useState<Translated>({});
  const [categoryId, setCategoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const key = guide?.id ?? 'new';
  if (open && seededFor !== key) {
    setSeededFor(key);
    setName(guide?.name ?? {});
    setBody(guide?.body ?? {});
    setCategoryId(guide?.categoryId ?? '');
  }
  if (!open && seededFor !== null) setSeededFor(null);

  async function submit() {
    setSaving(true);
    try {
      const payload = {
        name: clean(name),
        body: clean(body),
        categoryId: categoryId || null,
      };
      if (guide) await catalog.updateSizeGuide(guide.id, payload);
      else await catalog.createSizeGuide(payload);
      notify.success(guide ? 'Guide mis à jour' : 'Guide créé');
      onOpenChange(false);
      onDone();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{guide ? 'Modifier le guide' : 'Nouveau guide des tailles'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <Field label="Nom" required>
            <TranslatedInput value={name} onChange={setName} placeholder="Tailles casquettes" />
          </Field>

          <Field label="Catégorie" hint="Laissez vide pour un guide valable partout.">
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              placeholder="Toutes catégories"
              options={[
                { value: '', label: 'Toutes catégories' },
                ...flattenTree(categories.data ?? []).map((node) => ({
                  value: node.id,
                  label: `${'— '.repeat(node.depth)}${t(node.name, 'fr')}`,
                })),
              ]}
            />
          </Field>

          <Field
            label="Contenu"
            hint="HTML accepté — un tableau de mesures est le format habituel."
            required
          >
            <TranslatedInput
              value={body}
              onChange={setBody}
              multiline
              rows={10}
              placeholder="<table><tr><th>Taille</th><th>Tour de tête</th></tr>…</table>"
            />
          </Field>

          {body.fr ? (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-muted">Aperçu</p>
              <div
                className={cn(
                  'prose-sm max-w-none rounded-xs border border-line p-3',
                  '[&_table]:w-full [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1',
                  '[&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-start',
                )}
                // The guide is authored by staff, not by customers, and it is rendered
                // the same way on the storefront; a rich-text editor lands with the CMS
                // in M6.
                dangerouslySetInnerHTML={{ __html: body.fr }}
              />
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            loading={saving}
            disabled={(name.fr ?? '').trim() === '' || (body.fr ?? '').trim() === ''}
            onClick={() => void submit()}
          >
            {guide ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clean(value: Translated): Translated {
  return Object.fromEntries(
    Object.entries(value).filter(([, text]) => (text ?? '').trim() !== ''),
  ) as Translated;
}
