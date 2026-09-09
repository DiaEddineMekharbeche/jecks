import {
  MAX_BYTES_BY_KIND,
  UPLOAD_ACCEPT,
  pickRendition,
  type MediaDto,
  type MediaFolderDto,
} from '@jecks/shared';
import {
  Badge,
  Button,
  DescriptionList,
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
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  TablePagination,
  TranslatedInput,
  cn,
  notify,
} from '@jecks/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Box,
  FileText,
  Film,
  FolderPlus,
  ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ApiRequestError, api, getAccessToken } from '@/lib/api';
import { renditionUrl } from '@/lib/media';
import { useServerTable } from '@/lib/server-table';

/**
 * Media library — PRD F-AD-10.
 *
 * A grid rather than a table: staff recognise a photo, not a filename. Files still
 * processing show a spinner, and a file that failed shows why with a retry, because a
 * silently broken upload is discovered weeks later on the storefront.
 */

const KIND_ICONS = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  MODEL_3D: Box,
  DOCUMENT: FileText,
} as const;

const KIND_LABELS = {
  IMAGE: 'Images',
  VIDEO: 'Vidéos',
  MODEL_3D: 'Modèles 3D',
  DOCUMENT: 'Documents',
} as const;

export function MediaLibraryPage() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const table = useServerTable<MediaDto>({
    module: 'media',
    endpoint: '/admin/media',
    defaultSort: 'createdAt',
    defaultPageSize: 50,
    filterKeys: ['kind', 'folderId', 'unusedOnly'],
  });

  const [selected, setSelected] = useState<MediaDto | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');

  const { data: folders = [] } = useQuery({
    queryKey: ['admin', 'media', 'folders'],
    queryFn: () => api<MediaFolderDto[]>('/admin/media/folders'),
    staleTime: 5 * 60_000,
  });

  const activeKind = table.filters.kind?.[0];
  const activeFolder = table.filters.folderId?.[0];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'media'] });
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;

    const tooBig = files.filter((file) => file.size > MAX_BYTES_BY_KIND.VIDEO);
    const usable = files.filter((file) => !tooBig.includes(file));
    for (const file of tooBig) notify.error(`${file.name} dépasse la taille maximale`);
    if (usable.length === 0) return;

    setUploading(usable.length);

    const form = new FormData();
    for (const file of usable) form.append('files', file);
    if (activeFolder && activeFolder !== 'root') form.append('folderId', activeFolder);

    try {
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
      const token = getAccessToken();
      // FormData goes through fetch directly: the JSON client would set a Content-Type
      // and strip the multipart boundary.
      const response = await fetch(`${base}/admin/media`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      const payload = (await response.json()) as {
        data?: MediaDto[];
        meta?: { uploaded: number; failed: Array<{ fileName: string; message: string }> };
        error?: { message: string };
      };

      if (!response.ok) throw new Error(payload.error?.message ?? "L'envoi a échoué");

      const uploaded = payload.meta?.uploaded ?? 0;
      if (uploaded > 0) notify.success(`${uploaded} fichier${uploaded > 1 ? 's' : ''} envoyé${uploaded > 1 ? 's' : ''}`);
      for (const failure of payload.meta?.failed ?? []) {
        notify.error(`${failure.fileName} : ${failure.message}`);
      }
      refresh();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "L'envoi a échoué");
    } finally {
      setUploading(0);
    }
  }

  const removeMutation = useMutation({
    mutationFn: (id: string) => api<void>(`/admin/media/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      notify.success('Fichier supprimé');
      setSelected(null);
      refresh();
    },
    onError: (error) => {
      const message =
        error instanceof ApiRequestError && error.code === 'MEDIA_IN_USE'
          ? 'Ce fichier est encore utilisé. Retirez-le d’abord des produits concernés.'
          : error instanceof Error
            ? error.message
            : 'Suppression impossible';
      notify.error(message);
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: (id: string) => api<MediaDto>(`/admin/media/${id}/reprocess`, { method: 'POST' }),
    onSuccess: () => {
      notify.info('Traitement relancé');
      refresh();
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      api<MediaFolderDto>('/admin/media/folders', { method: 'POST', body: { name } }),
    onSuccess: () => {
      notify.success('Dossier créé');
      setFolderOpen(false);
      setFolderName('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'media', 'folders'] });
    },
    onError: (error) => notify.error(error instanceof Error ? error.message : 'Création impossible'),
  });

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    void uploadFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Médiathèque"
        description="Photos, vidéos, modèles 3D et documents. Les images sont converties en WebP et AVIF automatiquement."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setFolderOpen(true)}>
              <FolderPlus className="h-4 w-4" />
              Nouveau dossier
            </Button>
            <Button size="sm" loading={uploading > 0} onClick={() => inputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Envoyer
            </Button>
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        onChange={handlePick}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            className="h-9 w-56 ps-9"
            placeholder="Nom du fichier…"
            defaultValue={table.search}
            onChange={(event) => table.setSearch(event.target.value)}
            aria-label="Rechercher un fichier"
          />
        </div>

        <Select
          className="h-9 w-40"
          value={activeKind ?? 'all'}
          onValueChange={(value) => table.setFilter('kind', value === 'all' ? [] : [value])}
          options={[
            { value: 'all', label: 'Tous les types' },
            ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />

        <Select
          className="h-9 w-48"
          value={activeFolder ?? 'all'}
          onValueChange={(value) => table.setFilter('folderId', value === 'all' ? [] : [value])}
          options={[
            { value: 'all', label: 'Tous les dossiers' },
            { value: 'root', label: 'Racine' },
            ...folders.map((folder) => ({
              value: folder.id,
              label: `${folder.name} (${folder.mediaCount})`,
            })),
          ]}
        />

        <Button
          variant={table.filters.unusedOnly?.[0] === 'true' ? 'primary' : 'outline'}
          size="sm"
          onClick={() =>
            table.setFilter('unusedOnly', table.filters.unusedOnly?.[0] === 'true' ? [] : ['true'])
          }
        >
          Inutilisés
        </Button>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'rounded-sm border-2 border-dashed p-4 transition-colors',
          dragOver ? 'border-brass bg-brass/5' : 'border-transparent',
        )}
      >
        {table.loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }, (_, index) => (
              <Skeleton key={index} className="aspect-square rounded-sm" />
            ))}
          </div>
        ) : table.rows.length === 0 ? (
          <EmptyState
            icon={<ImageIcon className="h-8 w-8" />}
            title="Aucun fichier"
            description="Glissez des fichiers ici, ou utilisez le bouton Envoyer."
            action={
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                Choisir des fichiers
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {table.rows.map((media) => (
              <li key={media.id}>
                <MediaTile media={media} onOpen={() => setSelected(media)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <TablePagination
        page={table.page}
        pageSize={table.pageSize}
        total={table.total}
        loading={table.fetching}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />

      <MediaDetailsSheet
        media={selected}
        onClose={() => setSelected(null)}
        onDelete={(id) => removeMutation.mutate(id)}
        onReprocess={(id) => reprocessMutation.mutate(id)}
        deleting={removeMutation.isPending}
        onSaved={refresh}
      />

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau dossier</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field label="Nom" required>
              <Input
                autoFocus
                value={folderName}
                placeholder="Campagne été"
                onChange={(event) => setFolderName(event.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFolderOpen(false)}>
              Annuler
            </Button>
            <Button
              disabled={!folderName.trim()}
              loading={createFolderMutation.isPending}
              onClick={() => createFolderMutation.mutate(folderName.trim())}
            >
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MediaTile({ media, onOpen }: { media: MediaDto; onOpen: () => void }) {
  const Icon = KIND_ICONS[media.kind];
  const thumb = pickRendition(media.renditions, 200)?.key;
  const preview = thumb
    ? renditionUrl(media.url, thumb)
    : media.kind === 'IMAGE'
      ? media.url
      : media.posterUrl;

  const processing = media.processedAt === null && !media.processingError;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col overflow-hidden rounded-sm border border-line bg-surface text-start transition-colors hover:border-brass"
    >
      <div
        className="relative aspect-square w-full"
        style={{ backgroundColor: media.placeholderColor ?? 'rgb(var(--jk-elevated))' }}
      >
        {preview ? (
          <img
            src={preview}
            alt={media.alt?.fr ?? media.fileName}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted">
            <Icon className="h-7 w-7" aria-hidden />
          </span>
        )}

        {processing ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="h-5 w-5 animate-spin text-brass" aria-label="Traitement en cours" />
          </span>
        ) : null}

        {media.processingError ? (
          <span className="absolute inset-0 flex items-center justify-center bg-danger/70">
            <AlertTriangle className="h-5 w-5 text-white" aria-label="Échec du traitement" />
          </span>
        ) : null}

        {media.usageCount === 0 && !processing ? (
          <Badge tone="neutral" className="absolute end-1.5 top-1.5">
            inutilisé
          </Badge>
        ) : null}
      </div>

      <span className="flex items-center gap-1.5 border-t border-line px-2 py-1.5">
        <Icon className="h-3 w-3 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs text-muted" title={media.fileName}>
          {media.fileName}
        </span>
      </span>
    </button>
  );
}

function MediaDetailsSheet({
  media,
  onClose,
  onDelete,
  onReprocess,
  deleting,
  onSaved,
}: {
  media: MediaDto | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onReprocess: (id: string) => void;
  deleting: boolean;
  onSaved: () => void;
}) {
  const [alt, setAlt] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (id: string) => api<MediaDto>(`/admin/media/${id}`, { method: 'PATCH', body: { alt } }),
    onSuccess: () => {
      notify.success('Texte alternatif enregistré');
      setDirty(false);
      onSaved();
    },
    onError: (error) => notify.error(error instanceof Error ? error.message : 'Enregistrement impossible'),
  });

  if (!media) return null;

  const savings =
    media.originalSizeBytes && media.originalSizeBytes > media.sizeBytes
      ? Math.round((1 - media.sizeBytes / media.originalSizeBytes) * 100)
      : null;

  return (
    <Sheet
      open={Boolean(media)}
      onOpenChange={(open) => {
        if (!open) {
          setDirty(false);
          setAlt({});
          onClose();
        }
      }}
    >
      <SheetContent width="w-[min(32rem,95vw)]">
        <SheetHeader>
          <SheetTitle className="truncate pe-8">{media.fileName}</SheetTitle>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-5">
          <div
            className="overflow-hidden rounded-sm"
            style={{ backgroundColor: media.placeholderColor ?? 'rgb(var(--jk-elevated))' }}
          >
            {media.kind === 'IMAGE' ? (
              <img src={media.url} alt={media.alt?.fr ?? media.fileName} className="w-full" />
            ) : media.posterUrl ? (
              <img src={media.posterUrl} alt={media.fileName} className="w-full" />
            ) : (
              <div className="flex aspect-video items-center justify-center text-muted">
                {KIND_LABELS[media.kind]}
              </div>
            )}
          </div>

          {media.processingError ? (
            <div className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-sm">
              <p className="font-medium text-danger">Le traitement a échoué</p>
              <p className="mt-1 text-muted">{media.processingError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => onReprocess(media.id)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Réessayer
              </Button>
            </div>
          ) : null}

          <Field
            label="Texte alternatif"
            hint="Décrit l’image pour les lecteurs d’écran et pour Google."
          >
            <TranslatedInput
              value={dirty ? alt : (media.alt ?? {})}
              onChange={(value) => {
                setAlt(value as Record<string, string>);
                setDirty(true);
              }}
              multiline
              rows={2}
            />
          </Field>

          {dirty ? (
            <Button
              size="sm"
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate(media.id)}
            >
              Enregistrer
            </Button>
          ) : null}

          <DescriptionList
            items={[
              { label: 'Type', value: media.mimeType },
              {
                label: 'Dimensions',
                value: media.width && media.height ? `${media.width} × ${media.height}` : '—',
              },
              {
                label: 'Taille',
                value: (
                  <span>
                    {formatBytes(media.sizeBytes)}
                    {savings ? <span className="text-success"> (−{savings} %)</span> : null}
                  </span>
                ),
              },
              { label: 'Déclinaisons', value: media.renditions.length || '—' },
              {
                label: 'Utilisé par',
                value:
                  media.usageCount === 0 ? (
                    <span className="text-muted">rien</span>
                  ) : (
                    `${media.usageCount} élément${media.usageCount > 1 ? 's' : ''}`
                  ),
              },
              { label: 'Ajouté le', value: new Date(media.createdAt).toLocaleDateString('fr-DZ') },
            ]}
          />

          {media.renditions.length > 0 ? (
            <div>
              <p className="eyebrow mb-2">Déclinaisons générées</p>
              <ul className="divide-y divide-line text-sm">
                {media.renditions.map((rendition) => (
                  <li key={rendition.key} className="flex justify-between py-1.5">
                    <span className="text-muted">
                      {rendition.name} · {rendition.format}
                    </span>
                    <span className="tabular-nums">
                      {rendition.width}×{rendition.height} · {formatBytes(rendition.sizeBytes)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button
            variant="danger"
            size="sm"
            loading={deleting}
            disabled={media.usageCount > 0}
            title={media.usageCount > 0 ? 'Ce fichier est encore utilisé' : undefined}
            onClick={() => onDelete(media.id)}
          >
            <Trash2 className="h-4 w-4" />
            Supprimer
          </Button>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
