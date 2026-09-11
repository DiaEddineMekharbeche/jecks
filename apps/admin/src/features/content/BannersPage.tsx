import {
  BANNER_PLACEMENTS,
  t,
  type BannerDto,
  type BannerPlacement,
} from '@jecks/shared';
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
  TranslatedInput,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MediaPickerDialog } from '@/features/catalog/MediaPickerDialog';
import { dateTimeFormatter, message } from '@/lib/errors';
import * as content from './api';
import { PLACEMENT_LABELS } from './labels';

/**
 * Banners — PRD F-AD-90.
 *
 * Grouped by where they appear, because that is how somebody thinks about them: "what
 * is on the collection pages right now" rather than "what banners exist".
 */
export function BannersPage() {
  const [editing, setEditing] = useState<BannerDto | 'new' | null>(null);

  const banners = useQuery({
    queryKey: ['admin', 'banners'],
    queryFn: content.listBanners,
  });

  async function remove(banner: BannerDto) {
    if (!window.confirm(`Supprimer « ${banner.name} » ?`)) return;
    try {
      await content.deleteBanner(banner.id);
      notify.success('Bannière supprimée');
      await banners.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  const grouped = new Map<string, BannerDto[]>();
  for (const banner of banners.data ?? []) {
    const list = grouped.get(banner.placement) ?? [];
    list.push(banner);
    grouped.set(banner.placement, list);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Bannières"
        description="Les visuels promotionnels, par emplacement."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Nouvelle bannière
          </Button>
        }
      />

      {banners.isLoading ? (
        <Skeleton className="h-64" label="Chargement des bannières" />
      ) : (banners.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucune bannière"
          description="Une bannière avec une date de fin disparaît toute seule."
          action={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Nouvelle bannière
            </Button>
          }
        />
      ) : (
        [...grouped.entries()].map(([placement, list]) => (
          <Card key={placement}>
            <CardHeader>
              <CardTitle>{PLACEMENT_LABELS[placement] ?? placement}</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <ul className="divide-y divide-line">
                {list.map((banner) => (
                  <li
                    key={banner.id}
                    className={cn('flex flex-wrap items-center gap-3 px-4 py-3', !banner.live && 'opacity-60')}
                  >
                    {banner.mediaUrl ? (
                      <img
                        src={banner.mediaUrl}
                        alt=""
                        className="h-12 w-20 shrink-0 rounded-sm object-cover"
                      />
                    ) : (
                      <span className="h-12 w-20 shrink-0 rounded-sm bg-elevated" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium text-ink">
                        {banner.name}
                        {!banner.active ? <Badge tone="neutral">inactive</Badge> : null}
                        {banner.active && !banner.live ? (
                          <Badge tone="info">hors période</Badge>
                        ) : null}
                      </p>
                      <p className="truncate text-sm text-muted">
                        {banner.title ? t(banner.title, 'fr') : '—'}
                      </p>
                      {banner.endsAt ? (
                        <p className="text-xs text-muted">
                          jusqu’au {dateTimeFormatter.format(new Date(banner.endsAt))}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(banner)}>
                        Modifier
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Supprimer"
                        onClick={() => void remove(banner)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))
      )}

      {editing ? (
        <BannerDialog
          banner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void banners.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function BannerDialog({
  banner,
  onClose,
  onSaved,
}: {
  banner: BannerDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(banner?.name ?? '');
  const [placement, setPlacement] = useState<BannerPlacement>(banner?.placement ?? 'home_hero');
  const [title, setTitle] = useState(banner?.title ?? { fr: '' });
  const [subtitle, setSubtitle] = useState(banner?.subtitle ?? { fr: '' });
  const [ctaLabel, setCtaLabel] = useState(banner?.ctaLabel ?? { fr: '' });
  const [ctaUrl, setCtaUrl] = useState(banner?.ctaUrl ?? '');
  const [mediaId, setMediaId] = useState(banner?.mediaId ?? '');
  const [mediaUrl, setMediaUrl] = useState(banner?.mediaUrl ?? '');
  const [active, setActive] = useState(banner?.active ?? true);
  const [startsAt, setStartsAt] = useState(banner?.startsAt?.slice(0, 16) ?? '');
  const [endsAt, setEndsAt] = useState(banner?.endsAt?.slice(0, 16) ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        placement,
        title: title.fr ? title : null,
        subtitle: subtitle.fr ? subtitle : null,
        ctaLabel: ctaLabel.fr ? ctaLabel : null,
        ctaUrl: ctaUrl || null,
        mediaId: mediaId || null,
        position: banner?.position ?? 0,
        active,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      };

      if (banner) await content.updateBanner(banner.id, payload);
      else await content.createBanner(payload);

      notify.success(banner ? 'Bannière mise à jour' : 'Bannière créée');
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
          <DialogTitle>{banner ? banner.name : 'Nouvelle bannière'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom interne" required hint="Pour la retrouver ici ; jamais affiché.">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>

          <Field label="Emplacement" required>
            <Select
              value={placement}
              onValueChange={(value) => setPlacement(value as BannerPlacement)}
              options={BANNER_PLACEMENTS.map((value) => ({
                value,
                label: PLACEMENT_LABELS[value] ?? value,
              }))}
            />
          </Field>

          <Field label="Visuel">
            <div className="flex items-center gap-3">
              {mediaUrl ? (
                <img src={mediaUrl} alt="" className="h-16 w-24 rounded-sm object-cover" />
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                {mediaId ? 'Changer' : 'Choisir une image'}
              </Button>
            </div>
          </Field>

          <Field label="Titre">
            <TranslatedInput value={title} onChange={setTitle} />
          </Field>

          <Field label="Sous-titre">
            <TranslatedInput value={subtitle} onChange={setSubtitle} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Libellé du bouton">
              <TranslatedInput value={ctaLabel} onChange={setCtaLabel} />
            </Field>
            <Field label="Lien">
              <Input value={ctaUrl} onChange={(event) => setCtaUrl(event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="À partir du">
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

          <SwitchField label="Active" checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
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
