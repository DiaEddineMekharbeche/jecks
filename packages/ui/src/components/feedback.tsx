'use client';

import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import type { ReactNode } from 'react';

/**
 * Toasts. PRD Section 9.3 asks that every save confirms and offers undo where feasible,
 * so `notify.success` takes an optional undo action rather than leaving each caller to
 * invent one.
 *
 * Mount `<Toaster />` once at the app root.
 */

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      // Colours come from the tokens, so the toast matches whichever surface is active.
      toastOptions={{
        classNames: {
          toast:
            'group rounded-sm border border-line bg-surface text-ink shadow-card text-sm p-4 flex gap-3 items-start',
          title: 'font-medium',
          description: 'text-muted text-xs mt-0.5',
          actionButton: 'rounded-xs bg-brass text-on-brass px-2.5 py-1 text-xs font-medium',
          cancelButton: 'rounded-xs bg-elevated text-muted px-2.5 py-1 text-xs',
          error: 'border-danger/50',
          success: 'border-success/50',
          warning: 'border-warning/50',
        },
      }}
      // Long enough to catch an undo, short enough not to stack up during bulk edits.
      duration={5000}
      closeButton
    />
  );
}

export interface NotifyOptions {
  description?: ReactNode;
  /** Renders an Undo button; the toast stays until it is dismissed or acted on. */
  undo?: () => void | Promise<void>;
  duration?: number;
}

function withUndo(options?: NotifyOptions) {
  if (!options?.undo) return { description: options?.description, duration: options?.duration };
  return {
    description: options.description,
    duration: options.duration ?? 8000,
    action: { label: 'Annuler', onClick: () => void options.undo?.() },
  };
}

export const notify = {
  success(message: string, options?: NotifyOptions) {
    return sonnerToast.success(message, withUndo(options));
  },
  error(message: string, options?: NotifyOptions) {
    // Errors stay until dismissed: a failure that vanishes is a failure nobody fixes.
    return sonnerToast.error(message, { ...withUndo(options), duration: options?.duration ?? 10_000 });
  },
  warning(message: string, options?: NotifyOptions) {
    return sonnerToast.warning(message, withUndo(options));
  },
  info(message: string, options?: NotifyOptions) {
    return sonnerToast(message, withUndo(options));
  },
  /** Ties a toast to a request: pending, then success or the server's message. */
  promise<T>(
    promise: Promise<T>,
    messages: { loading: string; success: string | ((value: T) => string); error?: string },
  ) {
    return sonnerToast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: (cause: unknown) =>
        messages.error ?? (cause instanceof Error ? cause.message : 'Une erreur est survenue'),
    });
  },
  dismiss(id?: string | number) {
    sonnerToast.dismiss(id);
  },
};
