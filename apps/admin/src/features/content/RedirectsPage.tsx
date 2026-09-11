import type { RedirectRow } from '@jecks/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { dateFormatter, message } from '@/lib/errors';
import * as content from './api';

/**
 * Redirects — PRD F-AD-90.
 *
 * Sorted by how often each is actually used, because that is the list worth reading: a
 * redirect with thousands of hits is a link somebody important still has, and one with
 * none can be deleted without thinking about it.
 */
export function RedirectsPage() {
  const [fromPath, setFromPath] = useState('');
  const [toPath, setToPath] = useState('');
  const [statusCode, setStatusCode] = useState('301');
  const [busy, setBusy] = useState(false);

  const redirects = useQuery({
    queryKey: ['admin', 'redirects'],
    queryFn: content.listRedirects,
  });

  async function add() {
    setBusy(true);
    try {
      await content.createRedirect({
        fromPath: fromPath.trim(),
        toPath: toPath.trim(),
        statusCode: Number(statusCode),
      });
      notify.success('Redirection ajoutée');
      setFromPath('');
      setToPath('');
      await redirects.refetch();
    } catch (error) {
      notify.error(message(error, "L'ajout a échoué"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(redirect: RedirectRow) {
    const warning =
      redirect.hits > 0
        ? `Cette redirection a servi ${redirect.hits} fois. La supprimer ?`
        : 'Supprimer cette redirection ?';
    if (!window.confirm(warning)) return;

    try {
      await content.deleteRedirect(redirect.id);
      notify.success('Redirection supprimée');
      await redirects.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Redirections"
        description="Les anciennes adresses, et où elles mènent maintenant."
      />

      <Alert tone="info" title="Écrites toutes seules quand c’est possible">
        Renommer une page publiée crée la redirection automatiquement. Celles-ci sont pour les
        adresses venues d’ailleurs.
      </Alert>

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Ancienne adresse" className="min-w-[220px] flex-1">
            <Input
              value={fromPath}
              onChange={(event) => setFromPath(event.target.value)}
              placeholder="/ancienne-page"
              className="font-mono text-xs"
            />
          </Field>
          <ArrowRight className="mb-2.5 h-4 w-4 shrink-0 text-muted" />
          <Field label="Nouvelle adresse" className="min-w-[220px] flex-1">
            <Input
              value={toPath}
              onChange={(event) => setToPath(event.target.value)}
              placeholder="/nouvelle-page"
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Type" className="w-[180px]">
            <Select
              value={statusCode}
              onValueChange={setStatusCode}
              options={[
                { value: '301', label: '301 — permanente' },
                { value: '302', label: '302 — temporaire' },
              ]}
            />
          </Field>
          <Button
            loading={busy}
            disabled={!fromPath.trim() || !toPath.trim()}
            onClick={() => void add()}
          >
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        </CardBody>
      </Card>

      {redirects.isLoading ? (
        <Skeleton className="h-48" label="Chargement des redirections" />
      ) : (redirects.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucune redirection"
          description="Rien à rediriger pour l’instant, ce qui est bon signe."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {redirects.data!.map((redirect) => (
                <li key={redirect.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="font-mono text-xs">{redirect.fromPath}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
                    {redirect.toPath}
                  </span>

                  <Badge tone={redirect.statusCode === 301 ? 'neutral' : 'info'}>
                    {redirect.statusCode}
                  </Badge>
                  <span className="w-20 text-end text-xs tabular-nums text-muted">
                    {redirect.hits} fois
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted">
                    {dateFormatter.format(new Date(redirect.createdAt))}
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Supprimer"
                    onClick={() => void remove(redirect)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
