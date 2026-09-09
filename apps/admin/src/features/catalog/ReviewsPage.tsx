import { ReviewStatus, t, type ReviewRow } from '@jecks/shared';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  TablePagination,
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  Check,
  Download,
  ImageOff,
  MessageSquareReply,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useServerTable } from '@/lib/server-table';
import * as catalog from './api';
import { message } from './ProductsListPage';
import { useCatalogInvalidate } from './queries';

/**
 * Review moderation — PRD F-AD-12.
 *
 * Cards rather than a table: a moderator reads the text and looks at the photos before
 * deciding, and neither survives being squeezed into a table cell. Approving recomputes
 * the product's star rating server-side, so the catalogue never shows an average that
 * counts a review nobody has approved.
 */

const STATUS_TABS = [
  { value: 'ALL', label: 'Tous' },
  { value: ReviewStatus.PENDING, label: 'À modérer' },
  { value: ReviewStatus.APPROVED, label: 'Publiés' },
  { value: ReviewStatus.REJECTED, label: 'Refusés' },
];

const dateFormatter = new Intl.DateTimeFormat('fr-DZ', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function ReviewsPage() {
  const invalidate = useCatalogInvalidate();

  const table = useServerTable<ReviewRow>({
    module: 'reviews',
    endpoint: '/admin/reviews',
    defaultSort: 'createdAt',
    defaultPageSize: 20,
    filterKeys: ['status', 'rating', 'productId', 'verified'],
  });

  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState<ReviewRow | null>(null);

  const { data: counts = {} } = useQuery({
    queryKey: ['admin', 'reviews', 'counts', table.filters],
    queryFn: () => catalog.getReviewCounts(withoutStatus(table.filters)),
    staleTime: 30_000,
  });

  const activeStatus = table.filters.status ?? [];

  async function moderate(ids: string[], status: ReviewStatus) {
    setBusy(true);
    try {
      const result = await catalog.moderateReviews({ ids, status });
      notify.success(
        status === ReviewStatus.APPROVED
          ? `${result.updated} avis publié${result.updated > 1 ? 's' : ''}`
          : status === ReviewStatus.REJECTED
            ? `${result.updated} avis refusé${result.updated > 1 ? 's' : ''}`
            : `${result.updated} avis remis en attente`,
      );
      table.clearSelection();
      table.refetch();
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La modération a échoué'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(review: ReviewRow) {
    if (!window.confirm('Supprimer définitivement cet avis ?')) return;
    setBusy(true);
    try {
      await catalog.deleteReview(review.id);
      notify.success('Avis supprimé');
      table.refetch();
      invalidate();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    } finally {
      setBusy(false);
    }
  }

  const selected = table.selectedIds;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Avis"
        description="Publiez, refusez ou répondez. Seuls les avis publiés comptent dans la note du produit."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                Exporter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Format</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void table.exportRows('csv')}>CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void table.exportRows('xlsx')}>
                Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
          {STATUS_TABS.map((tab) => {
            const isSelected =
              tab.value === 'ALL' ? activeStatus.length === 0 : activeStatus.includes(tab.value);
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={isSelected}
                onClick={() =>
                  tab.value === 'ALL'
                    ? table.setFilter('status', [])
                    : table.setFilter('status', isSelected ? [] : [tab.value])
                }
                className={cn(
                  'relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                  isSelected
                    ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brass'
                    : 'text-muted hover:text-ink',
                )}
              >
                {tab.label}
                <span className="text-xs tabular-nums opacity-70">{counts[tab.value] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            className="h-9 w-64 ps-9"
            placeholder="Texte, titre ou auteur…"
            defaultValue={table.search}
            onChange={(event) => table.setSearch(event.target.value)}
            aria-label="Rechercher un avis"
          />
        </div>

        <Select
          className="h-9 w-40"
          value={table.filters.rating?.[0] ?? ''}
          onValueChange={(value) => table.setFilter('rating', value ? [value] : [])}
          placeholder="Note"
          options={[
            { value: '', label: 'Toutes les notes' },
            ...[5, 4, 3, 2, 1].map((rating) => ({
              value: String(rating),
              label: `${rating} étoile${rating > 1 ? 's' : ''}`,
            })),
          ]}
        />

        <Select
          className="h-9 w-48"
          value={table.filters.verified?.[0] ?? ''}
          onValueChange={(value) => table.setFilter('verified', value ? [value] : [])}
          placeholder="Achat vérifié"
          options={[
            { value: '', label: 'Vérifié ou non' },
            { value: 'true', label: 'Achat vérifié' },
            { value: 'false', label: 'Non vérifié' },
          ]}
        />

        {table.activeFilterCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={table.clearFilters}>
            <X className="h-3.5 w-3.5" />
            {table.activeFilterCount} filtre{table.activeFilterCount > 1 ? 's' : ''}
          </Button>
        ) : null}

        <span className="ms-auto text-sm text-muted">{table.total} avis</span>
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xs border border-brass bg-brass/5 px-3 py-2">
          <span className="text-sm">{selected.length} sélectionné(s)</span>
          <Button
            size="sm"
            loading={busy}
            onClick={() => void moderate(selected, ReviewStatus.APPROVED)}
          >
            <Check className="h-3.5 w-3.5" />
            Publier
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={busy}
            onClick={() => void moderate(selected, ReviewStatus.REJECTED)}
          >
            <X className="h-3.5 w-3.5" />
            Refuser
          </Button>
          <Button variant="ghost" size="sm" onClick={table.clearSelection}>
            Annuler la sélection
          </Button>
        </div>
      ) : null}

      {table.loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-36 w-full" label="Chargement des avis" />
          ))}
        </div>
      ) : table.error ? (
        <EmptyState
          title="Avis indisponibles"
          description={table.error.message}
          action={
            <Button variant="outline" size="sm" onClick={table.refetch}>
              Réessayer
            </Button>
          }
        />
      ) : table.rows.length === 0 ? (
        <EmptyState
          title="Aucun avis"
          description={
            table.activeFilterCount > 0
              ? 'Aucun avis ne correspond à ces filtres.'
              : 'Les avis clients apparaîtront ici après les premières livraisons.'
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {table.rows.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              busy={busy}
              selected={Boolean(table.rowSelection[review.id])}
              onSelect={(next) =>
                table.setRowSelection((current) => ({ ...current, [review.id]: next }))
              }
              onApprove={() => void moderate([review.id], ReviewStatus.APPROVED)}
              onReject={() => void moderate([review.id], ReviewStatus.REJECTED)}
              onReply={() => setReplying(review)}
              onRemove={() => void remove(review)}
            />
          ))}
        </div>
      )}

      <TablePagination
        page={table.page}
        pageSize={table.pageSize}
        total={table.total}
        loading={table.fetching}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />

      <ReplyDialog
        review={replying}
        onOpenChange={(open) => {
          if (!open) setReplying(null);
        }}
        onDone={() => {
          table.refetch();
          setReplying(null);
        }}
      />
    </div>
  );
}

