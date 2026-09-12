import { SECRET_MASK, type SettingScope } from '@jecks/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  Input,
  MoneyInput,
  MultiSelect,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Textarea,
  notify,
} from '@jecks/ui';
import { Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api';
import { message } from '@/lib/errors';
import { useSession } from '@/features/auth/session';
import * as settingsApi from './api';
import { PaymentProvidersPanel } from './PaymentProvidersPanel';
import { MediaSettingField } from './MediaSettingField';
import { SETTINGS_FORMS, type SettingField } from './fields';
import { useSettings, useSettingsInvalidate } from './queries';

/**
 * One settings section — PRD F-AD-91.
 *
 * The form is generated from the declaration in `fields.ts`, so a new setting is one
 * entry there plus one line in the API's scope schema, not a new screen. Only changed
 * keys are sent, which keeps the audit diff to what the operator actually touched.
 */
export function SettingsScopePage() {
  const { scope } = useParams<{ scope: string }>();
  const key = (scope ?? 'store') as SettingScope;
  const form = SETTINGS_FORMS[key];

  const query = useSettings();
  const invalidate = useSettingsInvalidate();
  const canWrite = useSession((state) => state.can)('settings.write');

  const saved = useMemo(
    () => query.data?.find((entry) => entry.scope === key)?.values ?? {},
    [query.data, key],
  );

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Reset the draft when the section changes, so an unsaved edit does not leak across.
  if (seeded !== key) {
    setSeeded(key);
    setDraft({});
    setErrors({});
  }

  const value = (field: string): unknown =>
    field in draft ? draft[field] : saved[field];

  const dirtyKeys = Object.keys(draft).filter(
    (field) => JSON.stringify(draft[field]) !== JSON.stringify(saved[field]),
  );

  async function save() {
    if (dirtyKeys.length === 0) return;
    setBusy(true);
    setErrors({});
    try {
      const payload = Object.fromEntries(dirtyKeys.map((field) => [field, draft[field]]));
      await settingsApi.updateSettingsScope(key, payload);
      notify.success(`${form.title} enregistré`);
      setDraft({});
      invalidate();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  if (!form) {
    return <EmptyState title="Section inconnue" description="Ce réglage n’existe pas." />;
  }

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (query.error) {
    return (
      <EmptyState
        title="Réglages indisponibles"
        description={(query.error as Error).message}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Réessayer
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={form.title}
        description={form.description}
        actions={
          <Button
            size="sm"
            loading={busy}
            disabled={!canWrite || dirtyKeys.length === 0}
            onClick={() => void save()}
          >
            <Save className="h-4 w-4" />
            Enregistrer{dirtyKeys.length > 0 ? ` (${dirtyKeys.length})` : ''}
          </Button>
        }
      />

      {!canWrite ? (
        <Alert tone="info" title="Lecture seule">
          Votre rôle permet de consulter les réglages mais pas de les modifier.
        </Alert>
      ) : null}

      <Card>
        <CardBody className="flex flex-col gap-5">
          {form.fields.map((field) => (
            <SettingControl
              key={field.key}
              field={field}
              value={value(field.key)}
              error={errors[field.key]}
              disabled={!canWrite}
              onChange={(next) => setDraft((current) => ({ ...current, [field.key]: next }))}
            />
          ))}
        </CardBody>
      </Card>

      {/* Only Paiements has something to reach; couriers have their own screen. */}
      {key === 'payments' ? <PaymentProvidersPanel /> : null}
    </div>
  );
}

function SettingControl({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: SettingField;
  value: unknown;
  error?: string;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  switch (field.kind) {
    case 'switch':
      return (
        <div className="flex items-start justify-between gap-4 border-b border-line pb-4 last:border-0 last:pb-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{field.label}</p>
            {field.hint ? <p className="mt-0.5 text-xs text-muted">{field.hint}</p> : null}
            {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
          </div>
          <Switch
            checked={Boolean(value)}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked)}
            aria-label={field.label}
          />
        </div>
      );

    case 'money':
      return (
        <Field label={field.label} hint={field.hint} error={error}>
          <MoneyInput
            value={typeof value === 'number' || typeof value === 'string' ? value : 0}
            disabled={disabled}
            onValueChange={(minor) => onChange(Number(minor ?? 0n))}
          />
        </Field>
      );

    case 'number':
      return (
        <Field label={field.label} hint={field.hint} error={error}>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="any"
              className="max-w-[160px]"
              value={value === undefined || value === null ? '' : String(value)}
              disabled={disabled}
              onChange={(event) =>
                onChange(event.target.value === '' ? 0 : Number(event.target.value))
              }
            />
            {field.suffix ? <span className="text-sm text-muted">{field.suffix}</span> : null}
          </div>
        </Field>
      );

    case 'select':
      return (
        <Field label={field.label} hint={field.hint} error={error}>
          <Select
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            options={field.options ?? []}
            onValueChange={onChange}
          />
        </Field>
      );

    case 'multiselect':
      return (
        <Field label={field.label} hint={field.hint} error={error}>
          <MultiSelect
            options={field.options ?? []}
            values={Array.isArray(value) ? (value as string[]) : []}
            disabled={disabled}
            onValuesChange={(values) => onChange(values)}
            placeholder="Choisir"
          />
        </Field>
      );

    case 'media':
      return (
        <MediaSettingField
          field={field}
          value={value}
          error={error}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case 'color':
      return (
        <Field label={field.label} hint={field.hint} error={error}>
          <div className="flex items-center gap-3">
            <input
              type="color"
              className="h-10 w-14 cursor-pointer rounded-sm border border-line bg-transparent p-1"
              value={typeof value === 'string' ? value : '#000000'}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value.toUpperCase())}
              aria-label={field.label}
            />
            <Input
              className="max-w-[140px] font-mono"
              value={typeof value === 'string' ? value : ''}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value.toUpperCase())}
            />
          </div>
        </Field>
      );

    case 'secret':
      return (
        <Field
          label={field.label}
          hint={
            value === SECRET_MASK
              ? 'Une valeur est enregistrée. Saisissez-en une nouvelle pour la remplacer.'
              : (field.hint ?? 'Chiffré au repos ; jamais renvoyé au navigateur.')
          }
          error={error}
        >
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={value === SECRET_MASK ? SECRET_MASK : ''}
            value={typeof value === 'string' && value !== SECRET_MASK ? value : ''}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );

    case 'textarea':
      return (
        <Field label={field.label} hint={field.hint} error={error}>
          <Textarea
            rows={3}
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );

    case 'list':
      return (
        <Field label={field.label} hint={field.hint} error={error}>
          <Textarea
            rows={3}
            value={Array.isArray(value) ? (value as string[]).join('\n') : ''}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
      );

    default:
      return (
        <Field label={field.label} hint={field.hint} error={error}>
          <Input
            type={field.kind === 'email' ? 'email' : 'text'}
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
  }
}
