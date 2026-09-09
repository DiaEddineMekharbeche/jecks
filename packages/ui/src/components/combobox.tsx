'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { inputVariants } from '../lib/variants';
import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { Popover, PopoverContent, PopoverTrigger } from './overlay';

/**
 * Async combobox — the control for picking a product, a customer or a courier out of a
 * set too large to render. The caller owns the search: it receives the query and
 * returns options, which is what lets the lookup hit Postgres instead of a preloaded
 * array.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string | null;
  onValueChange: (value: string | null) => void;
  onSearchChange?: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  onSearchChange,
  loading = false,
  placeholder = 'Sélectionner…',
  searchPlaceholder = 'Rechercher…',
  emptyMessage = 'Aucun résultat',
  clearable = true,
  disabled = false,
  className,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            inputVariants,
            'flex h-10 items-center justify-between gap-2 border-line text-start',
            !selected && 'text-muted/70',
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <span className="flex shrink-0 items-center gap-1">
            {clearable && selected && !disabled ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Effacer"
                className="rounded-xs text-muted hover:text-ink"
                onClick={(event) => {
                  // Clearing must not also open the list.
                  event.stopPropagation();
                  onValueChange(null);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="h-4 w-4 text-muted" />
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {/* Filtering is the server's job whenever onSearchChange is supplied. */}
        <CommandPrimitive shouldFilter={!onSearchChange} className="flex flex-col">
          <CommandInput placeholder={searchPlaceholder} onValueChange={onSearchChange} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Recherche…
              </div>
            ) : (
              <>
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      onSelect={() => {
                        onValueChange(option.value === value ? null : option.value);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0 text-brass',
                          option.value === value ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description ? (
                          <span className="block truncate text-xs text-muted">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}

/** Same lookup, multiple answers — collections on a product, wilayas on a promotion. */
export function MultiSelect({
  options,
  values,
  onValuesChange,
  onSearchChange,
  loading = false,
  placeholder = 'Sélectionner…',
  searchPlaceholder = 'Rechercher…',
  emptyMessage = 'Aucun résultat',
  disabled = false,
  className,
  id,
}: Omit<ComboboxProps, 'value' | 'onValueChange' | 'clearable'> & {
  values: string[];
  onValuesChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.filter((option) => values.includes(option.value));

  function toggle(next: string) {
    onValuesChange(
      values.includes(next) ? values.filter((value) => value !== next) : [...values, next],
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              inputVariants,
              'flex h-10 items-center justify-between gap-2 border-line text-start',
              values.length === 0 && 'text-muted/70',
            )}
          >
            <span className="truncate">
              {values.length === 0
                ? placeholder
                : `${values.length} sélectionné${values.length > 1 ? 's' : ''}`}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <CommandPrimitive shouldFilter={!onSearchChange} className="flex flex-col">
            <CommandInput placeholder={searchPlaceholder} onValueChange={onSearchChange} />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recherche…
                </div>
              ) : (
                <>
                  <CommandEmpty>{emptyMessage}</CommandEmpty>
                  <CommandGroup>
                    {options.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        disabled={option.disabled}
                        // The list stays open: picking several is the whole point.
                        onSelect={() => toggle(option.value)}
                      >
                        <Check
                          className={cn(
                            'h-4 w-4 shrink-0 text-brass',
                            values.includes(option.value) ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </CommandPrimitive>
        </PopoverContent>
      </Popover>

      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => toggle(option.value)}
                className="flex items-center gap-1 rounded-xs bg-elevated px-2 py-1 text-xs text-muted transition-colors hover:text-ink"
              >
                {option.label}
                <X className="h-3 w-3" aria-hidden />
                <span className="sr-only">Retirer</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
