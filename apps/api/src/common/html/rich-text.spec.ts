import { describe, expect, it } from 'vitest';
import { sanitizeRichText, sanitizeTranslatedRichText } from './rich-text.js';

/**
 * The sanitiser that stands between a staff account and every visitor's browser.
 *
 * A product description typed with a `<script>` in it used to run on the storefront,
 * because the page renders the stored string with `dangerouslySetInnerHTML`. These
 * assert on both halves: what must be removed, and what must survive — a sanitiser that
 * eats the shop's delivery policy gets turned off within a week.
 */

describe('sanitizeRichText — what it removes', () => {
  it('removes a script tag and its contents', () => {
    const clean = sanitizeRichText('<p>Bonjour</p><script>window.pwned = 1</script>');

    expect(clean).toBe('<p>Bonjour</p>');
    expect(clean).not.toContain('pwned');
  });

  it('removes an inline event handler', () => {
    // The payload that does not need a script tag at all.
    const clean = sanitizeRichText('<img src="x" onerror="alert(1)">');

    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('alert');
  });

  it('removes a javascript: link', () => {
    const clean = sanitizeRichText('<a href="javascript:alert(1)">Cliquez</a>');

    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('Cliquez');
  });

  it('removes a data: URL, which is another way to run script', () => {
    const clean = sanitizeRichText('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');

    expect(clean).not.toContain('data:');
  });

  it('removes an iframe, however friendly it looks', () => {
    const clean = sanitizeRichText('<iframe src="https://example.com"></iframe>');

    expect(clean).not.toContain('iframe');
  });

  it('removes a style block, which can reach outside its element', () => {
    const clean = sanitizeRichText('<style>body{display:none}</style><p>Texte</p>');

    expect(clean).toBe('<p>Texte</p>');
  });

  it('removes an inline style attribute', () => {
    const clean = sanitizeRichText('<p style="position:fixed;inset:0">Texte</p>');

    expect(clean).not.toContain('style');
    expect(clean).toContain('Texte');
  });

  it('does not keep an unknown class it was not told about', () => {
    const clean = sanitizeRichText('<p class="text-center evil-overlay">Texte</p>');

    expect(clean).toContain('text-center');
    expect(clean).not.toContain('evil-overlay');
  });

  it('leaves a nested malformed tag as inert text, not as markup', () => {
    // A half-written tag is how a naive regex sanitiser gets walked past: strip
    // "<script>" once and "<scr<script>ipt>" becomes "<script>". A real parser leaves
    // the leftovers as escaped text, which renders as characters and runs nothing.
    const clean = sanitizeRichText('<scr<script>ipt>alert(1)</script>');

    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('<scr');
    // What is left is text. The angle bracket is escaped, so the browser prints it.
    expect(clean).toContain('&gt;');
  });

  it('adds noopener to a link that opens a new tab', () => {
    const clean = sanitizeRichText('<a href="https://example.com" target="_blank">x</a>');

    expect(clean).toContain('rel="noopener noreferrer"');
  });
});

describe('sanitizeRichText — what it keeps', () => {
  it('keeps the structure a delivery policy is written in', () => {
    const source =
      '<h2>Livraison</h2><p>Nous livrons dans les <strong>58 wilayas</strong>.</p>' +
      '<ul><li>Domicile</li><li>Stop desk</li></ul>';

    expect(sanitizeRichText(source)).toBe(source);
  });

  it('keeps a real link and a real image', () => {
    const source =
      '<p>Voir <a href="https://jecks.dz/fr/contact" title="Contact">nous écrire</a></p>' +
      '<img src="https://cdn.jecks.dz/media/a.jpg" alt="Casquette">';

    const clean = sanitizeRichText(source);

    expect(clean).toContain('href="https://jecks.dz/fr/contact"');
    expect(clean).toContain('alt="Casquette"');
  });

  it('keeps a table, because size guides are tables', () => {
    const source = '<table><tr><th scope="col">Taille</th><td>58 cm</td></tr></table>';

    expect(sanitizeRichText(source)).toContain('<th scope="col">Taille</th>');
  });

  it('keeps Arabic text and its direction', () => {
    const source = '<p dir="rtl">نوصل إلى 58 ولاية</p>';

    expect(sanitizeRichText(source)).toBe(source);
  });

  it('leaves plain text alone', () => {
    expect(sanitizeRichText('Nous livrons partout.')).toBe('Nous livrons partout.');
  });
});

describe('sanitizeRichText — edges', () => {
  it('answers with an empty string for anything that is not one', () => {
    expect(sanitizeRichText(null)).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
    expect(sanitizeRichText(42)).toBe('');
    expect(sanitizeRichText({ fr: 'x' })).toBe('');
    expect(sanitizeRichText('   ')).toBe('');
  });
});

describe('sanitizeTranslatedRichText', () => {
  it('cleans every language and keeps the shape', () => {
    const clean = sanitizeTranslatedRichText({
      fr: '<p>Bonjour</p><script>a()</script>',
      ar: '<p>مرحبا</p>',
      en: '<p>Hello</p>',
    });

    expect(clean).toEqual({ fr: '<p>Bonjour</p>', ar: '<p>مرحبا</p>', en: '<p>Hello</p>' });
  });

  it('drops a language whose value is not text', () => {
    // A JSON column accepts anything; the render site does not.
    const clean = sanitizeTranslatedRichText({ fr: '<p>ok</p>', ar: { nested: true }, en: 7 });

    expect(clean).toEqual({ fr: '<p>ok</p>' });
  });

  it('passes null and nonsense through as null, so an optional field stays optional', () => {
    expect(sanitizeTranslatedRichText(null)).toBeNull();
    expect(sanitizeTranslatedRichText(undefined)).toBeNull();
    expect(sanitizeTranslatedRichText('a string')).toBeNull();
    expect(sanitizeTranslatedRichText(['a'])).toBeNull();
  });
});
