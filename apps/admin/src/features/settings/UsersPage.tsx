import { t, type StaffRow } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  MultiSelect,
  PageHeader,
  Select,
  SwitchField,
  TablePagination,
  notify,
} from '@jecks/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, KeyRound, MoreHorizontal, ShieldOff, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { dateTimeFormatter, message } from '@/lib/errors';
import { useServerTable } from '@/lib/server-table';
import { useSession } from '@/features/auth/session';
import * as settingsApi from './api';
import { useInvitations, useRoles, useSettingsInvalidate } from './queries';

/**
 * The team — PRD F-AD-92.
 *
 * Nobody's password is chosen for them. An invitation produces a single-use link that
 * the owner copies into WhatsApp; the colleague sets their own password on it.
 */
export function UsersPage() {
  const roles = useRoles();
  const invitations = useInvitations();
  const invalidate = useSettingsInvalidate();
  const currentUserId = useSession((state) => state.user?.id);
  const canWrite = useSession((state) => state.can)('users.write');

  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);

  const table = useServerTable<StaffRow>({
    module: 'staff',
    endpoint: '/admin/users',
    defaultSort: 'name',
    defaultOrder: 'asc',
    filterKeys: ['active', 'roleId'],
  });

  async function act(
    label: string,
    action: () => Promise<unknown>,
  ): Promise<void> {
    setBusy(true);
    try {
      await action();
      notify.success(label);
      invalidate();
      table.refetch();
    } catch (error) {
      notify.error(message(error, "L'action a échoué"));
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<ColumnDef<StaffRow, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Membre',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {row.original.name}
              {row.original.id === currentUserId ? (
                <span className="ms-2 text-xs text-muted">(vous)</span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted">{row.original.email ?? row.original.phone ?? '—'}</p>
          </div>
        ),
      },
      {
        id: 'roles',
        header: 'Rôles',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roles.length === 0 ? (
              <span className="text-xs text-muted">aucun</span>
            ) : (
              row.original.roles.map((role) => (
                <Badge key={role.id} tone={role.slug === 'owner' ? 'brass' : 'neutral'}>
                  {t(role.name, 'fr')}
                </Badge>
              ))
            )}
          </div>
        ),
      },
      {
        id: 'security',
        header: 'Sécurité',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 text-xs">
            <span className={row.original.twoFactorEnabled ? 'text-success' : 'text-muted'}>
              {row.original.twoFactorEnabled ? '2FA activée' : '2FA absente'}
            </span>
            <span className="text-muted">
              {row.original.activeSessions} session{row.original.activeSessions > 1 ? 's' : ''}
            </span>
          </div>
        ),
      },
      {
        id: 'lastLoginAt',
        header: 'Dernière connexion',
        accessorKey: 'lastLoginAt',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {row.original.lastLoginAt
              ? dateTimeFormatter.format(new Date(row.original.lastLoginAt))
              : 'jamais'}
          </span>
        ),
      },
      {
        id: 'active',
        header: 'Statut',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.active ? (
            <Badge tone="success">Actif</Badge>
          ) : (
            <Badge tone="neutral">Désactivé</Badge>
          ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(row.original)}>
                  Modifier
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canWrite}
                  onSelect={() =>
                    void act('Sessions révoquées', () =>
                      settingsApi.revokeStaffSessions(row.original.id),
                    )
                  }
                >
                  Déconnecter partout
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canWrite || !row.original.twoFactorEnabled}
                  onSelect={() =>
                    void act('Second facteur réinitialisé', () =>
                      settingsApi.resetStaffTwoFactor(row.original.id),
                    )
                  }
                >
                  Réinitialiser la 2FA
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canWrite || row.original.id === currentUserId}
                  onSelect={() =>
                    void act('Compte désactivé', () =>
                      settingsApi.deactivateStaff(row.original.id),
                    )
                  }
                >
                  Désactiver le compte
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    // `act` and the permission flags are stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, canWrite],
  );

  const pending = (invitations.data ?? []).filter(
    (invitation) => !invitation.acceptedAt && !invitation.expired,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Équipe"
        description="Qui a accès à l’administration, avec quels rôles, et depuis quand."
        actions={
          <Button size="sm" disabled={!canWrite} onClick={() => setInviting(true)}>
            <UserPlus className="h-4 w-4" />
            Inviter
          </Button>
        }
      />

      {pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitations en attente</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {pending.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{invitation.name}</p>
                  <p className="truncate text-xs text-muted">
                    {invitation.email} · {t(invitation.roleName, 'fr')} · expire le{' '}
                    {dateTimeFormatter.format(new Date(invitation.expiresAt))}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canWrite || busy}
                  onClick={() =>
                    void act('Invitation révoquée', () =>
                      settingsApi.revokeInvitation(invitation.id),
                    )
                  }
                >
                  Révoquer
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <DataTable<StaffRow>
        columns={columns}
        data={table.rows}
        getRowId={(row) => row.id}
        loading={table.loading}
        error={table.error?.message}
        onRetry={table.refetch}
        sorting={table.sorting}
        onSortingChange={table.setSorting}
        columnVisibility={table.columnVisibility}
        onColumnVisibilityChange={table.setColumnVisibility}
        density={table.density}
        onDensityChange={table.setDensity}
        emptyTitle="Aucun membre"
        emptyDescription="Invitez votre équipe pour lui donner accès à l’administration."
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Input
              value={table.search}
              onChange={(event) => table.setSearch(event.target.value)}
              placeholder="Nom, e-mail ou téléphone"
              className="min-w-[220px] flex-1"
              aria-label="Rechercher un membre"
            />
            <MultiSelect
              options={(roles.data ?? []).map((role) => ({
                value: role.id,
                label: t(role.name, 'fr'),
              }))}
              values={table.filters.roleId ?? []}
              onValuesChange={(values) => table.setFilter('roleId', values)}
              placeholder="Rôle"
            />
          </div>
        }
      />

      <TablePagination
        page={table.page}
        pageSize={table.pageSize}
        total={table.total}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        loading={table.fetching}
      />

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onDone={() => {
          setInviting(false);
          invalidate();
        }}
      />

      {editing ? (
        <EditStaffDialog
          staff={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
            table.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function InviteDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const roles = useRoles();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [link, setLink] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const result = await settingsApi.inviteStaff({ name, email, roleId });
      setLink(`${window.location.origin}/invitation?token=${result.token}`);
      notify.success('Invitation créée');
      onDone();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'invitation a échoué"));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setName('');
    setEmail('');
    setRoleId('');
    setLink(null);
    setErrors({});
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter un collègue</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {link ? (
            <>
              <Alert tone="success" title="Lien d’invitation créé">
                Valable 72 heures et utilisable une seule fois. Envoyez-le à la personne concernée ;
                elle choisira son mot de passe elle-même.
              </Alert>
              <div className="flex gap-2">
                <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(link);
                    notify.success('Lien copié');
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <Field label="Nom" required error={errors.name}>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="E-mail" required error={errors.email}>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field label="Rôle" required error={errors.roleId}>
                <Select
                  value={roleId}
                  onValueChange={setRoleId}
                  options={(roles.data ?? []).map((role) => ({
                    value: role.id,
                    label: t(role.name, 'fr'),
                  }))}
                  placeholder="Choisir un rôle"
                />
              </Field>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {link ? 'Fermer' : 'Annuler'}
          </Button>
          {link ? null : (
            <Button
              loading={busy}
              disabled={!name.trim() || !email.trim() || !roleId}
              onClick={() => void submit()}
            >
              Créer l’invitation
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditStaffDialog({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const roles = useRoles();
  const canWrite = useSession((state) => state.can)('users.write');

  const [name, setName] = useState(staff.name);
  const [email, setEmail] = useState(staff.email ?? '');
  const [roleIds, setRoleIds] = useState<string[]>(staff.roles.map((role) => role.id));
  const [active, setActive] = useState(staff.active);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await settingsApi.updateStaff(staff.id, {
        name,
        email: email || undefined,
        roleIds,
        active,
      });
      if (password) await settingsApi.setStaffPassword(staff.id, password);
      notify.success('Membre mis à jour');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{staff.name}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom" required error={errors.name}>
            <Input
              value={name}
              disabled={!canWrite}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="E-mail" error={errors.email}>
            <Input
              type="email"
              value={email}
              disabled={!canWrite}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Rôles" error={errors.roleIds}>
            <MultiSelect
              options={(roles.data ?? []).map((role) => ({
                value: role.id,
                label: t(role.name, 'fr'),
                description: role.description ?? undefined,
              }))}
              values={roleIds}
              disabled={!canWrite}
              onValuesChange={setRoleIds}
              placeholder="Choisir des rôles"
            />
          </Field>
          <SwitchField
            label="Compte actif"
            description="Désactiver coupe immédiatement toutes ses sessions."
            checked={active}
            disabled={!canWrite}
            onCheckedChange={setActive}
          />
          <Field
            label="Définir un mot de passe"
            hint="Laissez vide pour ne pas y toucher. À réserver aux comptes sans e-mail."
            error={errors.password}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={!canWrite}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {staff.twoFactorEnabled ? (
            <p className="flex items-center gap-2 text-xs text-muted">
              <KeyRound className="h-3.5 w-3.5" />
              Second facteur activé
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-warning">
              <ShieldOff className="h-3.5 w-3.5" />
              Second facteur non configuré
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!canWrite || !name.trim()} onClick={() => void save()}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
