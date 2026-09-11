import { PAGE_KINDS, t, type PageDetail, type PageKind, type PageRow } from '@jecks/shared';
import {
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
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SwitchField,
  TranslatedInput,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { dateFormatter, message } from '@/lib/errors';
import * as content from './api';
import { PAGE_KIND_LABELS } from './labels';

/**
 * Pages, posts and legal notices — PRD F-AD-90.
 *
 * Renaming a published page writes the redirect for the old address, because a shop
 * that changes "/livraison" to "/expedition" has just broken every link to it and will
 * not find out for months.
 */
export function PagesPage() {
  const [kind, setKind] = useState<string>('');
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);

  const pages = useQuery({
    queryKey: ['admin', 'pages', kind],
    queryFn: () => content.listPages(kind || undefined),
  });

  async function remove(page: PageRow) {
    if (!window.confirm(`Supprimer « ${t(page.title, 'fr')} » ?`)) return;
    try {
      await content.deletePage(page.id);
      notify.success('Page supprimée');
      await pages.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Pages"
        description="Les contenus fixes : livraison, retours, mentions légales, articles."
        actions={
          <>
            <Field label="Type" className="w-[180px]">
              <Select
                value={kind}
                onValueChange={setKind}
                options={[
                  { value: '', label: 'Tous' },
                  ...PAGE_KINDS.map((value) => ({
                    value,
                    label: PAGE_KIND_LABELS[value] ?? value,
                  })),
                ]}
              />
            </Field>
            <Button size="sm" onClick={() => setEditingId('new')}>
              <Plus className="h-4 w-4" />
              Nouvelle page
            </Button>
          </>
        }
      />

      {pages.isLoading ? (
        <Skeleton className="h-64" label="Chargement des pages" />
      ) : (pages.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucune page"
          description="Les conditions de livraison et de retour sont les deux que les clients cherchent."
          action={
            <Button size="sm" onClick={() => setEditingId('new')}>
              <Plus className="h-4 w-4" />
              Nouvelle page
            </Button>
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {pages.data!.map((page) => (
                <li
                  key={page.id}
                  className={cn('flex flex-wrap items-center gap-3 px-4 py-3', !page.published && 'opacity-70')}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium text-ink">
                      {t(page.title, 'fr')}
                      {page.published ? (
                        <Badge tone="success">publiée</Badge>
                      ) : (
                        <Badge tone="neutral">brouillon</Badge>
                      )}
                    </p>
                    <p className="truncate font-mono text-xs text-muted">/{page.slug}</p>
                  </div>

                  <span className="text-xs text-muted">
                    {PAGE_KIND_LABELS[page.kind] ?? page.kind}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted">
                    {dateFormatter.format(new Date(page.updatedAt))}
                  </span>

                  <div className="flex items-center gap-1">
                    {page.published ? (
                      <a
                        href={`/${page.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-elevated hover:text-ink"
                        aria-label="Voir la page"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(page.id)}>
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Supprimer"
                      onClick={() => void remove(page)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {editingId ? (
        <PageDialog
          pageId={editingId === 'new' ? null : editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            void pages.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function PageDialog({
  pageId,
  onClose,
  onSaved,
}: {
  pageId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = useQuery({
    queryKey: ['admin', 'page', pageId],
    queryFn: () => content.getPage(pageId!),
    enabled: Boolean(pageId),
  });

  const [seeded, setSeeded] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState<Partial<Record<string, string>>>({ fr: '' });
  const [body, setBody] = useState<Partial<Record<string, string>>>({ fr: '' });
  const [excerpt, setExcerpt] = useState<Partial<Record<string, string>>>({ fr: '' });
  const [seoTitle, setSeoTitle] = useState<Partial<Record<string, string>>>({ fr: '' });
  const [seoDescription, setSeoDescription] = useState<Partial<Record<string, string>>>({ fr: '' });
  const [kind, setKind] = useState<PageKind>('page');
  const [published, setPublished] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loaded = existing.data as PageDetail | undefined;
  if (loaded && seeded !== loaded.id) {
    setSeeded(loaded.id);
    setSlug(loaded.slug);
    setTitle(loaded.title);
    setBody(loaded.body);
    setExcerpt(loaded.excerpt ?? { fr: '' });
    setSeoTitle(loaded.seoTitle ?? { fr: '' });
    setSeoDescription(loaded.seoDescription ?? { fr: '' });
    setKind(loaded.kind);
    setPublished(loaded.published);
  }

  const slugChanged = Boolean(loaded && loaded.slug !== slug && loaded.published);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        slug: slug.trim(),
        title,
        body,
        excerpt: excerpt.fr ? excerpt : null,
        seoTitle: seoTitle.fr ? seoTitle : null,
        seoDescription: seoDescription.fr ? seoDescription : null,
        heroMediaId: loaded?.heroMediaId ?? null,
        kind,
        published,
      };

      if (pageId) await content.updatePage(pageId, payload);
      else await content.createPage(payload);

      notify.success(pageId ? 'Page mise à jour' : 'Page créée');
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{pageId ? 'Modifier la page' : 'Nouvelle page'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {pageId && existing.isLoading ? (
            <Skeleton className="h-64" label="Chargement de la page" />
          ) : (
            <>
              <Field label="Titre" required>
                <TranslatedInput value={title} onChange={setTitle} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Adresse" required error={errors.slug}>
                  <Input
                    value={slug}
                    onChange={(event) =>
                      setSlug(
                        event.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]+/g, '-')
                          .replace(/^-|-$/g, ''),
                      )
                    }
                    className="font-mono"
                    placeholder="livraison"
                  />
                </Field>
                <Field label="Type">
                  <Select
                    value={kind}
                    onValueChange={(value) => setKind(value as PageKind)}
                    options={PAGE_KINDS.map((value) => ({
                      value,
                      label: PAGE_KIND_LABELS[value] ?? value,
                    }))}
                  />
                </Field>
              </div>

              {slugChanged ? (
                <p className="rounded-sm bg-info/10 px-3 py-2 text-xs text-info">
                  L’ancienne adresse /{loaded!.slug} redirigera automatiquement vers la nouvelle.
                </p>
              ) : null}

              <Field label="Contenu" required>
                <TranslatedInput value={body} onChange={setBody} multiline rows={10} />
              </Field>

              <Field label="Résumé" hint="Utilisé dans les listes et le partage.">
                <TranslatedInput value={excerpt} onChange={setExcerpt} multiline rows={2} />
              </Field>

              <Field label="Titre SEO">
                <TranslatedInput value={seoTitle} onChange={setSeoTitle} />
              </Field>

              <Field label="Description SEO">
                <TranslatedInput
                  value={seoDescription}
                  onChange={setSeoDescription}
                  multiline
                  rows={2}
                />
              </Field>

              <SwitchField label="Publiée" checked={published} onCheckedChange={setPublished} />
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!slug.trim() || !title.fr?.trim() || !body.fr?.trim()}
            onClick={() => void submit()}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
