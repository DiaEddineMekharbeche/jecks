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
import { CheckCircle2, Layers, RefreshCw, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/features/auth/session';
import { dateTimeFormatter, message } from '@/lib/errors';
import * as settingsApi from './api';
import type { FailedJob, QueueCounts } from './api';
import { useQueues } from './queries';

/**
 * Background jobs — PRD Section 10.5.
 *
 * This replaces Bull Board. What an operator needs from a queue dashboard is four
 * numbers per queue and the last few failures with their reason, and mounting a second
 * application inside this one to get them means a second thing to keep behind auth.
 *
 * The numbers are read from the same Redis keys BullMQ writes, so this is the same
 * truth, behind the permission everything else uses.
 */

/** French names for the six queues, in the order an operator cares about them. */
const LABELS: Record<string, string> = {
  notifications: 'Notifications',
  couriers: 'Transporteurs',
  media: 'Médias',
  reports: 'Rapports',
  scheduling: 'Planification',
  maintenance: 'Maintenance',
};

export function QueuesPage() {
  const queues = useQueues();
  const canWrite = useSession((state) => state.can)('settings.write');
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(job: FailedJob) {
    setRetrying(`${job.queue}/${job.id}`);
    try {
      const result = await settingsApi.retryJob(job.queue, job.id);
      if (result.retried) {
        notify.success('Tâche remise en file');
      } else {
        notify.error('La tâche n’est plus dans la liste des échecs');
      }
      void queues.refetch();
    } catch (error) {
      notify.error(message(error, 'La relance a échoué'));
    } finally {
      setRetrying(null);
    }
  }

  const state = queues.data;
  const failures = state?.failures ?? [];
  const stuck = (state?.queues ?? []).filter((queue) => queue.waiting > 50 && queue.active === 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Files d’attente"
        description="Ce que le worker traite en arrière-plan, et ce qui a échoué."
        actions={
          <Button
            size="sm"
            variant="ghost"
            loading={queues.isFetching}
            onClick={() => void queues.refetch()}
          >
            <RefreshCw className="h-4 w-4" />
            Actualiser
          </Button>
        }
      />

      {queues.isError ? (
        <Alert tone="danger" title="Lecture impossible">
          {message(queues.error, 'Les files n’ont pas pu être lues.')}
        </Alert>
      ) : null}

      {state && !state.reachable ? (
        <Alert tone="danger" title="Redis est injoignable">
          Aucune tâche de fond ne s’exécute : ni notifications, ni synchronisation des
          transporteurs, ni statistiques de nuit. La boutique continue de vendre. Vérifiez le
          conteneur Redis avant toute autre chose.
        </Alert>
      ) : null}

      {stuck.length > 0 ? (
        <Alert tone="warning" title="Une file s’accumule">
          {stuck.map((queue) => LABELS[queue.name] ?? queue.name).join(', ')} — des tâches
          attendent sans qu’aucune ne s’exécute. Le worker est probablement arrêté.
        </Alert>
      ) : null}

      {queues.isLoading ? (
        <Skeleton className="h-32 w-full" label="Chargement" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(state?.queues ?? []).map((queue) => (
            <QueueCard key={queue.name} queue={queue} />
          ))}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Échecs récents</h2>

        {queues.isLoading ? (
          <Skeleton className="h-24 w-full" label="Chargement" />
        ) : failures.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-8 w-8" />}
            title="Aucun échec"
            description="Toutes les tâches des sept derniers jours se sont terminées."
          />
        ) : (
          <Card>
            <CardBody className="flex flex-col gap-2">
              {failures.map((job) => (
                <div
                  key={`${job.queue}/${job.id}`}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-sm border border-line px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {job.name}
                      <Badge tone="neutral">{LABELS[job.queue] ?? job.queue}</Badge>
                      <span className="text-xs font-normal text-muted">
                        {job.attempts} tentative{job.attempts > 1 ? 's' : ''}
                        {job.failedAt
                          ? ` · ${dateTimeFormatter.format(new Date(job.failedAt))}`
                          : ''}
                      </span>
                    </p>
                    <p className="mt-0.5 break-words text-xs text-danger">{job.reason}</p>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canWrite}
                    loading={retrying === `${job.queue}/${job.id}`}
                    onClick={() => void retry(job)}
                  >
                    <RotateCw className="h-4 w-4" />
                    Relancer
                  </Button>
                </div>
              ))}
            </CardBody>
          </Card>
        )}
      </section>
    </div>
  );
}

function QueueCard({ queue }: { queue: QueueCounts }) {
  // Waiting and failed are the two numbers worth a colour; the rest are context.
  const tone = queue.failed > 0 ? 'text-danger' : queue.waiting > 0 ? 'text-brass' : 'text-ink';

  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Layers className="h-4 w-4 text-muted" />
          {LABELS[queue.name] ?? queue.name}
        </p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
          <Row label="En attente" value={queue.waiting} className={tone} />
          <Row label="En cours" value={queue.active} />
          <Row label="Échouées" value={queue.failed} className={queue.failed > 0 ? 'text-danger' : undefined} />
          <Row label="Différées" value={queue.delayed} />
          <Row label="Terminées" value={queue.completed} />
          <Row label="Récurrentes" value={queue.scheduled} />
        </div>
      </CardBody>
    </Card>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      {label}
      <span className={className ?? 'text-ink'}>{value.toLocaleString('fr-DZ')}</span>
    </span>
  );
}
