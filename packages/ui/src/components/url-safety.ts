/**
 * The link schemes the server also allows (D102).
 *
 * Checked in the editor so a `javascript:` link is refused while it is being typed,
 * rather than silently dropped on save — which would read as the editor losing work.
 */
export function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;

  // A bare domain or a relative path is fine; the browser resolves it.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;

  return /^(https?|mailto|tel):/i.test(trimmed);
}
