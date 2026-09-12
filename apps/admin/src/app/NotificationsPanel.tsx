import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  cn,
  notify,
} from '@jecks/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Inbox } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { dateTimeFormatter, message } from '@/lib/errors';

/**
 * The in-app inbox — PRD Section 6.1, M3.4.
 *
 * The worker has always written these rows: an in-app notification has no transport, so
 * the row is the delivery. Nothing read them back, which meant "stock is low" and
 * "a delivery failed" were recorded faithfully into a table nobody opened.
 *
 * Deliberately not the sound toggle beside it. That one decides whether a live event
 * chimes; this is the list of what happened while nobody was looking.
 */

interface NotificationRow {
  id: string;
  event: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  shared: boolean;
  createdAt: string;
}

interface Feed {
  items: NotificationRow[];
  unread: number;
}

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const feed = useQuery({
    queryKey: ['me', 'notifications'],
    queryFn: () => api<Feed>('/me/notifications'),
    // Open, it is a list somebody is reading. Closed, only the badge matters, and a
    // minute-old count is fine for something whose job is to be noticed eventually.
    refetchInterval: open ? 15_000 : 60_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api<NotificationRow>(`/me/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] }),
    onError: (error) => notify.error(message(error, 'Impossible de marquer comme lu')),
  });

  const markAll = useMutation({
    mutationFn: () => api<{ read: number }>('/me/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] }),
    onError: (error) => notify.error(message(error, 'Impossible de tout marquer')),
  });

  const unread = feed.data?.unread ?? 0;
  const items = feed.data?.items ?? [];

  function openItem(item: NotificationRow) {
    if (!item.read) markRead.mutate(item.id);
    if (!item.link) return;

    setOpen(false);
    // Links are written by the worker as admin paths, never as absolute URLs.
    navigate(item.link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} non lues` : 'Notifications'}
        >
          <Inbox className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass px-1 text-[10px] font-semibold tabular-nums text-on-brass">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(24rem,95vw)] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <p className="text-sm font-medium text-ink">Notifications</p>
          {unread > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="h-4 w-4" />
              Tout marquer
            </Button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {feed.isLoading ? (
            <div className="p-3">
              <Skeleton className="h-20 w-full" label="Chargement" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">Rien à signaler.</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-start transition-colors hover:bg-elevated',
                      !item.read && 'bg-brass/5',
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      {!item.read ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass"
                          aria-label="non lue"
                        />
                      ) : null}
                      <span
                        className={cn('text-sm', item.read ? 'text-muted' : 'font-medium text-ink')}
                      >
                        {item.title}
                      </span>
                      <span className="ms-auto shrink-0 text-[11px] text-muted">
                        {dateTimeFormatter.format(new Date(item.createdAt))}
                      </span>
                    </span>

                    {item.body ? (
                      <span className="line-clamp-2 text-xs text-muted">{item.body}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