function ReviewCard({
  review,
  busy,
  selected,
  onSelect,
  onApprove,
  onReject,
  onReply,
  onRemove,
}: {
  review: ReviewRow;
  busy: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
  onReply: () => void;
  onRemove: () => void;
}) {
  return (
    <Card className={cn(selected && 'border-brass')}>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
            aria-label={`Sélectionner l’avis de ${review.authorName}`}
            className="mt-1 h-4 w-4 accent-current"
          />

          {review.thumbnailUrl ? (
            <img
              src={review.thumbnailUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xs border border-line object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xs border border-line">
              <ImageOff className="h-4 w-4 text-muted" aria-hidden />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-muted">{t(review.productName, 'fr')}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <Stars rating={review.rating} />
              <span className="text-sm font-medium">{review.authorName}</span>
              {review.verified ? (
                <Badge tone="success">
                  <BadgeCheck className="h-2.5 w-2.5" aria-hidden />
                  Achat vérifié
                </Badge>
              ) : null}
              <StatusPill status={review.status} />
              <span className="text-xs text-muted">
                {dateFormatter.format(new Date(review.createdAt))}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {review.status !== ReviewStatus.APPROVED ? (
              <Button size="sm" loading={busy} onClick={onApprove}>
                <Check className="h-3.5 w-3.5" />
                Publier
              </Button>
            ) : null}
            {review.status !== ReviewStatus.REJECTED ? (
              <Button variant="outline" size="sm" loading={busy} onClick={onReject}>
                <X className="h-3.5 w-3.5" />
                Refuser
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={onReply}>
              <MessageSquareReply className="h-3.5 w-3.5" />
              {review.reply ? 'Modifier la réponse' : 'Répondre'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Supprimer l’avis">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {review.title ? <p className="font-medium">{review.title}</p> : null}
        <p className="whitespace-pre-line text-sm">{review.body}</p>

        {review.mediaUrls.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {review.mediaUrls.map((url) => (
              <li key={url}>
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="h-20 w-20 rounded-xs border border-line object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}

        {review.reply ? (
          <div className="rounded-xs border-s-2 border-brass bg-base px-3 py-2">
            <p className="text-xs uppercase tracking-wider text-brass">Réponse de la boutique</p>
            <p className="mt-1 whitespace-pre-line text-sm">{review.reply}</p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} sur 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={cn('h-3.5 w-3.5', value <= rating ? 'fill-brass text-brass' : 'text-line')}
          aria-hidden
        />
      ))}
    </span>
  );
}

function StatusPill({ status }: { status: ReviewStatus }) {
  if (status === ReviewStatus.APPROVED) return <Badge tone="success">Publié</Badge>;
  if (status === ReviewStatus.REJECTED) return <Badge tone="danger">Refusé</Badge>;
  return <Badge tone="warning">À modérer</Badge>;
}

function ReplyDialog({
  review,
  onOpenChange,
  onDone,
}: {
  review: ReviewRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  if (review && seededFor !== review.id) {
    setSeededFor(review.id);
    setReply(review.reply ?? '');
  }
  if (!review && seededFor !== null) setSeededFor(null);

  async function submit() {
    if (!review) return;
    setSaving(true);
    try {
      await catalog.replyToReview(review.id, reply.trim());
      notify.success(reply.trim() ? 'Réponse publiée' : 'Réponse retirée');
      onDone();
    } catch (error) {
      notify.error(message(error, 'La réponse a échoué'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={review !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Répondre à {review?.authorName}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {review ? (
            <blockquote className="rounded-xs border-s-2 border-line ps-3 text-sm text-muted">
              {review.body}
            </blockquote>
          ) : null}

          <Field
            label="Réponse publique"
            hint="Affichée sous l’avis sur la fiche produit. Videz le champ pour la retirer."
          >
            <Textarea
              rows={5}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Merci pour votre retour…"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            Publier la réponse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function withoutStatus(filters: Record<string, string[]>): Record<string, string[]> {
  const { status: _ignored, ...rest } = filters;
  return rest;
}
