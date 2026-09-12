import sanitizeHtml from 'sanitize-html';

/**
 * Cleans the HTML a staff member wrote before it is stored.
 *
 * The storefront renders page bodies and product descriptions with
 * `dangerouslySetInnerHTML`, because a shop needs headings, lists and links in its
 * delivery policy. Until this existed the stored string was rendered verbatim: a
 * `<script>` typed into a product description ran on every visitor's browser.
 *
 * Cleaned on the way **in**, not on the way out. Storing something dangerous and
 * remembering to neutralise it at each of three render sites is a rule that holds until
 * somebody adds a fourth.
 *
 * The one dependency worth taking here. Parsing HTML correctly enough to be a security
 * boundary is not something to hand-roll, and it is the same category as Argon2 and
 * Prisma rather than the category of the mailer and the PDF writer (D88).
 */

/**
 * What a shop owner legitimately writes: structure, emphasis, links, tables, and images
 * from the media library. No `<script>`, no `<style>`, no `<iframe>`, no event handlers.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'div', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    // The editor writes alignment as a class; anything else is dropped by the filter
    // below rather than trusted.
    '*': ['class', 'dir'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
  },
  // `javascript:` and `data:` are how a link becomes a script. Images may come from the
  // media library over http(s) or as a relative key.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  // Anything not on the list goes, and its text with it for the tags where the content
  // is not meant to be read — a `<script>` body is not prose.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  transformTags: {
    // A link that opens a new tab without this can reach back into the opener.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target
        ? { ...attribs, rel: 'noopener noreferrer' }
        : attribs,
    }),
  },
  // Keep the class attribute honest: only the handful the editor emits.
  allowedClasses: {
    '*': ['text-start', 'text-center', 'text-end', 'lead', 'small'],
  },
};

/** One string. Returns an empty string for anything that is not one. */
export function sanitizeRichText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  return sanitizeHtml(value, OPTIONS);
}

/**
 * A translated field — `{ fr, ar, en }` — cleaned language by language.
 *
 * Returns the same shape, so a caller can hand it straight back to Prisma. Values that
 * are not strings are dropped rather than stored, because a JSON column will accept
 * anything and the render site will not.
 */
export function sanitizeTranslatedRichText(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const out: Record<string, string> = {};

  for (const [locale, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text !== 'string') continue;
    out[locale] = sanitizeRichText(text);
  }

  return out;
}

export const __richTextInternals = { OPTIONS };
