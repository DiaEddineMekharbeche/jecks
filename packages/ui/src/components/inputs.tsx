'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as RadioPrimitive from '@radix-ui/react-radio-group';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Check, ChevronDown, ChevronUp, Minus } from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn';
import { inputVariants } from '../lib/variants';

/** Controls beyond the plain text input: select, switch, checkbox, radio, tabs, money. */

// --- Select -----------------------------------------------------------------

export const SelectRoot = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        inputVariants,
        'flex h-10 items-center justify-between gap-2 border-line data-[placeholder]:text-muted/70',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn(
          'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-sm border border-line bg-surface shadow-card',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted">
          <ChevronUp className="h-3.5 w-3.5" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted">
          <ChevronDown className="h-3.5 w-3.5" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-xs py-2 pe-2 ps-8 text-sm text-muted outline-none data-[highlighted]:bg-elevated data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute start-2 flex h-4 w-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5 text-brass" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

export function SelectLabel({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('px-2 py-1.5 text-eyebrow uppercase text-muted', className)} {...props} />;
}

/** Convenience wrapper for the common "one flat list of options" case. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  id,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  options: Array<{ value: string; label: ReactNode; disabled?: boolean }>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <SelectRoot value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className} id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}

// --- Switch -----------------------------------------------------------------

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'data-[state=checked]:bg-brass data-[state=unchecked]:bg-line',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-surface shadow-lift transition-transform',
          'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
          'rtl:data-[state=checked]:-translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  );
});

/** Switch with its label and description, which is how settings screens use it. */
export function SwitchField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

// --- Checkbox ---------------------------------------------------------------

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer h-4 w-4 shrink-0 rounded-xs border border-line',
        'data-[state=checked]:border-brass data-[state=checked]:bg-brass data-[state=checked]:text-on-brass',
        'data-[state=indeterminate]:border-brass data-[state=indeterminate]:bg-brass data-[state=indeterminate]:text-on-brass',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === 'indeterminate' ? (
          <Minus className="h-3 w-3" strokeWidth={3} />
        ) : (
          <Check className="h-3 w-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

// --- Radio group ------------------------------------------------------------

export const RadioGroup = forwardRef<
  ElementRef<typeof RadioPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return <RadioPrimitive.Root ref={ref} className={cn('grid gap-2', className)} {...props} />;
});

export const RadioGroupItem = forwardRef<
  ElementRef<typeof RadioPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioPrimitive.Item>
>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioPrimitive.Item
      ref={ref}
      className={cn(
        'h-4 w-4 rounded-full border border-line data-[state=checked]:border-brass disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator className="flex h-full w-full items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-brass" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Item>
  );
});

// --- Tabs -------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn('flex items-center gap-1 overflow-x-auto border-b border-line', className)}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'relative whitespace-nowrap px-3 py-2.5 text-sm text-muted transition-colors hover:text-ink',
        // The active underline sits on the shared border, so tabs never shift by a pixel.
        'data-[state=active]:text-ink data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-brass',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn('pt-5 outline-none', className)} {...props} />;
});

// --- Money input ------------------------------------------------------------

export interface MoneyInputProps
  extends Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange' | 'type'> {
  /** Minor units (centimes). The field displays dinars. */
  value: bigint | number | string | null | undefined;
  onValueChange: (minorUnits: bigint | null) => void;
  currencySymbol?: string;
}

/**
 * Money-aware input. The shopper-facing unit is the dinar; storage is centimes
 * (PRD Section 8). The conversion lives here so no screen ever does it by hand, and the
 * text is only reformatted on blur — reformatting mid-typing fights the user.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { className, value, onValueChange, currencySymbol = 'DA', onBlur, ...props },
  ref,
) {
  const [text, setText] = useState(() => minorToText(value));
  const [focused, setFocused] = useState(false);

  // While the field is not focused it mirrors the prop, so a form reset is visible.
  const shown = focused ? text : minorToText(value);

  return (
    <div className="relative">
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        className={cn(inputVariants, 'h-10 border-line pe-10 text-end tabular-nums', className)}
        value={shown}
        onFocus={() => {
          setFocused(true);
          setText(minorToText(value));
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d.,-]/g, '');
          setText(next);
          onValueChange(textToMinor(next));
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
      />
      <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted">
        {currencySymbol}
      </span>
    </div>
  );
});

function minorToText(value: bigint | number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const minor = BigInt(value);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const major = abs / 100n;
  const cents = abs % 100n;
  const body = cents === 0n ? major.toString() : `${major}.${cents.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

function textToMinor(text: string): bigint | null {
  const cleaned = text.replace(',', '.').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const match = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole = '0', frac = ''] = match;
  const minor = BigInt(whole || '0') * 100n + BigInt(frac.padEnd(2, '0') || '0');
  return sign === '-' ? -minor : minor;
}

export const __moneyInputInternals = { minorToText, textToMinor };
