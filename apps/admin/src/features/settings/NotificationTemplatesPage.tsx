import {
  NOTIFICATION_EVENTS,
  NotificationChannel,
  TEMPLATE_VARIABLES,
  type NotificationTemplateDto,
} from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { Eye, Plus, Save, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { message } from '@/lib/errors';
import { useSession } from '@/features/auth/session';
import * as settingsApi from './api';
import { useSettingsInvalidate, useTemplates } from './queries';

/**
 * Notification templates — PRD F-AD-91, Settings › Notifications.
 *
 * A grid of events by channels: the owner picks a cell and edits one message in three
 * languages. Variables are inserted by clicking, because `{{trackingUrl}}` typed by
 * hand is `{{trackingURL}}` half the time and then the SMS goes out with a literal
 * placeholder in it.
 */

const CHANNELS = [
  { value: NotificationChannel.SMS, label: 'SMS' },
  { value: NotificationChannel.EMAIL, label: 'E-mail' },
  { value: NotificationChannel.WHATSAPP, label: 'WhatsApp' },
  { value: NotificationChannel.TELEGRAM, label: 'Telegram' },
  { value: NotificationChannel.IN_APP, label: 'Dans l’admin' },
];

const EVENT_LABELS: Record<string, string> = {
  'order.placed': 'Commande passée',
  'order.confirmed': 'Commande confirmée',
  'order.shipped': 'Commande expédiée',
  'order.out_for_delivery': 'En cours de livraison',
  'order.delivered': 'Commande livrée',
  'order.failed': 'Livraison échouée',
  'order.cancelled': 'Commande annulée',
  'stock.back_in_stock': 'Retour en stock',
  'cart.abandoned': 'Panier abandonné',
  'review.request': 'Demande d’avis',
  'inventory.low': 'Stock bas (propriétaire)',
  'owner.new_order': 'Nouvelle commande (propriétaire)',
  'auth.otp': 'Code de connexion',
};

const LOCALES = [
  { value: 'fr', label: 'Français' },
  { value: 'ar', label: 'العربية' },
  { value: 'en', label: 'English' },
] as const;

type Locale = (typeof LOCALES)[number]['value'];

export function NotificationTemplatesPage() {
  const templates = useTemplates();
  const invalidate = useSettingsInvalidate();
  const canWrite = useSession((state) => state.can)('settings.write');

  const [selected, setSelected] = useState<{ event: string; channel: string } | null>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, NotificationTemplateDto>();
    for (const template of templates.data ?? []) {
      map.set(`${template.event}:${template.channel}`, template);
    }
    return map;
  }, [templates.data]);

  if (templates.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const current = selected ? byKey.get(`${selected.event}:${selected.channel}`) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Modèles de notification"
        description="Un message par événement et par canal, en trois langues, avec envoi de test."
      />

      <Alert tone="info" title="Comment un message est choisi">
        Le canal est décidé par les réglages de notification ; la langue par celle du client. Une
        cellule vide utilise le message intégré par défaut.
      </Alert>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5 text-start font-medium">Événement</th>
                {CHANNELS.map((channel) => (
                  <th key={channel.value} className="px-3 py-2.5 text-center font-medium">
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map((event) => (
                <tr key={event} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-ink">{EVENT_LABELS[event] ?? event}</p>
                    <p className="text-xs text-muted">{event}</p>
                  </td>
                  {CHANNELS.map((channel) => {
                    const template = byKey.get(`${event}:${channel.value}`);
                    return (
                      <td key={channel.value} className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => setSelected({ event, channel: channel.value })}
                          className={cn(
                            'inline-flex h-7 min-w-[64px] items-center justify-center rounded-sm border px-2 text-xs transition-colors',
                            template
                              ? template.active
                                ? 'border-success/40 bg-success/10 text-success hover:border-success'
                                : 'border-line bg-elevated text-muted hover:text-ink'
                              : 'border-dashed border-line text-muted hover:border-brass hover:text-brass',
                          )}
                        >
                          {template ? (template.active ? 'Actif' : 'Inactif') : <Plus className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {selected ? (
        <TemplateDialog
          event={selected.event}
          channel={selected.channel}
          template={current}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function TemplateDialog({
  event,
  channel,
  template,
  canWrite,
  onClose,
  onSaved,
}: {
  event: string;
  channel: string;
  template: NotificationTemplateDto | undefined;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [locale, setLocale] = useState<Locale>('fr');
  const [subject, setSubject] = useState<Record<string, string>>(
    () => (template?.subject ?? {}) as Record<string, string>,
  );
  const [body, setBody] = useState<Record<string, string>>(
    () => (template?.body ?? {}) as Record<string, string>,
  );
  const [active, setActive] = useState(template?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string | null; body: string } | null>(null);
  const [testTo, setTestTo] = useState('');

  const variables = TEMPLATE_VARIABLES[event] ?? [];
  const needsSubject = channel === NotificationChannel.EMAIL;

  function insert(variable: string) {
    setBody((current) => ({
      ...current,
      [locale]: `${current[locale] ?? ''}{{${variable}}}`,
    }));
  }

  async function save() {
    setBusy(true);
    try {
      await settingsApi.saveTemplate({
        event,
        channel,
        subject: needsSubject && subject.fr ? subject : undefined,
        body: { ...body, fr: body.fr ?? '' },
        active,
      });
      notify.success('Modèle enregistré');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!template) {
      notify.error('Enregistrez le modèle avant de le prévisualiser');
      return;
    }
    try {
      setPreview(await settingsApi.previewTemplate(template.id, locale));
    } catch (error) {
      notify.error(message(error, "L'aperçu a échoué"));
    }
  }

  async function sendTest() {
    if (!template || !testTo.trim()) return;
    setBusy(true);
    try {
      const result = await settingsApi.testTemplate(template.id, {
        recipient: testTo.trim(),
        locale,
      });
      notify.success(
        result.queued
          ? 'Envoi de test mis en file'
          : "L'envoi n'a pas pu être mis en file (Redis indisponible)",
      );
    } catch (error) {
      notify.error(message(error, "L'envoi de test a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!template) return;
    setBusy(true);
    try {
      await settingsApi.deleteTemplate(template.id);
      notify.success('Modèle supprimé ; le message par défaut reprend');
      onSaved();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {EVENT_LABELS[event] ?? event}
            <Badge tone="brass">{CHANNELS.find((c) => c.value === channel)?.label ?? channel}</Badge>
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">Modèle actif</p>
              <p className="text-xs text-muted">
                Désactivé, cet événement n’envoie rien sur ce canal.
              </p>
            </div>
            <Switch
              checked={active}
              disabled={!canWrite}
              onCheckedChange={setActive}
              aria-label="Modèle actif"
            />
          </div>

          <Tabs value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <TabsList>
              {LOCALES.map((entry) => (
                <TabsTrigger key={entry.value} value={entry.value}>
                  {entry.label}
                  {entry.value === 'fr' ? ' *' : ''}
                </TabsTrigger>
              ))}
            </TabsList>

            {LOCALES.map((entry) => (
              <TabsContent key={entry.value} value={entry.value} className="flex flex-col gap-4">
                {needsSubject ? (
                  <Field label="Objet">
                    <Input
                      value={subject[entry.value] ?? ''}
                      disabled={!canWrite}
                      onChange={(input) =>
                        setSubject((current) => ({ ...current, [entry.value]: input.target.value }))
                      }
                    />
                  </Field>
                ) : null}

                <Field
                  label="Message"
                  required={entry.value === 'fr'}
                  hint={
                    channel === NotificationChannel.SMS
                      ? 'Un SMS fait 160 caractères ; au-delà il est facturé double.'
                      : undefined
                  }
                >
                  <Textarea
                    rows={6}
                    dir={entry.value === 'ar' ? 'rtl' : 'ltr'}
                    value={body[entry.value] ?? ''}
                    disabled={!canWrite}
                    onChange={(input) =>
                      setBody((current) => ({ ...current, [entry.value]: input.target.value }))
                    }
                  />
                </Field>

                {entry.value === locale && channel === NotificationChannel.SMS ? (
                  <p className="text-xs text-muted">
                    {(body[entry.value] ?? '').length} caractère(s)
                  </p>
                ) : null}
              </TabsContent>
            ))}
          </Tabs>

          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wider text-muted">Variables</p>
            <div className="flex flex-wrap gap-1.5">
              {variables.map((variable) => (
                <button
                  key={variable}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => insert(variable)}
                  className="rounded-xs border border-line px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-brass hover:text-brass disabled:opacity-50"
                >
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>
          </div>

          {preview ? (
            <div className="rounded-sm border border-line bg-elevated p-3">
              <p className="mb-1 text-xs uppercase tracking-wider text-muted">Aperçu</p>
              {preview.subject ? (
                <p className="text-sm font-medium text-ink">{preview.subject}</p>
              ) : null}
              <p className="whitespace-pre-wrap text-sm" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                {preview.body}
              </p>
            </div>
          ) : null}

          {template ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
              <Field label="Envoyer un test à" className="flex-1">
                <Input
                  value={testTo}
                  onChange={(input) => setTestTo(input.target.value)}
                  placeholder={
                    channel === NotificationChannel.EMAIL ? 'vous@exemple.dz' : '0550 11 22 33'
                  }
                />
              </Field>
              <Button
                variant="outline"
                size="sm"
                loading={busy}
                disabled={!canWrite || !testTo.trim()}
                onClick={() => void sendTest()}
              >
                <Send className="h-4 w-4" />
                Tester
              </Button>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {template ? (
            <Button variant="ghost" loading={busy} disabled={!canWrite} onClick={() => void remove()}>
              Supprimer
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => void runPreview()} disabled={!template}>
            <Eye className="h-4 w-4" />
            Aperçu
          </Button>
          <Button
            loading={busy}
            disabled={!canWrite || !(body.fr ?? '').trim()}
            onClick={() => void save()}
          >
            <Save className="h-4 w-4" />
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
