import type { VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { alertVariants, badgeVariants } from '../lib/variants';

/** Cards, badges, alerts and skeletons — the containers every screen reuses. */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface shadow-card', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 border-b border-line p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-ink', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted', className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-2 border-t border-line p-5', className)} {...props} />
  );
}

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const ALERT_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;


export interface AlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  /** Widened from the DOM `title` attribute: alerts render a heading, not a tooltip. */
  title?: ReactNode;
}

export function Alert({ className, tone = 'info', title, children, ...props }: AlertProps) {
  const Icon = ALERT_ICONS[tone ?? 'info'];
  return (
    <div
      className={cn(alertVariants({ tone }), className)}
      // Errors interrupt; everything else waits for a pause in the screen reader.
      role={tone === 'danger' ? 'alert' : 'status'}
      {...props}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
    </div>
  );
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Set once per loading region so assistive tech announces one "loading", not fifty. */
  label?: string;
}

export function Skeleton({ className, label, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('jk-skeleton rounded-sm', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line p-12 text-center',
        className,
      )}
    >
      {icon ? <div className="text-muted">{icon}</div> : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-prose text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
