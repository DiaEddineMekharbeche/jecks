'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn';
import { Kbd } from './data-display';

/**
 * Command palette — PRD Section 9.3: reach any order, product or customer in two
 * keystrokes. Filtering is delegated to the caller (`shouldFilter={false}`) because the
 * results come from the server, not from a static list held in the browser.
 */

export const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(function Command({ className, ...props }, ref) {
  return (
    <CommandPrimitive
      ref={ref}
      className={cn('flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface', className)}
      {...props}
    />
  );
});

export const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(function CommandInput({ className, ...props }, ref) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4">
      <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <CommandPrimitive.Input
        ref={ref}
        className={cn(
          'h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted/70',
          className,
        )}
        {...props}
      />
    </div>
  );
});

export const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(function CommandList({ className, ...props }, ref) {
  return (
    <CommandPrimitive.List
      ref={ref}
      className={cn('max-h-80 overflow-y-auto overflow-x-hidden p-1', className)}
      {...props}
    />
  );
});

export const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(function CommandEmpty(props, ref) {
  return <CommandPrimitive.Empty ref={ref} className="py-8 text-center text-sm text-muted" {...props} />;
});

export const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={ref}
      className={cn(
        'overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted',
        className,
      )}
      {...props}
    />
  );
});

export const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(function CommandItem({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2.5 rounded-xs px-2.5 py-2 text-sm text-muted outline-none',
        'data-[selected=true]:bg-elevated data-[selected=true]:text-ink',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  );
});

export const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(function CommandSeparator({ className, ...props }, ref) {
  return <CommandPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-line', className)} {...props} />;
});

/** The palette itself: a modal dialog wrapping a Command. */
export function CommandDialog({
  open,
  onOpenChange,
  children,
  label = 'Recherche rapide',
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="fixed start-1/2 top-[15vh] z-50 w-[min(40rem,92vw)] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface shadow-card rtl:translate-x-1/2"
          aria-label={label}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          <Command shouldFilter={false} {...props}>
            {children}
          </Command>
          <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> naviguer
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> ouvrir
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> fermer
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Binds ⌘K / Ctrl+K. Ignores the shortcut while the user is typing in a field, so it
 * cannot steal a keystroke mid-form.
 */
export function useCommandPalette(): {
  open: boolean;
  setOpen: (open: boolean) => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (typing && !open) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return { open, setOpen };
}
