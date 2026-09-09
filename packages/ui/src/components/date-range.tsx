'use client';

import { format as formatDate } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { DayPicker, type DateRange, type Matcher } from 'react-day-picker';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './overlay';

/**
 * Period picker for the dashboard, reports and the P&L — PRD F-AD-01.
 *
 * Presets cover what an owner actually asks for; the calendar is the escape hatch.
 * Ranges are whole days in the store's timezone: a report for "today" must include the
 * order placed a minute ago, so the end is the end of the day, not `now`.
 */

export type PeriodPreset = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'mtd' | 'qtd' | 'ytd' | 'custom';

export interface Period {
  preset: PeriodPreset;
  from: Date;
  to: Date;
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Aujourd'hui",
  yesterday: 'Hier',
  '7d': '7 jours',
  '30d': '30 jours',
  '90d': '90 jours',
  mtd: 'Ce mois',
  qtd: 'Ce trimestre',
  ytd: 'Cette année',
  custom: 'Personnalisé',
};

const ORDER: Array<Exclude<PeriodPreset, 'custom'>> = ['today', 'yesterday', '7d', '30d', '90d', 'mtd', 'qtd', 'ytd'];

export function resolvePeriod(preset: Exclude<PeriodPreset, 'custom'>, now = new Date()): Period {
  const to = endOfDay(now);
  const startToday = startOfDay(now);

  switch (preset) {
    case 'today':
      return { preset, from: startToday, to };
    case 'yesterday': {
      const yesterday = addDays(startToday, -1);
      return { preset, from: yesterday, to: endOfDay(yesterday) };
    }
    case '7d':
      return { preset, from: addDays(startToday, -6), to };
    case '30d':
      return { preset, from: addDays(startToday, -29), to };
    case '90d':
      return { preset, from: addDays(startToday, -89), to };
    case 'mtd':
      return { preset, from: new Date(now.getFullYear(), now.getMonth(), 1), to };
    case 'qtd':
      return { preset, from: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), to };
    case 'ytd':
      return { preset, from: new Date(now.getFullYear(), 0, 1), to };
  }
}

export function DateRangePicker({
  value,
  onChange,
  className,
  align = 'end',
}: {
  value: Period;
  onChange: (period: Period) => void;
  className?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>({ from: value.from, to: value.to });

  const label =
    value.preset === 'custom'
      ? `${formatDate(value.from, 'd MMM yyyy', { locale: fr })} – ${formatDate(value.to, 'd MMM yyyy', { locale: fr })}`
      : PRESET_LABELS[value.preset];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-2', className)}>
          <CalendarDays className="h-4 w-4" />
          {label}
        </Button>
      </PopoverTrigger>

      <PopoverContent align={align} className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <ul className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-line p-2 sm:flex-col sm:border-b-0 sm:border-e">
            {ORDER.map((preset) => (
              <li key={preset}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(resolvePeriod(preset));
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full whitespace-nowrap rounded-xs px-3 py-1.5 text-start text-sm transition-colors',
                    value.preset === preset
                      ? 'bg-brass/15 text-brass'
                      : 'text-muted hover:bg-elevated hover:text-ink',
                  )}
                >
                  {PRESET_LABELS[preset]}
                </button>
              </li>
            ))}
          </ul>

          <div className="p-3">
            <DayPicker
              mode="range"
              locale={fr}
              numberOfMonths={1}
              defaultMonth={value.from}
              selected={draft}
              onSelect={setDraft}
              // Nobody reports on the future.
              disabled={{ after: new Date() }}
              className="jk-daypicker"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button
                size="sm"
                disabled={!draft?.from}
                onClick={() => {
                  if (!draft?.from) return;
                  onChange({
                    preset: 'custom',
                    from: startOfDay(draft.from),
                    to: endOfDay(draft.to ?? draft.from),
                  });
                  setOpen(false);
                }}
              >
                Appliquer
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Single date, for an expense date or a delivery run. */
export function DatePicker({
  value,
  onChange,
  placeholder = 'Choisir une date',
  disabled,
  className,
  id,
}: {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  disabled?: Matcher | Matcher[];
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" id={id} className={cn('h-10 w-full justify-start gap-2', className)}>
          <CalendarDays className="h-4 w-4 text-muted" />
          {value ? formatDate(value, 'd MMMM yyyy', { locale: fr }) : <span className="text-muted">{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3">
        <DayPicker
          mode="single"
          locale={fr}
          selected={value ?? undefined}
          defaultMonth={value ?? undefined}
          disabled={disabled}
          onSelect={(date) => {
            onChange(date ?? null);
            setOpen(false);
          }}
          className="jk-daypicker"
        />
      </PopoverContent>
    </Popover>
  );
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
