import { slugify, t, type CategoryNode, type Translated } from '@jecks/shared';
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
  Skeleton,
  SwitchField,
  TranslatedInput,
  cn,
  notify,
} from '@jecks/ui';
import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  GripVertical,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { previewUrl } from '@/lib/media';
import * as catalog from './api';
import { MediaPickerDialog } from './MediaPickerDialog';
import { message } from './ProductsListPage';
import { useCatalogInvalidate, useCategoryTree } from './queries';
import { flattenTree, subtreeIds, subtreeProductCount } from './tree';

/**
 * Category tree — PRD F-AD-11.
 *
 * Drag a row onto another to nest it, or between two rows to reorder. Each drop is one
 * request; the API rewrites the materialized path of the moved node and its whole
 * subtree in a transaction (D09), so the tree on screen and the paths in the database
 * cannot drift apart.
 */
export function CategoriesPage() {
  const { data: tree, isLoading, error, refetch } = useCategoryTree();
  const invalidate = useCatalogInvalidate();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<CategoryNode | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; mode: 'into' | 'before' } | null>(
    null,
  );
  const [editing, setEditing] = useState<CategoryNode | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const nodes = tree ?? [];

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Hidden because an ancestor is collapsed. */
  function isHidden(node: CategoryNode): boolean {
    let parentId = node.parentId;
    while (parentId) {
      if (collapsed.has(parentId)) return true;
      parentId =
        flattenTree(nodes).find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
    return false;
  }

  async function drop(target: CategoryNode, mode: 'into' | 'before') {
    if (!dragging) return;
    setDragging(null);
    setDropTarget(null);

    // Dropping a node inside its own subtree would orphan everything below it. The API
    // refuses too; catching it here means the operator sees nothing happen rather than
    // an error they did not cause.
    if (subtreeIds(dragging).has(target.id)) {
      notify.error('Une catégorie ne peut pas être déplacée dans sa propre branche');
      return;
    }

    const parentId = mode === 'into' ? target.id : target.parentId;
    const siblings = (
      parentId ? (flattenTree(nodes).find((node) => node.id === parentId)?.children ?? []) : nodes
    ).filter((node) => node.id !== dragging.id);
    const position =
      mode === 'into'
        ? siblings.length
        : Math.max(
            siblings.findIndex((node) => node.id === target.id),
            0,
          );

    setBusy(true);
    try {
      await catalog.moveCategory(dragging.id, { parentId, position });
      notify.success(`« ${t(dragging.name, 'fr')} » déplacée`);
      invalidate();
    } catch (error) {
      notify.error(message(error, 'Le déplacement a échoué'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(node: CategoryNode) {
    if (!window.confirm(`Supprimer « ${t(node.name, 'fr')} » ?`)) return;
    setBusy(true);
    try {
      await catalog.deleteCategory(node.id);
      notify.success('Catégorie supprimée');
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Catégories"
        description="Glissez une ligne sur une autre pour l’imbriquer, ou entre deux lignes pour la réordonner."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Nouvelle catégorie
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" label="Chargement de l’arborescence" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Arborescence indisponible"
          description={error.message}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Réessayer
            </Button>
          }
        />
      ) : nodes.length === 0 ? (
        <EmptyState
          title="Aucune catégorie"
          description="Créez une première catégorie pour organiser le catalogue."
          action={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Nouvelle catégorie
            </Button>
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul>
              {flattenTree(nodes)
                .filter((node) => !isHidden(node))
                .map((node) => (
                  <CategoryRow
                    key={node.id}
                    node={node}
                    busy={busy}
                    collapsed={collapsed.has(node.id)}
                    dragging={dragging?.id === node.id}
                    dropTarget={dropTarget?.id === node.id ? dropTarget.mode : null}
                    onToggle={() => toggle(node.id)}
                    onDragStart={() => setDragging(node)}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(mode) => setDropTarget({ id: node.id, mode })}
                    onDrop={(mode) => void drop(node, mode)}
                    onEdit={() => setEditing(node)}
                    onRemove={() => void remove(node)}
                  />
                ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <CategoryDialog
        node={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onDone={invalidate}
      />
    </div>
  );
}

function CategoryRow({
  node,
  busy,
  collapsed,
  dragging,
  dropTarget,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onEdit,
  onRemove,
}: {
  node: CategoryNode;
  busy: boolean;
  collapsed: boolean;
  dragging: boolean;
  dropTarget: 'into' | 'before' | null;
  onToggle: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (mode: 'into' | 'before') => void;
  onDrop: (mode: 'into' | 'before') => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const total = subtreeProductCount(node);

  /** The top quarter of a row means "put it above me"; the rest means "put it inside". */
  function modeFor(event: React.DragEvent<HTMLLIElement>): 'into' | 'before' {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY - bounds.top < bounds.height * 0.25 ? 'before' : 'into';
  }

  return (
    <li
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(modeFor(event));
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(modeFor(event));
      }}
      className={cn(
        'flex items-center gap-2 border-b border-line px-3 py-2 transition-colors last:border-b-0',
        dragging && 'opacity-40',
        dropTarget === 'into' && 'bg-brass/10',
        dropTarget === 'before' && 'border-t-2 border-t-brass',
      )}
      style={{ paddingInlineStart: `${12 + node.depth * 24}px` }}
    >
      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted" aria-hidden />

      {node.children.length > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Déplier' : 'Replier'}
          className="text-muted hover:text-ink"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      ) : (
        <span className="w-4" />
      )}

      {node.mediaUrl ? (
        <img
          src={node.mediaUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-xs border border-line object-cover"
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate">
          <span className="truncate">{t(node.name, 'fr')}</span>
          {!node.published ? (
            <Badge tone="neutral">
              <EyeOff className="h-2.5 w-2.5" aria-hidden />
              Masquée
            </Badge>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted">{node.path}</p>
      </div>

      <span className="whitespace-nowrap text-xs tabular-nums text-muted">
        {node.productCount} produit{node.productCount > 1 ? 's' : ''}
        {total !== node.productCount ? ` · ${total} avec sous-catégories` : ''}
      </span>

      <Button
        variant="ghost"
        size="sm"
        onClick={onEdit}
        aria-label={`Modifier ${t(node.name, 'fr')}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        aria-label={`Supprimer ${t(node.name, 'fr')}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

// --- create / edit ----------------------------------------------------------

function CategoryDialog({
  node,
  open,
  onOpenChange,
  onDone,
}: {
  node: CategoryNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { data: tree } = useCategoryTree();

  const [name, setName] = useState<Translated>({});
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState<Translated>({});
  const [seoTitle, setSeoTitle] = useState<Translated>({});
  const [seoDescription, setSeoDescription] = useState<Translated>({});
  const [parentId, setParentId] = useState<string>('');
  const [published, setPublished] = useState(true);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Seeding on open rather than on mount keeps the dialog reusable for every row.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = node?.id ?? 'new';
  if (open && seededFor !== key) {
    setSeededFor(key);
    setName(node?.name ?? {});
    setSlug(node?.slug ?? '');
    setDescription(node?.description ?? {});
    setSeoTitle(node?.seoTitle ?? {});
    setSeoDescription(node?.seoDescription ?? {});
    setParentId(node?.parentId ?? '');
    setPublished(node?.published ?? true);
    setMediaId(node?.mediaId ?? null);
    setMediaUrl(node?.mediaUrl ?? null);
    setFieldErrors({});
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const parentOptions = (tree ? flattenTree(tree) : []).filter((candidate) =>
    node ? !subtreeIds(node).has(candidate.id) : true,
  );

  async function submit() {
    setSaving(true);
    setFieldErrors({});
    const payload = {
      name: clean(name),
      slug: slug || slugify(name.fr ?? ''),
      description: clean(description),
      seoTitle: clean(seoTitle),
      seoDescription: clean(seoDescription),
      parentId: parentId || null,
      published,
      mediaId,
    };

    try {
      if (node) await catalog.updateCategory(node.id, payload);
      else await catalog.createCategory(payload);
      notify.success(node ? 'Catégorie mise à jour' : 'Catégorie créée');
      onOpenChange(false);
      onDone();
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
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{node ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          <Field label="Nom" required error={fieldErrors['name.fr']}>
            <TranslatedInput value={name} onChange={setName} placeholder="Trucker" />
          </Field>

          <Field
            label="URL"
            hint={`/collections/${slug || slugify(name.fr ?? '') || '…'}`}
            error={fieldErrors.slug}
          >
            <Input
              value={slug}
              onChange={(event) => setSlug(slugify(event.target.value))}
              placeholder={slugify(name.fr ?? '')}
            />
          </Field>

          <Field label="Catégorie parente">
            <select
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="h-10 w-full rounded-xs border border-line bg-base px-3 text-sm"
            >
              <option value="">Racine</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {'— '.repeat(option.depth)}
                  {t(option.name, 'fr')}
                </option>
              ))}
            </select>
          </Field>

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
                {mediaId ? 'Changer' : 'Choisir une image'}
              </Button>
              {mediaId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMediaId(null);
                    setMediaUrl(null);
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

          <Field label="Titre SEO">
            <TranslatedInput value={seoTitle} onChange={setSeoTitle} requiredLocale="" />
          </Field>

          <Field label="Description SEO">
            <TranslatedInput
              value={seoDescription}
              onChange={setSeoDescription}
              multiline
              rows={2}
              requiredLocale=""
            />
          </Field>

          <SwitchField
            label="Visible sur la boutique"
            description="Une catégorie masquée reste utilisable en interne."
            checked={published}
            onCheckedChange={setPublished}
          />
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
            {node ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>

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
        }}
      />
    </Dialog>
  );
}

/** Strict translated schemas reject empty strings, so blank locales are dropped. */
function clean(value: Translated): Translated {
  return Object.fromEntries(
    Object.entries(value).filter(([, text]) => (text ?? '').trim() !== ''),
  ) as Translated;
}
