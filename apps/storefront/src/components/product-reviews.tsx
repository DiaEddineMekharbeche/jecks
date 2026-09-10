'use client';

import type { Locale, PublicReview, ReviewSummary } from '@jecks/shared';
import { Button, cn } from '@jecks/ui';
import { BadgeCheck, Star, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { clientApi, errorMessage } from '@/lib/client-api';
import { fill, fillCount, type Dictionary } from '@/lib/dictionary';

/**
 * Reviews on the product page — PRD F-ST-30.
 *
 * Loaded on the client rather than in the server render: the page is cached for every
 * shopper, reviews change on their own schedule, and paying for that with a shorter
 * cache on the whole product page is the wrong trade.
 */
export function ProductReviews({
  productId,
  locale,
  dictionary,
}: {
  productId: string;
  locale: Locale;
  dictionary: Dictionary;
}) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'recent' | 'helpful' | 'rating'>('recent');
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    clientApi<ReviewSummary>(`/reviews/product/${productId}`, {
      query: { page, pageSize: 5, sort },
    })
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setReviews((current) => (page === 1 ? data.reviews : [...current, ...data.reviews]));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productId, page, sort]);

  const hasMore = summary ? reviews.length < summary.total : false;

  return (
    <section aria-labelledby="reviews-title" className="border-t border-line pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="reviews-title" className="text-section">
            {dictionary.reviews.title}
          </h2>
          {summary && summary.count > 0 ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted">
              <Stars value={summary.average} />
              <span className="tabular-nums text-ink">{summary.average.toFixed(1)}</span>
              <span>
                {fillCount(
                  dictionary.reviews.basedOn,
                  dictionary.reviews.basedOnOne,
                  summary.count,
                )}
              </span>
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {summary && summary.count > 0 ? (
            <select
              value={sort}
              onChange={(event) => {
                setPage(1);
                setSort(event.target.value as typeof sort);
              }}
              aria-label={dictionary.listing.sort}
              className="rounded-xs border border-line bg-base px-3 py-2 text-sm outline-none focus:border-brass"
            >
              <option value="recent">{dictionary.reviews.sortRecent}</option>
              <option value="helpful">{dictionary.reviews.sortHelpful}</option>
              <option value="rating">{dictionary.reviews.sortRating}</option>
            </select>
          ) : null}
          <Button variant="outline" size="md" onClick={() => setWriting((open) => !open)}>
            {dictionary.reviews.write}
          </Button>
        </div>
      </div>

      {summary && summary.count > 0 ? (
        <div className="mt-6 grid gap-8 lg:grid-cols-[220px_1fr]">
          <Distribution summary={summary} />
          <ul className="flex flex-col gap-6">
            {reviews.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                dictionary={dictionary}
                locale={locale}
              />
            ))}
          </ul>
        </div>
      ) : loading ? (
        <p className="mt-6 text-sm text-muted">{dictionary.common.loading}</p>
      ) : (
        <div className="mt-6">
          <p className="text-sm text-muted">{dictionary.reviews.none}</p>
          <p className="text-sm text-muted">{dictionary.reviews.beFirst}</p>
        </div>
      )}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" loading={loading} onClick={() => setPage((value) => value + 1)}>
            {dictionary.reviews.loadMore}
          </Button>
        </div>
      ) : null}

      {writing ? (
        <ReviewForm
          productId={productId}
          dictionary={dictionary}
          onDone={() => {
            setWriting(false);
            setPage(1);
          }}
        />
      ) : null}
    </section>
  );
}

