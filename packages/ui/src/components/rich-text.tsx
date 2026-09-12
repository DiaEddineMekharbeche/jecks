'use client';

import { Suspense, lazy, type ComponentProps } from 'react';
import { cn } from '../lib/cn';

/**
 * The lazy boundary around the editor — PRD Section 2.1.
 *
 * TipTap and ProseMirror are about a quarter of the admin's JavaScript and are used on
 * two screens: the CMS page editor and the product description. Loaded eagerly they sit
 * in the main chunk and every operator pays for them on the orders list, which is the
 * screen somebody keeps open all day.
 *
 * Everything importing the editor goes through here, so the split holds by construction
 * rather than by everybody remembering to import the right file.
 */

const Editor = lazy(async () => {
  const module = await import('./rich-text-editor');
  return { default: module.RichTextEditor };
});

export type RichTextEditorProps = ComponentProps<typeof Editor>;

export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense fallback={<EditorSkeleton className={props.className} />}>
      <Editor {...props} />
    </Suspense>
  );
}

function EditorSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('h-56 animate-pulse rounded-sm border border-line bg-elevated/40', className)}
      aria-busy="true"
      aria-label="Chargement de l’éditeur"
    />
  );
}

/**
 * The URL check, kept out of the lazy chunk.
 *
 * A caller validating a link should not have to pull in a rich-text editor to do it.
 */
export { isSafeUrl } from './url-safety';
