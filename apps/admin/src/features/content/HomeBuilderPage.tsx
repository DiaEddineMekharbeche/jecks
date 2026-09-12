import {
  HOME_SECTION_KINDS,
  t,
  type HomeSectionDto,
  type HomeSectionKind,
} from '@jecks/shared';
import {
  Alert,
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
  TranslatedInput,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useCollections } from '@/features/catalog/queries';
import { MediaPickerDialog } from '@/features/catalog/MediaPickerDialog';
import { dateTimeFormatter, message } from '@/lib/errors';
import * as content from './api';
import { HomePreview } from './HomePreview';
import { SECTION_HINTS, SECTION_LABELS } from './labels';

/**
 * The home page an owner assembles — PRD F-AD-90.
 *
 * Sections in the order they are drawn, each with its own window. A section outside its
 * dates is shown greyed rather than hidden: the owner needs to see the promotion they
 * scheduled for next week, not wonder where it went.
 */
export function HomeBuilderPage() {
  const [editing, setEditing] = useState<HomeSectionDto | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const sections = useQuery({
    queryKey: ['admin', 'home-sections'],
    queryFn: content.listHomeSections,
  });

  async function move(section: HomeSectionDto, direction: -1 | 1) {
    const list = sections.data ?? [];
    const index = list.findIndex((entry) => entry.id === section.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;

    const ordered = [...list];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);

    setBusy(true);
    try {
      await content.reorderHomeSections({ ids: ordered.map((entry) => entry.id) });
      await sections.refetch();
    } catch (error) {
      notify.error(message(error, 'Le réordonnancement a échoué'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(section: HomeSectionDto) {
    try {
      await content.updateHomeSection(section.id, {
        kind: section.kind,
        title: section.title ?? undefined,
        subtitle: section.subtitle ?? undefined,
        ctaLabel: section.ctaLabel ?? undefined,
        ctaUrl: section.ctaUrl,
        mediaId: section.mediaId,
        collectionId: section.collectionId,
        productId: section.productId,
        config: section.config,
        position: section.position,
        active: !section.active,
        startsAt: section.startsAt,
        endsAt: section.endsAt,
      });
      notify.success(section.active ? 'Section masquée' : 'Section affichée');
      await sections.refetch();
    } catch (error) {
      notify.error(message(error, 'La mise à jour a échoué'));
    }
  }

  async function remove(section: HomeSectionDto) {
    if (!window.confirm(`Retirer la section « ${SECTION_LABELS[section.kind]} » ?`)) return;
    try {
      await content.deleteHomeSection(section.id);
      notify.success('Section retirée');
      await sections.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Page d’accueil"
        description="Les blocs de la vitrine, dans l’ordre où ils apparaissent."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Ajouter un bloc
          </Button>
        }
      />

      {sections.isLoading ? (
        <Skeleton className="h-64" label="Chargement de la page d’accueil" />
      ) : (sections.data ?? []).length === 0 ? (
        <EmptyState
          title="Page d’accueil vide"
          description="Commencez par un héros et une collection mise en avant."
          action={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Ajouter un bloc
            </Button>
          }
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {sections.data!.map((section, index) => (
            <li key={section.id}>
              <Card className={cn(!section.live && 'opacity-60')}>
                <CardBody className="flex flex-wrap items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-medium">
                    {index + 1}
                  </span>

                  {section.mediaUrl ? (
                    <img
                      src={section.mediaUrl}
                      alt=""
                      className="h-12 w-20 shrink-0 rounded-sm object-cover"
                    />
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {SECTION_LABELS[section.kind] ?? section.kind}
                      {!section.active ? <Badge tone="neutral">masqué</Badge> : null}
                      {section.active && !section.live ? (
                        <Badge tone="info">hors période</Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {section.title ? t(section.title, 'fr') : SECTION_HINTS[section.kind]}
                    </p>
                    {section.startsAt || section.endsAt ? (
                      <p className="text-xs text-muted">
                        {section.startsAt
                          ? `du ${dateTimeFormatter.format(new Date(section.startsAt))}`
                          : ''}
                        {section.endsAt
                          ? ` au ${dateTimeFormatter.format(new Date(section.endsAt))}`
                          : ''}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Monter"
                      disabled={index === 0 || busy}
                      onClick={() => void move(section, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Descendre"
                      disabled={index === sections.data!.length - 1 || busy}
                      onClick={() => void move(section, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={section.active ? 'Masquer' : 'Afficher'}
                      onClick={() => void toggle(section)}
                    >
                      {section.active ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(section)}>
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Retirer"
                      onClick={() => void remove(section)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <HomePreview />

      {editing ? (
        <SectionDialog
          section={editing === 'new' ? null : editing}
          nextPosition={(sections.data ?? []).length}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void sections.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function SectionDialog({
  section,
  nextPosition,
  onClose,
  onSaved,
}: {
  section: HomeSectionDto | null;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<HomeSectionKind>(section?.kind ?? 'featured_collections');
  const [title, setTitle] = useState(section?.title ?? { fr: '' });
  const [subtitle, setSubtitle] = useState(section?.subtitle ?? { fr: '' });
  const [ctaLabel, setCtaLabel] = useState(section?.ctaLabel ?? { fr: '' });
  const [ctaUrl, setCtaUrl] = useState(section?.ctaUrl ?? '');
  const [mediaId, setMediaId] = useState(section?.mediaId ?? '');
  const [mediaUrl, setMediaUrl] = useState(section?.mediaUrl ?? '');
  const [collectionId, setCollectionId] = useState(section?.collectionId ?? '');
  const [active, setActive] = useState(section?.active ?? true);
  const [startsAt, setStartsAt] = useState(section?.startsAt?.slice(0, 16) ?? '');
  const [endsAt, setEndsAt] = useState(section?.endsAt?.slice(0, 16) ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const collections = useCollections();

  const needsCollection = kind === 'featured_collections' || kind === 'lookbook';
  const needsMedia = kind === 'hero_3d' || kind === 'lookbook' || kind === 'brand_story';

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        kind,
        title: title.fr ? title : null,
        subtitle: subtitle.fr ? subtitle : null,
        ctaLabel: ctaLabel.fr ? ctaLabel : null,
        ctaUrl: ctaUrl || null,
        mediaId: mediaId || null,
        collectionId: collectionId || null,
        productId: null,
        config: section?.config ?? null,
        position: section?.position ?? nextPosition,
        active,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      };

      if (section) await content.updateHomeSection(section.id, payload);
      else await content.createHomeSection(payload);

      notify.success(section ? 'Bloc mis à jour' : 'Bloc ajouté');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{section ? 'Modifier le bloc' : 'Nouveau bloc'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Type de bloc" hint={SECTION_HINTS[kind]}>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as HomeSectionKind)}
              options={HOME_SECTION_KINDS.map((value) => ({
                value,
                label: SECTION_LABELS[value] ?? value,
              }))}
            />
          </Field>

          <Field label="Titre">
            <TranslatedInput value={title} onChange={setTitle} />
          </Field>

          <Field label="Sous-titre">
            <TranslatedInput value={subtitle} onChange={setSubtitle} />
          </Field>

          {needsCollection ? (
            <Field label="Collection" required>
              <Select
                value={collectionId}
                onValueChange={setCollectionId}
                options={(collections.data ?? []).map((collection) => ({
                  value: collection.id,
                  label: t(collection.name, 'fr'),
                }))}
                placeholder="Choisir une collection"
              />
            </Field>
          ) : null}

          {needsMedia ? (
            <Field label="Visuel">
              <div className="flex items-center gap-3">
                {mediaUrl ? (
                  <img src={mediaUrl} alt="" className="h-16 w-24 rounded-sm object-cover" />
                ) : null}
                <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                  {mediaId ? 'Changer' : 'Choisir une image'}
                </Button>
                {mediaId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMediaId('');
                      setMediaUrl('');
                    }}
                  >
                    Retirer
                  </Button>
                ) : null}
              </div>
            </Field>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Libellé du bouton">
              <TranslatedInput value={ctaLabel} onChange={setCtaLabel} />
            </Field>
            <Field label="Lien du bouton">
              <Input
                value={ctaUrl}
                onChange={(event) => setCtaUrl(event.target.value)}
                placeholder="/collections/heritage"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Afficher à partir du">
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </Field>
            <Field label="Jusqu’au">
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </Field>
          </div>

          <Alert tone="info" title="Les dates suffisent">
            Un bloc hors de sa période disparaît de la vitrine tout seul. Inutile de penser à le
            désactiver.
          </Alert>

          <SwitchField label="Actif" checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={needsCollection && !collectionId}
            onClick={() => void submit()}
          >
            Enregistrer
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
          const picked = media[0];
          if (picked) {
            setMediaId(picked.id);
            setMediaUrl(picked.url);
          }
          setPickerOpen(false);
        }}
      />
    </Dialog>
  );
}
