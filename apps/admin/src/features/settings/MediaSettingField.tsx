import { Button, Field } from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { MediaPickerDialog } from '@/features/catalog/MediaPickerDialog';
import { api } from '@/lib/api';
import { previewUrl } from '@/lib/media';
import type { SettingField } from './fields';

/**
 * A settings value that points at something in the media library — PRD F-AD-90.
 *
 * The logo, the favicon and the 3D hero model. All three keys have existed in the
 * settings schema since M1 and nothing wrote them, so the shop could not change its own
 * logo without a deploy.
 *
 * The stored value is the media id rather than a URL: the storefront resolves it through
 * the same renditions everything else uses, and moving to a CDN later changes one place.
 */
export function MediaSettingField({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: SettingField;
  value: unknown;
  error?: string;
  disabled: boolean;
  onChange: (next: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const id = typeof value === 'string' && value !== '' ? value : null;

  const media = useQuery({
    queryKey: ['admin', 'media', id],
    queryFn: () =>
      api<{
        id: string;
        url: string;
        filename: string;
        kind: string;
        alt?: string | null;
        renditions?: Array<{ key: string; width: number }> | null;
      }>(`/admin/media/${id}`),
    enabled: Boolean(id),
  });

  const isModel = field.mediaKind === 'MODEL_3D';

  return (
    <Field label={field.label} hint={field.hint} error={error}>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-elevated">
          {!id ? (
            <ImageOff className="h-5 w-5 text-muted" aria-hidden />
          ) : isModel ? (
            // A GLB has no thumbnail worth fetching here; the name is what identifies it.
            <span className="px-1 text-center text-[10px] text-muted">GLB</span>
          ) : media.data ? (
            <img
              src={previewUrl(media.data as never, 160)}
              alt={media.data.alt ?? ''}
              className="h-full w-full object-contain"
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => setPicking(true)}>
              <Upload className="h-4 w-4" />
              {id ? 'Remplacer' : 'Choisir'}
            </Button>

            {id ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange(null)}
                aria-label={`Retirer ${field.label}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>

          {id && media.data ? (
            <p className="truncate text-xs text-muted">{media.data.filename}</p>
          ) : null}
        </div>
      </div>

      {picking ? (
        <MediaPickerDialog
          open={picking}
          onOpenChange={setPicking}
          selectedIds={id ? [id] : []}
          multiple={false}
          kind={field.mediaKind as never}
          onConfirm={(selected) => {
            onChange(selected[0]?.id ?? null);
            setPicking(false);
          }}
        />
      ) : null}
    </Field>
  );
}
