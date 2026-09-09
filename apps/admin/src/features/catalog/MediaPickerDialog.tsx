import { UPLOAD_ACCEPT, type MediaDto } from '@jecks/shared';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Skeleton,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Check, FileText, Film, Search, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, getAccessToken } from '@/lib/api';
import { previewUrl } from '@/lib/media';

/**
 * Picks files from the media library — PRD F-AD-10.
 *
 * The product editor never uploads into a void: files land in the library first, where
 * they are processed, deduplicated and reusable, and are then attached here. Uploading
 * from inside this dialog is a shortcut through the same endpoint, not a second path.
 */
export function MediaPickerDialog({
  open,
  onOpenChange,
  selectedIds,
  multiple = true,
  kind,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  multiple?: boolean;
  /** Restricts the grid, e.g. to images for a category banner. */
  kind?: MediaDto['kind'];
  onConfirm: (media: MediaDto[]) => void;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>(selectedIds);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media', 'picker', search, kind ?? 'all'],
    queryFn: () =>
      api<MediaDto[]>('/admin/media', {
        query: {
          pageSize: 60,
          sort: 'createdAt',
          ...(search ? { q: search } : {}),
          // The media list takes `kind` as a plain parameter, not through `filter[...]`.
          ...(kind ? { kind } : {}),
        },
      }),
    enabled: open,
  });

  const media = data ?? [];

  function toggle(id: string) {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      return multiple ? [...current, id] : [id];
    });
  }

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
      const form = new FormData();
      for (const file of files) form.append('files', file);

      const token = getAccessToken();
      const response = await fetch(`${base}/admin/media`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: MediaDto[];
        meta?: { failed?: Array<{ fileName: string; message: string }> };
        error?: { message?: string };
      } | null;

      if (!response.ok) throw new Error(payload?.error?.message ?? "L'envoi a échoué");

      for (const failure of payload?.meta?.failed ?? []) {
        notify.error(`${failure.fileName} : ${failure.message}`);
      }

      const created = payload?.data ?? [];
      if (created.length > 0) {
        notify.success(`${created.length} fichier(s) ajouté(s)`);
        // Newly uploaded files are almost always the ones being attached.
        setPicked((current) =>
          multiple ? [...current, ...created.map((item) => item.id)] : [created[0]!.id],
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['admin', 'media'] });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "L'envoi a échoué");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function confirm() {
    const byId = new Map(media.map((item) => [item.id, item]));
    // Preserves the order the operator clicked in, which becomes the gallery order.
    onConfirm(picked.map((id) => byId.get(id)).filter((item): item is MediaDto => Boolean(item)));
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPicked(selectedIds);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Choisir des médias</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-48">
              <Search
                className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                className="h-9 ps-9"
                placeholder="Rechercher un fichier…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Rechercher un média"
              />
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple={multiple}
              accept={UPLOAD_ACCEPT}
              className="hidden"
              onChange={(event) => void upload(Array.from(event.target.files ?? []))}
            />
            <Button
              variant="outline"
              size="sm"
              loading={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Envoyer
            </Button>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {Array.from({ length: 10 }, (_, index) => (
                <Skeleton key={index} className="aspect-square" label="Chargement des médias" />
              ))}
            </div>
          ) : media.length === 0 ? (
            <EmptyState
              title="Aucun fichier"
              description="Envoyez une image, une vidéo ou un modèle 3D pour commencer."
            />
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {media.map((item) => (
                <MediaTile
                  key={item.id}
                  media={item}
                  selected={picked.includes(item.id)}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <span className="me-auto text-sm text-muted">
            {picked.length} sélectionné{picked.length > 1 ? 's' : ''}
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={confirm}>Attacher</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaTile({
  media,
  selected,
  onToggle,
}: {
  media: MediaDto;
  selected: boolean;
  onToggle: () => void;
}) {
  const src = previewUrl(media, 200);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-xs border transition-colors',
        selected ? 'border-brass ring-1 ring-brass' : 'border-line hover:border-brass/60',
      )}
      style={{ backgroundColor: media.placeholderColor ?? undefined }}
    >
      {media.kind === 'IMAGE' || media.posterUrl ? (
        <img
          src={src}
          alt={media.alt?.fr ?? ''}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted">
          {media.kind === 'VIDEO' ? (
            <Film className="h-6 w-6" aria-hidden />
          ) : media.kind === 'MODEL_3D' ? (
            <Box className="h-6 w-6" aria-hidden />
          ) : (
            <FileText className="h-6 w-6" aria-hidden />
          )}
        </span>
      )}

      {selected ? (
        <span className="absolute end-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brass text-base">
          <Check className="h-3 w-3" aria-hidden />
        </span>
      ) : null}

      <span className="absolute inset-x-0 bottom-0 truncate bg-ink/70 px-1.5 py-1 text-[10px] text-base">
        {media.fileName}
      </span>
    </button>
  );
}