function Distribution({ summary }: { summary: ReviewSummary }) {
  return (
    <div className="flex flex-col gap-1.5">
      {[5, 4, 3, 2, 1].map((star) => {
        const count = summary.distribution[String(star)] ?? 0;
        const percent = summary.count === 0 ? 0 : Math.round((count / summary.count) * 100);
        return (
          <div key={star} className="flex items-center gap-2 text-xs">
            <span className="w-3 tabular-nums text-muted">{star}</span>
            <Star className="h-3 w-3 shrink-0 fill-brass text-brass" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
              <div className="h-full bg-brass" style={{ width: `${percent}%` }} />
            </div>
            <span className="w-8 text-end tabular-nums text-muted">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReviewCard({
  review,
  dictionary,
  locale,
}: {
  review: PublicReview;
  dictionary: Dictionary;
  locale: Locale;
}) {
  const [helpful, setHelpful] = useState(review.helpfulCount);
  const [voted, setVoted] = useState(false);

  const formatter = new Intl.DateTimeFormat(`${locale}-DZ`, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <li className="border-b border-line/60 pb-6 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={review.rating} />
        {review.title ? <span className="font-medium">{review.title}</span> : null}
        {review.verified ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <BadgeCheck className="h-3.5 w-3.5" />
            {dictionary.reviews.verified}
          </span>
        ) : null}
      </div>

      <p className="mt-2 whitespace-pre-line text-sm text-muted">{review.body}</p>

      <p className="mt-2 text-xs text-muted">
        {review.authorName} · {formatter.format(new Date(review.createdAt))}
      </p>

      {review.reply ? (
        <div className="mt-3 border-s-2 border-brass/40 ps-3">
          <p className="text-xs font-medium text-brass">{dictionary.reviews.shopReply}</p>
          <p className="mt-1 text-sm text-muted">{review.reply}</p>
        </div>
      ) : null}

      <button
        type="button"
        disabled={voted}
        onClick={() => {
          setVoted(true);
          setHelpful((value) => value + 1);
          void clientApi(`/reviews/${review.id}/helpful`, { method: 'POST' }).catch(() => {
            setVoted(false);
            setHelpful((value) => value - 1);
          });
        }}
        className={cn(
          'mt-3 inline-flex items-center gap-1.5 text-xs transition-colors',
          voted ? 'text-brass' : 'text-muted hover:text-ink',
        )}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
        {dictionary.reviews.helpful}
        {helpful > 0 ? <span className="tabular-nums">({helpful})</span> : null}
      </button>
    </li>
  );
}

function ReviewForm({
  productId,
  dictionary,
  onDone,
}: {
  productId: string;
  dictionary: Dictionary;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [authorName, setAuthorName] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <p className="mt-8 border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
        {dictionary.reviews.submitted}
      </p>
    );
  }

  return (
    <form
      className="mt-8 flex max-w-xl flex-col gap-4 border border-line p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await clientApi('/reviews', {
            method: 'POST',
            body: {
              productId,
              rating,
              title: title || undefined,
              body,
              authorName,
              phone: phone || undefined,
            },
          });
          setDone(true);
          onDone();
        } catch (submitError) {
          setError(errorMessage(submitError, dictionary.common.error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset>
        <legend className="eyebrow mb-2">{dictionary.reviews.formRating}</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              aria-label={fill('{count}', { count: star })}
              aria-pressed={rating === star}
              onClick={() => setRating(star)}
            >
              <Star
                className={cn(
                  'h-6 w-6 transition-colors',
                  star <= rating ? 'fill-brass text-brass' : 'text-line',
                )}
              />
            </button>
          ))}
        </div>
      </fieldset>

      <Labelled label={dictionary.reviews.formName}>
        <input
          required
          value={authorName}
          onChange={(event) => setAuthorName(event.target.value)}
          className="input-line"
        />
      </Labelled>

      <Labelled label={dictionary.reviews.formTitle}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="input-line"
        />
      </Labelled>

      <Labelled label={dictionary.reviews.formBody}>
        <textarea
          required
          rows={4}
          minLength={10}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="input-line"
        />
      </Labelled>

      <Labelled label={dictionary.reviews.formPhone}>
        <input
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="0550 11 22 33"
          className="input-line"
        />
      </Labelled>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={busy} disabled={body.trim().length < 10 || !authorName.trim()}>
        {dictionary.reviews.submit}
      </Button>
    </form>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="flex" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn('h-4 w-4', star <= Math.round(value) ? 'fill-brass text-brass' : 'text-line')}
        />
      ))}
    </span>
  );
}
