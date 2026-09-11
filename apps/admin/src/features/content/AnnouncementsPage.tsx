import { t, type AnnouncementDto } from '@jecks/shared';
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
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { dateTimeFormatter, message } from '@/lib/errors';
import * as content from './api';

/**
 * The strip above the header — PRD F-AD-90.
 *
 * Free delivery thresholds, holiday closures, a sale that ends tonight. Each carries its
 * own window, so a message about Ramadan hours stops being shown when Ramadan ends
 * without anybody having to remember.
 */
export function AnnouncementsPage() {
  const [editing, setEditing] = useState<AnnouncementDto | 'new' | null>(null);

  const announcements = useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: content.listAnnouncements,
  });

  async function remove(announcement: AnnouncementDto) {
    if (!window.confirm('Supprimer cette annonce ?')) return;
    try {
      await content.deleteAnnouncement(announcement.id);
      notify.success('Annonce supprimée');
      await announcements.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Annonces"
        description="Le bandeau au-dessus de l’en-tête de la boutique."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Nouvelle annonce
          </Button>
        }
      />

      {announcements.isLoading ? (
        <Skeleton className="h-40" label="Chargement des annonces" />
      ) : (announcements.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucune annonce"
          description="« Livraison offerte dès 6 000 DA » est un bon début."
          action={
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Nouvelle annonce
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {announcements.data!.map((announcement) => (
            <Card key={announcement.id} className={cn(!announcement.live && 'opacity-60')}>
              <CardBody className="flex flex-col gap-3">
                {/* Rendered as the shopper would see it, colours included. */}
                <div
                  className="rounded-sm px-4 py-2 text-center text-sm"
                  style={{
                    background: announcement.bgColor ?? 'var(--color-elevated)',
                    color: announcement.textColor ?? 'var(--color-ink)',
                  }}
                >
                  {t(announcement.message, 'fr')}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!announcement.active ? <Badge tone="neutral">inactive</Badge> : null}
                  {announcement.active && !announcement.live ? (
                    <Badge tone="info">hors période</Badge>
                  ) : null}
                  {announcement.startsAt || announcement.endsAt ? (
                    <span className="text-xs text-muted">
                      {announcement.startsAt
                        ? `du ${dateTimeFormatter.format(new Date(announcement.startsAt))}`
                        : ''}
                      {announcement.endsAt
                        ? ` au ${dateTimeFormatter.format(new Date(announcement.endsAt))}`
                        : ''}
                    </span>
                  ) : null}
                  {announcement.linkUrl ? (
                    <span className="truncate text-xs text-muted">→ {announcement.linkUrl}</span>
                  ) : null}

                  <div className="ms-auto flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(announcement)}>
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Supprimer"
                      onClick={() => void remove(announcement)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {editing ? (
        <AnnouncementDialog
          announcement={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void announcements.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function AnnouncementDialog({
  announcement,
  onClose,
  onSaved,
}: {
  announcement: AnnouncementDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(announcement?.message ?? { fr: '' });
  const [linkUrl, setLinkUrl] = useState(announcement?.linkUrl ?? '');
  const [bgColor, setBgColor] = useState(announcement?.bgColor ?? '#1B2A45');
  const [textColor, setTextColor] = useState(announcement?.textColor ?? '#FFFFFF');
  const [active, setActive] = useState(announcement?.active ?? true);
  const [startsAt, setStartsAt] = useState(announcement?.startsAt?.slice(0, 16) ?? '');
  const [endsAt, setEndsAt] = useState(announcement?.endsAt?.slice(0, 16) ?? '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        message: text,
        linkUrl: linkUrl || null,
        bgColor,
        textColor,
        position: announcement?.position ?? 0,
        active,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      };

      if (announcement) await content.updateAnnouncement(announcement.id, payload);
      else await content.createAnnouncement(payload);

      notify.success(announcement ? 'Annonce mise à jour' : 'Annonce créée');
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
          <DialogTitle>{announcement ? 'Modifier l’annonce' : 'Nouvelle annonce'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Message" required>
            <TranslatedInput value={text} onChange={setText} />
          </Field>

          <div
            className="rounded-sm px-4 py-2 text-center text-sm"
            style={{ background: bgColor, color: textColor }}
          >
            {text.fr || 'Aperçu'}
          </div>

          <Field label="Lien">
            <Input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="/collections/soldes"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fond">
              <Input
                type="color"
                value={bgColor}
                onChange={(event) => setBgColor(event.target.value)}
                className="h-10 p-1"
              />
            </Field>
            <Field label="Texte">
              <Input
                type="color"
                value={textColor}
                onChange={(event) => setTextColor(event.target.value)}
                className="h-10 p-1"
              />
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
          <Button loading={busy} disabled={!text.fr?.trim()} onClick={() => void submit()}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
