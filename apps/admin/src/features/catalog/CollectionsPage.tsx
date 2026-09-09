import { slugify, t, type CollectionRow, type Translated } from '@jecks/shared';
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
import { EyeOff, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as catalog from './api';
import { message } from './ProductsListPage';
import { useCatalogInvalidate, useCollections } from './queries';

/**
 * Collections list — PRD F-AD-11.
 *
 * The count beside a smart collection is the live match count, computed by the API from
 * its rules on every read. A stored count would be a number that quietly stops being
 * true the moment a product's price changes.
 */
export function CollectionsPage() {
  const navigate = useNavigate();
  const invalidate = useCatalogInvalidate();
  const { data, isLoading, error, refetch } = useCollections();

  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const collections = data ?? [];

  async function remove(collection: CollectionRow) {
    if (!window.confirm(`Supprimer « ${t(collection.name, 'fr')} » ?`)) return;
    setBusy(true);
    try {
      await catalog.deleteCollection(collection.id);
      notify.success('Collection supprimée');
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
        title="Collections"
        description="Manuelles, ou automatiques via des règles évaluées à chaque affichage."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Nouvelle collection
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" label="Chargement des collections" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Collections indisponibles"
          description={error.message}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Réessayer
            </Button>
          }
        />
      ) : collections.length === 0 ? (
        <EmptyState
          title="Aucune collection"
          description="Groupez des produits à la main, ou laissez une règle le faire pour vous."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Nouvelle collection
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <Card
              key={collection.id}
              className={cn('transition-colors hover:border-brass/60', busy && 'opacity-60')}
            >
              <CardBody className="flex gap-3">
                {collection.mediaUrl ? (
                  <img
                    src={collection.mediaUrl}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-xs border border-line object-cover"
                  />
                ) : null}

                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/catalog/collections/${collection.id}`)}
                    className="block w-full truncate text-start font-medium text-ink hover:text-brass"
                  >
                    {t(collection.name, 'fr')}
                  </button>
                  <p className="truncate text-xs text-muted">/{collection.slug}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {collection.isSmart ? (
                      <Badge tone="brass">
                        <Sparkles className="h-2.5 w-2.5" aria-hidden />
                        {collection.ruleCount} règle{collection.ruleCount > 1 ? 's' : ''}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Manuelle</Badge>
                    )}
                    {!collection.published ? (
                      <Badge tone="neutral">
                        <EyeOff className="h-2.5 w-2.5" aria-hidden />
                        Masquée
                      </Badge>
                    ) : null}
                    <span className="text-xs tabular-nums text-muted">
                      {collection.productCount} produit{collection.productCount > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void remove(collection)}
                  aria-label={`Supprimer ${t(collection.name, 'fr')}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <CreateCollectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          invalidate();
          navigate(`/catalog/collections/${id}`);
        }}
      />
    </div>
  );
}

function CreateCollectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState<Translated>({});
  const [slug, setSlug] = useState('');
  const [isSmart, setIsSmart] = useState(false);
  const [saving, setSaving] = useState(false);

  const derivedSlug = slug || slugify(name.fr ?? '');

  async function submit() {
    setSaving(true);
    try {
      const created = await catalog.createCollection({
        name: {
          fr: name.fr ?? '',
          ...(name.ar ? { ar: name.ar } : {}),
          ...(name.en ? { en: name.en } : {}),
        },
        slug: derivedSlug,
        isSmart,
        matchAll: true,
        // A smart collection needs a rule to exist; this one selects everything in
        // stock, which is a sane thing to see before the operator narrows it.
        rules: isSmart ? [{ field: 'STOCK', operator: 'GREATER_THAN', value: '0' }] : [],
        productIds: [],
        published: true,
        position: 0,
      });
      notify.success('Collection créée');
      onOpenChange(false);
      setName({});
      setSlug('');
      onCreated(created.id);
    } catch (error) {
      notify.error(message(error, 'La création a échoué'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle collection</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required>
            <TranslatedInput value={name} onChange={setName} placeholder="Collection Été" />
          </Field>

          <Field label="URL" hint={`/collections/${derivedSlug || '…'}`}>
            <Input value={derivedSlug} onChange={(event) => setSlug(slugify(event.target.value))} />
          </Field>

          <SwitchField
            label="Collection automatique"
            description="Remplie par des règles — prix, étiquette, stock — plutôt qu’à la main."
            checked={isSmart}
            onCheckedChange={setIsSmart}
          />

          {isSmart ? (
            <p className="flex items-start gap-2 rounded-xs border border-line p-3 text-sm text-muted">
              <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-brass" aria-hidden />
              Une première règle « stock supérieur à 0 » est posée pour vous. Ajustez-la ensuite
              dans l’éditeur, avec l’aperçu en direct.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            loading={saving}
            disabled={(name.fr ?? '').trim() === '' || derivedSlug === ''}
            onClick={() => void submit()}
          >
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
