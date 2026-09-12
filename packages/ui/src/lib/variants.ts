import { cva } from 'class-variance-authority';
import { cn } from './cn';

/**
 * Class recipes, kept out of the component files so a React Server Component can style
 * a plain `<a>` with `buttonVariants(...)` without pulling a client component in.
 */

export const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium',
    'transition-[background-color,color,border-color,transform] duration-200 ease-brand',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:translate-y-px',
  ),
  {
    variants: {
      variant: {
        primary: 'bg-brass text-on-brass hover:bg-brass-soft',
        secondary: 'bg-elevated text-ink hover:bg-line',
        outline: 'border border-line text-ink hover:border-brass hover:text-brass',
        ghost: 'text-muted hover:bg-elevated hover:text-ink',
        danger: 'bg-danger text-white hover:bg-danger/90',
        link: 'text-brass underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 rounded-sm px-3 text-xs',
        md: 'h-10 rounded-sm px-4 text-sm',
        lg: 'h-12 rounded-sm px-6 text-base',
        icon: 'h-10 w-10 rounded-sm',
      },
      /** Editorial buttons on the storefront: wide tracking, upper case. */
      editorial: { true: 'font-display uppercase tracking-[0.14em]', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', editorial: false },
  },
);

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-xs px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
  {
    variants: {
      tone: {
        neutral: 'bg-elevated text-muted',
        brass: 'bg-brass/15 text-brass',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-danger/15 text-danger',
        info: 'bg-info/15 text-info',
        /** Product-card badges sit on imagery, so they need a solid ground. */
        solid: 'bg-base text-ink',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export const alertVariants = cva('flex gap-3 rounded-sm border p-4 text-sm', {
  variants: {
    tone: {
      info: 'border-info/40 bg-info/10 text-ink',
      success: 'border-success/40 bg-success/10 text-ink',
      warning: 'border-warning/40 bg-warning/10 text-ink',
      danger: 'border-danger/40 bg-danger/10 text-ink',
    },
  },
  defaultVariants: { tone: 'info' },
});

export const inputVariants = cn(
  'w-full rounded-sm border bg-surface px-3 text-sm text-ink',
  'placeholder:text-muted/70',
  'transition-colors duration-150',
  'focus:border-brass focus:outline-none focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60',
);
