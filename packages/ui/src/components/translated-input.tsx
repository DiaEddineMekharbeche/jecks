'use client';

import { Check, Languages } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Input, Textarea } from './field';
import { Tabs, TabsList, TabsTrigger } from './inputs';

/**
 * Tabbed editor for a translated JSONB field — PRD Section 6.4.
 *
 * One tab per locale, with a tick on the ones that have content, so an editor can see
 * at a glance what is still missing. The Arabic tab flips to RTL, because typing Arabic
 * into a left-to-right field is unusable.
 */

export type TranslatedValue = Partial<Record<string, string>>;

export interface TranslatedInputProps {
  value: TranslatedValue;
  onChange: (value: TranslatedValue) => void;
  locales?: readonly string[];
  rtlLocales?: readonly string[];
  /** The locale that must be filled; its tab is marked required. */
  requiredLocale?: string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  hint?: ReactNode;
}

const LOCALE_LABELS: Record<string, string> = {
  fr: 'Français',
  ar: 'العربية',
  en: 'English',
};

export function TranslatedInput({
  value,
  onChange,
  locales = ['fr', 'ar', 'en'],
  rtlLocales = ['ar'],
  requiredLocale = 'fr',
  multiline = false,
  rows = 4,
  placeholder,
  disabled = false,
  id,
  className,
  hint,
}: TranslatedInputProps) {
  const [active, setActive] = useState(locales[0] ?? 'fr');
  const Control = multiline ? Textarea : Input;

  const filled = locales.filter((locale) => (value[locale] ?? '').trim() !== '').length;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Tabs value={active} onValueChange={setActive}>
        <TabsList className="justify-start">
          {locales.map((locale) => {
            const hasContent = (value[locale] ?? '').trim() !== '';
            return (
              <TabsTrigger key={locale} value={locale} className="gap-1.5">
                {LOCALE_LABELS[locale] ?? locale.toUpperCase()}
                {hasContent ? (
                  <Check className="h-3 w-3 text-success" aria-label="renseigné" />
                ) : locale === requiredLocale ? (
                  <span className="text-danger" aria-label="obligatoire">
                    *
                  </span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* All locales stay mounted so switching tabs never loses an unsaved draft. */}
      {locales.map((locale) => (
        <div key={locale} hidden={locale !== active}>
          <Control
            id={locale === active ? id : undefined}
            dir={rtlLocales.includes(locale) ? 'rtl' : 'ltr'}
            lang={locale}
            rows={multiline ? rows : undefined}
            placeholder={placeholder}
            disabled={disabled}
            value={value[locale] ?? ''}
            onChange={(event) => onChange({ ...value, [locale]: event.target.value })}
          />
        </div>
      ))}

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Languages className="h-3 w-3" aria-hidden />
        {filled} / {locales.length} langues renseignées
        {hint ? <> · {hint}</> : null}
      </p>
    </div>
  );
}
