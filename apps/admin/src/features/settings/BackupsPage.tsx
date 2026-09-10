import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  Skeleton,
  notify,
} from '@jecks/ui';
import { Database, Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { dateTimeFormatter, message } from '@/lib/errors';
import { useSession } from '@/features/auth/session';
import * as settingsApi from './api';
import { useBackups } from './queries';

/**
 * Database backups — PRD Section 10.10.
 *
 * The nightly dump runs on its own at 02:30; this screen is for the copy you take
 * before doing something you might regret, and for checking the automatic ones landed.
 */
export function BackupsPage() {
  const backups = useBackups();
  const canWrite = useSession((state) => state.can)('settings.write');
  const [busy, setBusy] = useState(false);

  async function trigger() {
    setBusy(true);
    try {
      await settingsApi.triggerBackup();
      notify.success('Sauvegarde lancée ; elle apparaîtra ici une fois terminée');
      void backups.refetch();
    } catch (error) {
      notify.error(message(error, 'Le lancement a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sauvegardes"
        description="Copies complètes de la base, conservées 14 jours."
        actions={
          <Button size="sm" loading={busy} disabled={!canWrite} onClick={() => void trigger()}>
            <Database className="h-4 w-4" />
            Sauvegarder maintenant
          </Button>
        }
      />

      <Alert tone="info" title="Sauvegarde automatique">
        Un cliché est pris chaque nuit à 02h30 (heure d’Alger) et déposé dans le stockage
        configuré. Le format est celui de <code>pg_dump --format=custom</code> : la restauration se
        fait avec <code>pg_restore</code>, sélectivement si besoin. La procédure est détaillée dans
        le runbook.
      </Alert>

      {backups.isLoading ? (
        <Skeleton className="h-40 w-full" label="Chargement" />
      ) : (backups.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Database className="h-8 w-8" />}
          title="Aucune sauvegarde"
          description="Lancez-en une maintenant, ou attendez le cliché de cette nuit."
        />
      ) : (
        <Card>
          <CardBody className="flex flex-col gap-2">
            {(backups.data ?? []).map((backup) => (
              <div
                key={backup.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    {dateTimeFormatter.format(new Date(backup.createdAt))}
                    {backup.status === 'running' ? (
                      <Badge tone="warning">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        En cours
                      </Badge>
                    ) : backup.status === 'failed' ? (
                      <Badge tone="danger">Échouée</Badge>
                    ) : (
                      <Badge tone="success">Prête</Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {backup.status === 'ready'
                      ? `${formatSize(backup.sizeBytes)} · ${backup.key}`
                      : (backup.error ?? 'Le cliché est en cours d’écriture…')}
                  </p>
                </div>

                {backup.downloadUrl ? (
                  <a
                    href={backup.downloadUrl}
                    download
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-xs text-ink transition-colors hover:border-brass hover:text-brass"
                  >
                    <Download className="h-4 w-4" />
                    Télécharger
                  </a>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
