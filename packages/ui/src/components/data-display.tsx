'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type { VariantProps } from 'class-variance-authority';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { cn } from '../lib/cn';
import { badgeVariants } from '../lib/variants';
import { Badge } from './surface';

/** Read-only presentation: KPI tiles, status badges, timelines, avatars, key/value lists. */

// --- Stat tile --------------------------------------------------------------

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Percentage change against the comparison period; null when there is no base. */
  changePercent?: number | null;
  /** Set when a rise is bad — ad spend, refunds, failed deliveries. */
  invertChange?: boolean;
  comparisonLabel?: ReactNode;
  sparkline?: number[];
  hint?: ReactNode;
  loading?: boolean;
  className?: string;
}

export function StatTile({
  label,
  value,
  changePercent = null,
  invertChange = false,
  comparisonLabel = 'vs période précédente',
  sparkline,
  hint,
  loading = false,
  className,
}: StatTileProps) {
  const Arrow = changePercent === null ? Minus : changePercent >= 0 ? ArrowUpRight : ArrowDownRight;
  const improving =
    changePercent === null ? null : invertChange ? changePercent <= 0 : changePercent >= 0;

  return (
    <div className={cn('rounded-lg border border-line bg-surface p-4', className)}>
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>

      {loading ? (
        <div className="jk-skeleton mt-2 h-8 w-24 rounded-sm" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      )}

      <div className="mt-1 flex items-end justify-between gap-3">
        <p
          className={cn(
            'flex items-center gap-1 text-xs',
            improving === null ? 'text-muted' : improving ? 'text-success' : 'text-danger',
          )}
        >
          <Arrow className="h-3 w-3" aria-hidden />
          {changePercent === null
            ? (hint ?? 'Pas de comparaison')
            : `${Math.abs(changePercent)} % ${comparisonLabel}`}
        </p>

        {sparkline && sparkline.length > 1 ? (
          <div className="h-8 w-24" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkline.map((y, x) => ({ x, y }))}>
                <Area
                  type="monotone"
                  dataKey="y"
                  stroke="rgb(var(--jk-brass))"
                  strokeWidth={1.5}
                  fill="rgb(var(--jk-brass) / 0.15)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Status badge -----------------------------------------------------------

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/**
 * Maps a domain enum to a tone, so the same status never appears in two colours across
 * the admin. Unknown values fall back to neutral rather than throwing.
 */
const STATUS_TONES: Record<string, Tone> = {
  // Orders — PRD Section 7
  PENDING: 'warning',
  CONFIRMED: 'info',
  PACKED: 'info',
  SHIPPED: 'info',
  OUT_FOR_DELIVERY: 'brass',
  DELIVERED: 'success',
  FAILED: 'danger',
  RETURN_REQUESTED: 'warning',
  RETURNED: 'neutral',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
  // Payment
  UNPAID: 'warning',
  AUTHORIZED: 'info',
  PAID: 'success',
  PARTIALLY_REFUNDED: 'warning',
  // Catalog
  DRAFT: 'neutral',
  ACTIVE: 'success',
  ARCHIVED: 'neutral',
  // Moderation
  APPROVED: 'success',
  REJECTED: 'danger',
  // Purchasing
  ORDERED: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  // Runs and settlements
  PLANNED: 'neutral',
  IN_PROGRESS: 'brass',
  COMPLETED: 'success',
  OPEN: 'warning',
  SENT: 'info',
  DISPUTED: 'danger',
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: ReactNode;
  className?: string;
}) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} className={className}>
      {label ?? status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}

export function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? 'neutral';
}

// --- Timeline ---------------------------------------------------------------

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  timestamp: ReactNode;
  actor?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}

/** Order and shipment history — PRD F-AD-31. Newest first, as the caller supplies it. */
export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  if (entries.length === 0) {
    return <p className={cn('text-sm text-muted', className)}>Aucun événement.</p>;
  }

  return (
    <ol className={cn('relative flex flex-col', className)}>
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
          {/* The rail stops at the last entry so it does not dangle below it. */}
          {index < entries.length - 1 ? (
            <span className="absolute start-[7px] top-4 bottom-0 w-px bg-line" aria-hidden />
          ) : null}

          <span
            className={cn(
              'relative z-10 mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-4 ring-surface',
              entry.tone === 'success' && 'bg-success',
              entry.tone === 'danger' && 'bg-danger',
              entry.tone === 'warning' && 'bg-warning',
              entry.tone === 'brass' && 'bg-brass',
              (!entry.tone || entry.tone === 'neutral' || entry.tone === 'info') && 'bg-line',
            )}
            aria-hidden
          />

          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{entry.title}</p>
            {entry.description ? (
              <p className="mt-0.5 text-sm text-muted">{entry.description}</p>
            ) : null}
            <p className="mt-0.5 text-xs text-muted">
              {entry.timestamp}
              {entry.actor ? <> · {entry.actor}</> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// --- Key/value list ---------------------------------------------------------

export function DescriptionList({
  items,
  className,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn('divide-y divide-line', className)}>
      {items.map((item, index) => (
        <div key={index} className="flex items-start justify-between gap-4 py-2.5 text-sm">
          <dt className="text-muted">{item.label}</dt>
          <dd className="text-end">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- Avatar -----------------------------------------------------------------

export const Avatar = forwardRef<
  ElementRef<typeof AvatarPrimitive.Root>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & { name?: string; src?: string }
>(function Avatar({ className, name, src, ...props }, ref) {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full bg-elevated',
        className,
      )}
      {...props}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={name ?? ''} className="h-full w-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback className="flex h-full w-full items-center justify-center text-xs font-medium text-muted">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
});

function initials(name?: string): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// --- Keyboard hint ----------------------------------------------------------

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-elevated px-1.5 font-mono text-[10px] text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

// --- Page header ------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
