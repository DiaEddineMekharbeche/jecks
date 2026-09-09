'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronRight, X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Overlays, all on Radix so focus trapping, escape handling, scroll locking and the
 * ARIA wiring are correct without us reimplementing them.
 *
 * `Dialog` is centred and modal; `Sheet` slides in from a side and is what the admin
 * uses for detail panels, because it keeps the list visible behind it.
 */

// --- Dialog -----------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClasses =
  'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0';

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(function DialogContent({ className, children, hideClose, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClasses} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed start-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(32rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-card rtl:translate-x-1/2',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className="absolute end-4 top-4 rounded-sm text-muted transition-colors hover:text-ink"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-col gap-1 border-b border-line p-5 pe-12', className)} {...props} />;
}

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-base font-semibold text-ink', className)}
      {...props}
    />
  );
});

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-muted', className)}
      {...props}
    />
  );
});

export function DialogBody({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex-1 overflow-y-auto p-5', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 border-t border-line p-5', className)}
      {...props}
    />
  );
}

// --- Sheet ------------------------------------------------------------------

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
export const SheetHeader = DialogHeader;
export const SheetBody = DialogBody;
export const SheetFooter = DialogFooter;

const SHEET_SIDES = {
  right: 'inset-y-0 end-0 h-full border-s',
  left: 'inset-y-0 start-0 h-full border-e',
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] w-full border-t',
} as const;

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: keyof typeof SHEET_SIDES;
    width?: string;
  }
>(function SheetContent({ className, children, side = 'right', width = 'w-[min(40rem,95vw)]', ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClasses} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col border-line bg-surface shadow-card',
          SHEET_SIDES[side],
          side === 'bottom' ? 'w-full' : width,
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute end-4 top-4 rounded-sm text-muted transition-colors hover:text-ink"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

// --- Dropdown menu ----------------------------------------------------------

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuGroup = DropdownPrimitive.Group;
export const DropdownMenuSub = DropdownPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;

const menuContentClasses =
  'z-50 min-w-48 overflow-hidden rounded-sm border border-line bg-surface p-1 shadow-card data-[state=open]:animate-in data-[state=open]:fade-in-0';

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(menuContentClasses, className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
});

const menuItemClasses =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-xs px-2.5 py-2 text-sm text-muted outline-none transition-colors data-[highlighted]:bg-elevated data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { tone?: 'default' | 'danger' }
>(function DropdownMenuItem({ className, tone = 'default', ...props }, ref) {
  return (
    <DropdownPrimitive.Item
      ref={ref}
      className={cn(
        menuItemClasses,
        tone === 'danger' && 'text-danger data-[highlighted]:bg-danger/10 data-[highlighted]:text-danger',
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof DropdownPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <DropdownPrimitive.CheckboxItem
      ref={ref}
      className={cn(menuItemClasses, 'pe-2 ps-8', className)}
      {...props}
    >
      <span className="absolute start-2 flex h-4 w-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5 text-brass" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof DropdownPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DropdownPrimitive.RadioItem
      ref={ref}
      className={cn(menuItemClasses, 'pe-2 ps-8', className)}
      {...props}
    >
      <span className="absolute start-2 flex h-4 w-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5 text-brass" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.RadioItem>
  );
});

export const DropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof DropdownPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.SubTrigger>
>(function DropdownMenuSubTrigger({ className, children, ...props }, ref) {
  return (
    <DropdownPrimitive.SubTrigger ref={ref} className={cn(menuItemClasses, className)} {...props}>
      {children}
      <ChevronRight className="ms-auto h-3.5 w-3.5 rtl:rotate-180" />
    </DropdownPrimitive.SubTrigger>
  );
});

export const DropdownMenuSubContent = forwardRef<
  ElementRef<typeof DropdownPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent ref={ref} className={cn(menuContentClasses, className)} {...props} />
    </DropdownPrimitive.Portal>
  );
});

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('px-2.5 py-1.5 text-eyebrow uppercase text-muted', className)} {...props} />;
}

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof DropdownPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return <DropdownPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-line', className)} {...props} />;
});

// --- Popover ----------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, align = 'start', sideOffset = 6, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-sm border border-line bg-surface p-3 shadow-card outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

// --- Tooltip ----------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

/** Wraps trigger and content together: a tooltip is never useful without both. */
export function Tooltip({
  children,
  content,
  side = 'top',
  delayDuration = 200,
}: {
  children: ReactNode;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delayDuration?: number;
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-xs border border-line bg-elevated px-2.5 py-1.5 text-xs text-ink shadow-lift"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
