import type { ProductDetail, ProductMediaDto } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  cn,
} from '@jecks/ui';
import { Box, FileText, Film, GripVertical, ImagePlus, Loader2, Star, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { previewUrl } from '@/lib/media';
import { MediaPickerDialog } from './MediaPickerDialog';

/**
 * Media tab of the product editor — PRD F-AD-10.
 *
 * Order matters and is the thing operators most want to control, so the gallery is a
 * drag-to-reorder grid rather than a list with up and down buttons. The first image is
 * the one every grid, every cart line and every social preview uses, which is why it is
 * labelled rather than left to be inferred.
 */
export function ProductMediaTab({
  product,
  mediaIds,
  onChange,
}: {
  product: ProductDetail;
  mediaIds: string[];
  onChange: (mediaIds: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // The product's own media carries the renditions; anything just attached and not yet
  // saved falls back to a placeholder until the next load.
  const byId = useMemo(
    () => new Map(product.media.map((item) => [item.mediaId, item])),
    [product.media],
  );

  const items = mediaIds.map((id) => byId.get(id) ?? placeholderFor(id));
  const processing = items.filter((item) => item.processedAt === null && item.kind === 'IMAGE');

  function move(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const next = mediaIds.filter((id) => id !== sourceId);
    const index = next.indexOf(targetId);
    next.splice(index < 0 ? next.length : index, 0, sourceId);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-5">
      {processing.length > 0 ? (
        <Alert tone="info" title="Traitement en cours">
          {processing.length} image(s) sont encore en train d’être redimensionnées. Elles
          s’afficheront en pleine qualité dès que le traitement sera terminé.
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Galerie</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <ImagePlus className="h-4 w-4" />
            Ajouter des médias
          </Button>
        </CardHeader>
        <CardBody>
          {items.length === 0 ? (
            <EmptyState
              title="Aucun média"
              description="Ajoutez des photos, une vidéo ou un modèle 3D depuis la médiathèque."
              action={
                <Button size="sm" onClick={() => setPickerOpen(true)}>
                  <ImagePlus className="h-4 w-4" />
                  Ajouter des médias
                </Button>
              }
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {items.map((item, index) => (
                <li
                  key={item.mediaId}
                  draggable
                  onDragStart={() => setDragging(item.mediaId)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOver(item.mediaId);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging) move(dragging, item.mediaId);
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-xs border transition-colors',
                    over === item.mediaId && dragging !== item.mediaId
                      ? 'border-brass ring-1 ring-brass'
                      : 'border-line',
                    dragging === item.mediaId && 'opacity-40',
                  )}
                >
                  <MediaThumb item={item} />

                  <span className="absolute start-1 top-1 flex items-center gap-1">
                    <GripVertical
                      className="h-4 w-4 cursor-grab text-base drop-shadow"
                      aria-hidden
                    />
                    {index === 0 ? (
                      <Badge tone="brass">
                        <Star className="h-2.5 w-2.5 fill-current" aria-hidden />
                        Principale
                      </Badge>
                    ) : null}
                  </span>

                  {item.processedAt === null && item.kind === 'IMAGE' ? (
                    <span className="absolute end-1 top-1">
                      <Loader2 className="h-4 w-4 animate-spin text-base drop-shadow" aria-hidden />
                    </span>
                  ) : null}

                  <button
                    type="button"
                    aria-label={`Retirer ${item.fileName}`}
                    onClick={() => onChange(mediaIds.filter((id) => id !== item.mediaId))}
                    className="absolute end-1 bottom-1 rounded-xs bg-ink/70 p-1 text-base opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-sm text-muted">
        Glissez une vignette pour changer l’ordre. La première image sert de visuel principal
        partout : grilles, panier, partages. Le texte alternatif se règle dans la médiathèque, où il
        reste attaché au fichier et profite à tous les produits qui l’utilisent.
      </p>

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedIds={mediaIds}
        onConfirm={(media) => onChange(media.map((item) => item.id))}
      />
    </div>
  );
}

function MediaThumb({ item }: { item: ProductMediaDto }) {
  const src = previewUrl(item, 400);

  if (item.kind === 'IMAGE' || item.posterUrl) {
    return (
      <img
        src={src}
        alt={item.alt?.fr ?? ''}
        loading="lazy"
        className="h-full w-full object-cover"
        style={{ backgroundColor: item.placeholderColor ?? undefined }}
      />
    );
  }

  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-base text-muted">
      {item.kind === 'VIDEO' ? (
        <Film className="h-6 w-6" aria-hidden />
      ) : item.kind === 'MODEL_3D' ? (
        <Box className="h-6 w-6" aria-hidden />
      ) : (
        <FileText className="h-6 w-6" aria-hidden />
      )}
      <span className="max-w-full truncate px-2 text-[10px]">{item.fileName}</span>
    </span>
  );
}

/** A file attached this session, before the product has been reloaded with it. */
function placeholderFor(mediaId: string): ProductMediaDto {
  return {
    mediaId,
    position: 0,
    kind: 'IMAGE',
    url: '',
    posterUrl: null,
    fileName: 'Nouveau fichier',
    alt: null,
    renditions: [],
    placeholderColor: null,
    processedAt: null,
  };
}
