import { format, money, t, type MerchandisingItem, type SynonymDto } from '@jecks/shared';
import {
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
  PageHeader,
  Select,
  Skeleton,
  SwitchField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  notify,
} from '@jecks/ui';
import { ArrowDown, ArrowUp, Eye, EyeOff, ImageOff, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import * as catalog from './api';
import { message } from './ProductsListPage';
import {
  useCatalogInvalidate,
  useCollection,
  useCollectionMembers,
  useCollections,
  useSynonyms,
} from './queries';

/**
 * Merchandising board and search synonyms — PRD F-AD-13.
 *
 * Pinning, hiding and boosting are per collection, including for a smart one: the rules
 * decide who is in the grid, this decides the order they appear in. A boost is a nudge
 * on the default sort rather than a fixed position, so a boosted product still moves
 * with its own sales instead of freezing at rank three for ever.
 */
export function MerchandisingPage() {
  const collections = useCollections();
  const [collectionId, setCollectionId] = useState<string>('');

  const options = (collections.data ?? []).map((collection) => ({
    value: collection.id,
    label: `${t(collection.name, 'fr')}${collection.isSmart ? ' (auto)' : ''}`,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Marchandisage"
        description="Épinglez, masquez ou poussez des produits dans une collection, et apprenez des synonymes à la recherche."
      />

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Mise en avant</TabsTrigger>
          <TabsTrigger value="synonyms">Synonymes de recherche</TabsTrigger>
        </TabsList>

        <TabsContent value="board">
          <div className="flex flex-col gap-4">
            <Field label="Collection" className="max-w-md">
              <Select
                value={collectionId}
                onValueChange={setCollectionId}
                placeholder="Choisir une collection"
                options={options}
              />
            </Field>

            {collectionId ? (
              <MerchandisingBoard collectionId={collectionId} />
            ) : (
              <EmptyState
                title="Choisissez une collection"
                description="La mise en avant s’applique collection par collection."
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="synonyms">
          <SynonymsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MerchandisingBoard({ collectionId }: { collectionId: string }) {
  const { data: collection } = useCollection(collectionId);
  const { data, isLoading, refetch } = useCollectionMembers(collectionId);
  const invalidate = useCatalogInvalidate();
  const [busy, setBusy] = useState(false);

  const members = data ?? [];

  async function apply(items: Array<Partial<MerchandisingItem> & { productId: string }>) {
    setBusy(true);
    try {
      await catalog.merchandiseCollection(collectionId, { items });
      void refetch();
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La mise à jour a échoué'));
    } finally {
      setBusy(false);
    }
  }

  function moveBy(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= members.length) return;
    const reordered = [...members];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);
    void apply(reordered.map((item, position) => ({ productId: item.productId, position })));
  }

  if (isLoading) {
    return <Skeleton className="h-64 w-full" label="Chargement de la collection" />;
  }

  if (members.length === 0) {
    return (
      <EmptyState
        title="Collection vide"
        description="Ajoutez des produits à cette collection avant de les mettre en avant."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {members.length} produit{members.length > 1 ? 's' : ''}
          {collection?.isSmart ? ' sélectionnés par les règles' : ''}
        </CardTitle>
      </CardHeader>
      <CardBody className={cn('p-0', busy && 'opacity-60')}>
        <ul>
          {members.map((member, index) => (
            <li
              key={member.productId}
              className={cn(
                'flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-b-0',
                member.hidden && 'opacity-50',
              )}
            >
              <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted">
                {index + 1}
              </span>

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
                  {format(money(BigInt(member.minPrice)))} · {member.salesCount} ventes ·{' '}
                  {member.totalStock} en stock
                </p>
              </div>

              {member.pinned ? <Badge tone="brass">Épinglé</Badge> : null}
              {member.boost !== 0 ? (
                <Badge tone={member.boost > 0 ? 'success' : 'neutral'}>
                  {member.boost > 0 ? '+' : ''}
                  {member.boost}
                </Badge>
              ) : null}

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => moveBy(index, -1)}
                  aria-label="Monter"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === members.length - 1}
                  onClick={() => moveBy(index, 1)}
                  aria-label="Descendre"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant={member.pinned ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() =>
                    void apply([{ productId: member.productId, pinned: !member.pinned }])
                  }
                  aria-pressed={member.pinned}
                  aria-label={member.pinned ? 'Détacher' : 'Épingler en tête'}
                >
                  <Pin className={cn('h-3.5 w-3.5', member.pinned && 'fill-current')} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void apply([{ productId: member.productId, hidden: !member.hidden }])
                  }
                  aria-pressed={member.hidden}
                  aria-label={member.hidden ? 'Réafficher' : 'Masquer dans cette collection'}
                >
                  {member.hidden ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Input
                  type="number"
                  min={-100}
                  max={100}
                  className="h-8 w-20 text-end"
                  value={member.boost}
                  onChange={(event) =>
                    void apply([
                      {
                        productId: member.productId,
                        boost: clamp(Number(event.target.value) || 0, -100, 100),
                      },
                    ])
                  }
                  aria-label={`Coup de pouce pour ${t(member.name, 'fr')}`}
                />
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

// --- synonyms ---------------------------------------------------------------

function SynonymsPanel() {
  const { data, isLoading, error, refetch } = useSynonyms();
  const invalidate = useCatalogInvalidate();
  const [editing, setEditing] = useState<SynonymDto | 'new' | null>(null);

  async function remove(synonym: SynonymDto) {
    if (!window.confirm(`Supprimer les synonymes de « ${synonym.term} » ?`)) return;
    try {
      await catalog.deleteSynonym(synonym.id);
      notify.success('Synonymes supprimés');
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  const synonyms = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Une entrée élargit la recherche : un client qui tape « cap » trouve aussi les casquettes.
          En bidirectionnel, la règle marche dans les deux sens.
        </p>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" label="Chargement des synonymes" />
      ) : error ? (
        <EmptyState
          title="Synonymes indisponibles"
          description={error.message}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Réessayer
            </Button>
          }
        />
      ) : synonyms.length === 0 ? (
        <EmptyState
          title="Aucun synonyme"
          description="Ajoutez les mots que vos clients utilisent et que le catalogue n’emploie pas."
          action={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul>
              {synonyms.map((synonym) => (
                <li
                  key={synonym.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-b-0',
                    !synonym.active && 'opacity-50',
                  )}
                >
                  <span className="font-medium">{synonym.term}</span>
                  <span className="text-muted">{synonym.twoWay ? '↔' : '→'}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">
                    {synonym.synonyms.join(', ')}
                  </span>
                  {!synonym.active ? <Badge tone="neutral">Inactif</Badge> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(synonym)}
                    aria-label={`Modifier ${synonym.term}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void remove(synonym)}
                    aria-label={`Supprimer ${synonym.term}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <SynonymDialog
        synonym={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onDone={invalidate}
      />
    </div>
  );
}

function SynonymDialog({
  synonym,
  open,
  onOpenChange,
  onDone,
}: {
  synonym: SynonymDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [term, setTerm] = useState('');
  const [list, setList] = useState('');
  const [twoWay, setTwoWay] = useState(true);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const key = synonym?.id ?? 'new';
  if (open && seededFor !== key) {
    setSeededFor(key);
    setTerm(synonym?.term ?? '');
    setList((synonym?.synonyms ?? []).join(', '));
    setTwoWay(synonym?.twoWay ?? true);
    setActive(synonym?.active ?? true);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  async function submit() {
    setSaving(true);
    const payload = {
      term: term.trim().toLowerCase(),
      synonyms: list
        .split(',')
        .map((piece) => piece.trim().toLowerCase())
        .filter(Boolean),
      twoWay,
      active,
    };
    try {
      if (synonym) await catalog.updateSynonym(synonym.id, payload);
      else await catalog.createSynonym(payload);
      notify.success(synonym ? 'Synonymes mis à jour' : 'Synonymes ajoutés');
      onOpenChange(false);
      onDone();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setSaving(false);
    }
  }

  const synonymCount = list.split(',').filter((piece) => piece.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{synonym ? 'Modifier les synonymes' : 'Nouveaux synonymes'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Terme" required hint="Le mot tel qu’il figure dans votre catalogue.">
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="casquette"
            />
          </Field>

          <Field label="Synonymes" required hint="Séparés par des virgules.">
            <Input
              value={list}
              onChange={(event) => setList(event.target.value)}
              placeholder="cap, kaskita, قبعة"
            />
          </Field>

          <SwitchField
            label="Bidirectionnel"
            description="Chercher un synonyme ramène aussi le terme d’origine."
            checked={twoWay}
            onCheckedChange={setTwoWay}
          />

          <SwitchField
            label="Actif"
            description="Désactivez pour tester sans supprimer."
            checked={active}
            onCheckedChange={setActive}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            loading={saving}
            disabled={term.trim().length < 2 || synonymCount === 0}
            onClick={() => void submit()}
          >
            {synonym ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
