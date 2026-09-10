import { ApiRequestError } from './api';

/**
 * Turns anything thrown by a mutation into a sentence an operator can act on.
 *
 * The API already writes its errors in French for the admin, so its message is used
 * verbatim when there is one; the fallback is only for a network failure, where the
 * browser's own message would be "Failed to fetch".
 */
export function message(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Formats minor units as dinars for read-only display. */
export const formatDa = (minor: string | number | bigint | null | undefined): string => {
  if (minor === null || minor === undefined) return '—';
  const value = Number(minor) / 100;
  return `${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 }).format(value)} DA`;
};

export const dateFormatter = new Intl.DateTimeFormat('fr-DZ', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
});

export const dateTimeFormatter = new Intl.DateTimeFormat('fr-DZ', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
