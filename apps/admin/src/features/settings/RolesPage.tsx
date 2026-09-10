import { slugify, t, type PermissionDto, type RoleDto } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  TranslatedInput,
  cn,
  notify,
} from '@jecks/ui';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { message } from '@/lib/errors';
import { useSession } from '@/features/auth/session';
import * as settingsApi from './api';
import { usePermissionCatalogue, useRoles, useSettingsInvalidate } from './queries';

/**
 * The permission matrix — PRD F-AD-92, acceptance criterion 6.
 *
 * Roles down the side, permissions across: an owner reading this screen should be able
 * to answer "can the order agent see the profit figures" without opening anything else.
 * Ticking a box saves immediately, because a matrix with a Save button gets half-edited
 * and abandoned.
 */

const GROUP_LABELS: Record<string, string> = {
  catalog: 'Catalogue',
  reviews: 'Avis',
  inventory: 'Stock',
  purchasing: 'Achats',
  orders: 'Commandes',
  customers: 'Clients',
  promotions: 'Promotions',
  content: 'Contenu',
  marketing: 'Marketing',
  delivery: 'Livraison',
  finance: 'Finances',
  reports: 'Rapports',
  settings: 'Réglages',
  users: 'Utilisateurs',
  audit: 'Journal',
};

export function RolesPage() {
  const roles = useRoles();
  const permissions = usePermissionCatalogue();
  const invalidate = useSettingsInvalidate();
  const canWrite = useSession((state) => state.can)('users.write');

  const [creating, setCreating] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<RoleDto | null>(null);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const out = new Map<string, PermissionDto[]>();
    for (const permission of permissions.data ?? []) {
      const list = out.get(permission.group) ?? [];
      list.push(permission);
      out.set(permission.group, list);
    }
    return [...out.entries()];
  }, [permissions.data]);

  async function toggle(role: RoleDto, permission: string) {
    const next = role.permissions.includes(permission as never)
      ? role.permissions.filter((entry) => entry !== permission)
      : [...role.permissions, permission];

    setPendingKey(`${role.id}:${permission}`);
    try {
      await settingsApi.updateRolePermissions(role.id, next as string[]);
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La mise à jour a échoué'));
    } finally {
      setPendingKey(null);
    }
  }

  async function remove() {
    if (!confirming) return;
    setBusy(true);
    try {
      await settingsApi.deleteRole(confirming.id);
      notify.success(`Rôle « ${t(confirming.name, 'fr')} » supprimé`);
      setConfirming(null);
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    } finally {
      setBusy(false);
    }
  }

  if (roles.isLoading || permissions.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" label="Chargement" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (roles.error) {
    return (
      <EmptyState
        title="Rôles indisponibles"
        description={(roles.error as Error).message}
        action={
          <Button variant="outline" size="sm" onClick={() => void roles.refetch()}>
            Réessayer
          </Button>
        }
      />
    );
  }

  const list = roles.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Rôles et permissions"
        description="Qui peut faire quoi. Cocher enregistre immédiatement."
        actions={
          <Button size="sm" disabled={!canWrite} onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Nouveau rôle
          </Button>
        }
      />

      <Alert tone="info" title="Rôles intégrés">
        Les rôles fournis avec la boutique ne peuvent être ni renommés ni supprimés, mais leurs
        permissions restent modifiables.
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((role) => (
          <Card key={role.id}>
            <CardBody className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{t(role.name, 'fr')}</p>
                <p className="truncate text-xs text-muted">
                  {role.permissions.length} permission(s) · {role.userCount} membre(s)
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {role.isSystem ? <Badge tone="neutral">Intégré</Badge> : null}
                {!role.isSystem && canWrite ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Supprimer le rôle"
                    onClick={() => setConfirming(role)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <th className="sticky start-0 bg-surface px-4 py-2.5 text-start font-medium">
                  Permission
                </th>
                {list.map((role) => (
                  <th key={role.id} className="min-w-[86px] px-2 py-2.5 text-center font-medium">
                    {t(role.name, 'fr')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map(([group, entries]) => (
                <>
                  <tr key={`group-${group}`} className="bg-elevated/50">
                    <td
                      colSpan={list.length + 1}
                      className="px-4 py-1.5 text-[11px] uppercase tracking-wider text-muted"
                    >
                      {GROUP_LABELS[group] ?? group}
                    </td>
                  </tr>
                  {entries.map((permission) => (
                    <tr key={permission.key} className="border-b border-line/60 last:border-0">
                      <td className="sticky start-0 bg-surface px-4 py-2">
                        <p className="font-mono text-xs text-ink">{permission.key}</p>
                        {permission.description ? (
                          <p className="text-xs text-muted">{permission.description}</p>
                        ) : null}
                      </td>
                      {list.map((role) => {
                        const checked = role.permissions.includes(permission.key);
                        const key = `${role.id}:${permission.key}`;
                        return (
                          <td key={role.id} className="px-2 py-2 text-center">
                            <Checkbox
                              checked={checked}
                              disabled={!canWrite || pendingKey === key}
                              onCheckedChange={() => void toggle(role, permission.key)}
                              aria-label={`${permission.key} pour ${t(role.name, 'fr')}`}
                              className={cn(pendingKey === key && 'opacity-50')}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <RoleDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          invalidate();
        }}
      />

      <Dialog
        open={Boolean(confirming)}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce rôle ?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted">
              « {confirming ? t(confirming.name, 'fr') : ''} » sera supprimé. Un rôle encore attribué
              à quelqu’un ne peut pas l’être.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Annuler
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState<Record<string, string>>({ fr: '' });
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await settingsApi.createRole({
        slug: slug || slugify(name.fr ?? ''),
        name,
        description: description || undefined,
        // A new role starts with nothing. Granting from the matrix afterwards is one
        // click per permission and makes the grant deliberate.
        permissions: [],
      });
      notify.success('Rôle créé ; cochez ses permissions dans la matrice');
      setName({ fr: '' });
      setSlug('');
      setDescription('');
      onSaved();
    } catch (error) {
      notify.error(message(error, 'La création a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau rôle</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required>
            <TranslatedInput
              value={name}
              requiredLocale="fr"
              onChange={(value) => {
                setName(value as Record<string, string>);
                if (!slug) setSlug(slugify(value.fr ?? '').replace(/-/g, '_'));
              }}
            />
          </Field>
          <Field label="Clé" hint="Minuscules et tirets bas ; utilisée dans le code et les exports.">
            <Input
              value={slug}
              onChange={(event) =>
                setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
              }
              placeholder="responsable_stock"
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!(name.fr ?? '').trim() || slug.length < 2}
            onClick={() => void submit()}
          >
            <Save className="h-4 w-4" />
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
