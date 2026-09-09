'use client';

import { AlertCircle, GripVertical, Loader2, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';

/**
 * Multi-file upload with drag-and-drop reordering — PRD F-AD-10 media.
 *
 * The component owns presentation and ordering only. Uploading is the caller's job, so
 * the same control serves product media, expense attachments and delivery proof photos
 * without knowing about any of them.
 */

export interface UploadItem {
  id: string;
  name: string;
  /** Object URL or the stored media URL once the upload finishes. */
  previewUrl?: string | null;
  sizeBytes?: number;
  /** 0-100 while uploading, undefined once done. */
  progress?: number;
  error?: string | null;
}

export interface FileDropzoneProps {
  items: UploadItem[];
  onFilesSelected: (files: File[]) => void;
  onRemove?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeBytes?: number;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function FileDropzone({
  items,
  onFilesSelected,
  onRemove,
  onReorder,
  accept = 'image/*',
  multiple = true,
  maxSizeBytes,
  hint,
  disabled = false,
  className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);

  const accept_ = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const files: File[] = [];
      const tooBig: string[] = [];
      for (const file of Array.from(fileList)) {
        if (maxSizeBytes && file.size > maxSizeBytes) tooBig.push(file.name);
        else files.push(file);
      }
      setRejected(tooBig);
      if (files.length > 0) onFilesSelected(files);
    },
    [maxSizeBytes, onFilesSelected],
  );

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (disabled) return;
    accept_(event.dataTransfer.files);
  }

  function handleItemDrop(targetId: string) {
    if (!dragId || !onReorder || dragId === targetId) return;
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    onReorder(ids);
    setDragId(null);
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed p-8 text-center transition-colors',
          dragOver ? 'border-brass bg-brass/5' : 'border-line',
          disabled && 'opacity-50',
        )}
      >
        <Upload className="h-6 w-6 text-muted" aria-hidden />
        <p className="text-sm text-muted">
          Glissez vos fichiers ici, ou{' '}
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="text-brass underline-offset-4 hover:underline"
          >
            parcourez
          </button>
        </p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            accept_(event.target.files);
            // Reset so re-picking the same file still fires a change.
            event.target.value = '';
          }}
        />
      </div>

      {rejected.length > 0 ? (
        <p className="flex items-start gap-2 text-xs text-danger" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Trop volumineux, ignoré : {rejected.join(', ')}
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li
              key={item.id}
              draggable={Boolean(onReorder)}
              onDragStart={() => setDragId(item.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleItemDrop(item.id)}
              className={cn(
                'group relative overflow-hidden rounded-sm border border-line bg-elevated',
                dragId === item.id && 'opacity-40',
              )}
            >
              <div className="relative aspect-square">
                {item.previewUrl ? (
                  // Plain <img>: the source is an object URL or an already-sized
                  // rendition, so an image component would add nothing here.
                  <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted">
                    {item.name.split('.').pop()?.toUpperCase()}
                  </div>
                )}

                {item.progress !== undefined && item.progress < 100 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
                    <Loader2 className="h-5 w-5 animate-spin text-brass" />
                    <div className="h-1 w-3/4 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full bg-brass transition-[width]"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                {item.error ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-danger/80 p-2 text-center text-xs text-white">
                    {item.error}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
                {onReorder ? (
                  <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted" aria-hidden />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-xs text-muted" title={item.name}>
                  {item.name}
                </span>
                {onRemove ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    aria-label={`Retirer ${item.name}`}
                    onClick={() => onRemove(item.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
