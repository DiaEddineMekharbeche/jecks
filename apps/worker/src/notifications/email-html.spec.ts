import { describe, expect, it } from 'vitest';
import {
  esc,
  localPhone,
  renderOwnerOrderEmail,
  renderTextEmail,
  type OwnerOrderEmail,
} from './email-html.js';

/**
 * What the owner's inbox is shown. The layout is judged by eye; what is pinned here is what
 * must never go wrong whatever it looks like: a stranger's text cannot become markup, the
 * facts the owner acts on are all there, and an absent field leaves no hole.
 */

const order = (overrides: Partial<OwnerOrderEmail> = {}): OwnerOrderEmail => ({
  storeName: 'Jeck’s',
  orderNumber: 'JK-261008-0005',
  placedAt: '8 oct. 2026, 19:42',
  source: 'Instagram',
  customerName: 'Amel Zidane',
  customerPhone: '+213661223344',
  wilaya: 'Alger',
  commune: 'Bab Ezzouar',
  deliveryType: 'HOME',
  address: 'Cité 1000 logements, bâtiment B',
  items: [{ quantity: 2, name: 'Jecks Marina', variant: 'Beige', total: '8 400,00 DA' }],
  subtotal: '8 400,00 DA',
  discount: null,
  shipping: '500,00 DA',
  total: '8 900,00 DA',
  note: null,
  orderUrl: 'https://admin.example/orders/abc',
  ...overrides,
});

describe('renderOwnerOrderEmail', () => {
  it('carries what the owner needs to act on the order', () => {
    const html = renderOwnerOrderEmail(order());

    for (const fact of [
      'JK-261008-0005',
      'Amel Zidane',
      'Bab Ezzouar, Alger',
      'Cité 1000 logements, bâtiment B',
      'Jecks Marina',
      '8 900,00 DA',
      'Instagram',
      'https://admin.example/orders/abc',
    ]) {
      expect(html).toContain(fact);
    }
  });

  it('turns the phone into a link that dials, and shows it the way it is dialled locally', () => {
    const html = renderOwnerOrderEmail(order());

    expect(html).toContain('href="tel:+213661223344"');
    expect(html).toContain('0661 22 33 44');
  });

  it('never lets what a customer typed become markup', () => {
    const html = renderOwnerOrderEmail(
      order({
        customerName: '<script>alert(1)</script>',
        address: '"><img src=x onerror=alert(1)>',
        note: '<b>urgent</b> & vite',
        items: [{ quantity: 1, name: '<i>Casquette</i>', variant: '"x"', total: '1 DA' }],
      }),
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>urgent');
    expect(html).not.toContain('<i>Casquette');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;urgent&lt;/b&gt; &amp; vite');
  });

  it('leaves out the note, the discount and the button when there is none', () => {
    const html = renderOwnerOrderEmail(order({ note: null, discount: null, orderUrl: null }));

    expect(html).not.toContain('Note du client');
    expect(html).not.toContain('Remise');
    expect(html).not.toContain('Ouvrir la commande');
  });

  it('shows a discount and a note when there are some', () => {
    const html = renderOwnerOrderEmail(order({ discount: '500,00 DA', note: 'Après 18h' }));

    expect(html).toContain('Remise');
    expect(html).toContain('Après 18h');
  });

  it('does not print an address for a pickup-point order', () => {
    const html = renderOwnerOrderEmail(
      order({ deliveryType: 'STOP_DESK', address: 'ne pas afficher' }),
    );

    expect(html).toContain('Retrait en point relais');
    expect(html).not.toContain('ne pas afficher');
  });

  it('puts the total in the hidden preview line a mail list shows', () => {
    expect(renderOwnerOrderEmail(order())).toContain('8 900,00 DA · Alger · 0661 22 33 44');
  });
});

describe('renderTextEmail', () => {
  it('sets paragraphs apart and keeps single line breaks', () => {
    const html = renderTextEmail({
      storeName: 'Jeck’s',
      subject: 'Merci',
      text: 'Bonjour,\n\nPremière ligne\nDeuxième ligne',
    });

    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain('Première ligne<br>Deuxième ligne');
  });

  it('links an address, and escapes everything around it', () => {
    const html = renderTextEmail({
      storeName: 'Jeck’s',
      subject: null,
      text: 'Suivi : https://jecks-co.com/fr/track?a=1&b=2 <b>x</b>',
    });

    expect(html).toContain('href="https://jecks-co.com/fr/track?a=1&amp;b=2"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('reads right to left for Arabic', () => {
    expect(
      renderTextEmail({ storeName: 'Jeck’s', subject: null, text: 'مرحبا', rtl: true }),
    ).toContain('dir="rtl"');
  });
});

describe('helpers', () => {
  it('escapes the five characters that matter', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('leaves a number it cannot read alone', () => {
    expect(localPhone('+33612345678')).toBe('+33612345678');
    expect(localPhone('+213551122334')).toBe('0551 12 23 34');
  });
});
