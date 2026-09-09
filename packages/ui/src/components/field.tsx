'use client';

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';
import { inputVariants } from '../lib/variants';

/**
 * Form primitives. The Field wrapper owns the ids so every control is bound to its
 * label and its error message without the caller wiring `aria-describedby` by hand —
 * PRD Section 6.6 requires this on the whole storefront.
 */

interface FieldContextValue {
  id: string;
  errorId: string;
  hintId: string;
  hasError: boolean;
  hasHint: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const value: FieldContextValue = {
    id,
    errorId: `${id}-error`,
    hintId: `${id}-hint`,
    hasError: Boolean(error),
    hasHint: Boolean(hint),
  };

  return (
    <FieldContext.Provider value={value}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label ? (
          <Label htmlFor={id}>
            {label}
            {required ? (
              <span className="text-danger" aria-hidden>
                {' '}
                *
              </span>
            ) : null}
          </Label>
        ) : null}
        {children}
        {hint && !error ? (
          <p id={value.hintId} className="text-xs text-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={value.errorId} className="text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn('text-xs font-medium uppercase tracking-wider text-muted', className)}
        {...props}
      />
    );
  },
);

const controlClasses = inputVariants;

function describedBy(field: FieldContextValue | null): string | undefined {
  if (!field) return undefined;
  const ids = [field.hasError ? field.errorId : null, field.hasHint ? field.hintId : null].filter(
    Boolean,
  );
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, id, ...props }, ref) {
    const field = useField();
    return (
      <input
        ref={ref}
        id={id ?? field?.id}
        aria-invalid={field?.hasError || undefined}
        aria-describedby={describedBy(field)}
        className={cn(
          controlClasses,
          'h-10',
          field?.hasError ? 'border-danger' : 'border-line',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, id, rows = 4, ...props }, ref) {
    const field = useField();
    return (
      <textarea
        ref={ref}
        id={id ?? field?.id}
        rows={rows}
        aria-invalid={field?.hasError || undefined}
        aria-describedby={describedBy(field)}
        className={cn(
          controlClasses,
          'py-2 leading-relaxed',
          field?.hasError ? 'border-danger' : 'border-line',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, id, children, ...props }, ref) {
    const field = useField();
    return (
      <select
        ref={ref}
        id={id ?? field?.id}
        aria-invalid={field?.hasError || undefined}
        aria-describedby={describedBy(field)}
        className={cn(
          controlClasses,
          'h-10 appearance-none pe-8',
          field?.hasError ? 'border-danger' : 'border-line',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
