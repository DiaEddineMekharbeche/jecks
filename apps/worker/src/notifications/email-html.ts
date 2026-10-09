/**
 * The HTML side of an e-mail.
 *
 * Mail clients are not browsers: Outlook draws with Word's engine, Gmail strips <style> in
 * some views, and none of them run CSS grid. So this is the old, boring and reliable
 * construction: nested tables, inline styles, a 600 px column, system fonts and no images
 * (a wordmark in text cannot be blocked). It degrades to a plain stack on a narrow phone.
 *
 * Everything that came from a customer — name, address, note — passes through `esc`. The
 * order note is typed by a stranger into a public form and ends up in the owner's inbox.
 */

const INK = '#16130e';
const BRASS = '#c9a24d';
const MUTED = '#6f6a60';
const LINE = '#e7e3da';
const PAPER = '#f4f2ed';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export interface OwnerOrderEmail {
  storeName: string;
  orderNumber: string;
  /** Already formatted, in the shop's time zone. */
  placedAt: string;
  /** "Instagram", "Site web"… — where the order came from. */
  source: string | null;
  customerName: string;
  customerPhone: string;
  wilaya: string;
  commune: string;
  deliveryType: string;
  address: string | null;
  items: Array<{ quantity: number; name: string; variant: string | null; total: string }>;
  subtotal: string;
  discount: string | null;
  shipping: string;
  total: string;
  note: string | null;
  orderUrl: string | null;
}

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 0661223344 reads better than +213661223344 to somebody about to dial it. */
export function localPhone(e164: string): string {
  const match = /^\+213(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return match ? `0${match[1]}${match[2]} ${match[3]} ${match[4]} ${match[5]}` : e164;
}

export function renderOwnerOrderEmail(order: OwnerOrderEmail): string {
  const home = order.deliveryType === 'HOME';
  const where = [order.commune, order.wilaya].filter(Boolean).map(esc).join(', ');

  const rows = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:15px;line-height:1.4;color:${INK};">
            <span style="color:${MUTED};">${item.quantity} ×</span> ${esc(item.name)}${
              item.variant
                ? `<br><span style="font-size:13px;color:${MUTED};">${esc(item.variant)}</span>`
                : ''
            }
          </td>
          <td align="right" style="padding:14px 0 14px 12px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:15px;color:${INK};white-space:nowrap;">${esc(item.total)}</td>
        </tr>`,
    )
    .join('');

  const sumRow = (label: string, value: string, strong = false) => `
        <tr>
          <td style="padding:6px 0;font-family:${FONT};font-size:${strong ? 16 : 14}px;font-weight:${strong ? 700 : 400};color:${strong ? INK : MUTED};">${esc(label)}</td>
          <td align="right" style="padding:6px 0;font-family:${FONT};font-size:${strong ? 16 : 14}px;font-weight:${strong ? 700 : 400};color:${INK};white-space:nowrap;">${esc(value)}</td>
        </tr>`;

  const body = `
    <tr>
      <td style="padding:32px 32px 8px;">
        <div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${BRASS};">Nouvelle commande</div>
        <div style="margin-top:6px;font-family:${FONT};font-size:26px;font-weight:700;letter-spacing:-.01em;color:${INK};">${esc(order.orderNumber)}</div>
        <div style="margin-top:6px;font-family:${FONT};font-size:13px;color:${MUTED};">${esc(order.placedAt)}${
          order.source
            ? ` &nbsp;·&nbsp; <span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${PAPER};color:${INK};font-weight:600;">${esc(order.source)}</span>`
            : ''
        }</div>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};border-radius:12px;">
          <tr>
            <td style="padding:22px 24px;">
              <div style="font-family:${FONT};font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#bdb6a6;">Total à encaisser</div>
              <div style="margin-top:4px;font-family:${FONT};font-size:34px;font-weight:700;letter-spacing:-.02em;color:${BRASS};">${esc(order.total)}</div>
              <div style="margin-top:2px;font-family:${FONT};font-size:13px;color:#bdb6a6;">dont livraison ${esc(order.shipping)} · paiement à la réception</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 32px 4px;">
        <div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};">Client</div>
        <div style="margin-top:8px;font-family:${FONT};font-size:18px;font-weight:600;color:${INK};">${esc(order.customerName)}</div>
        <div style="margin-top:10px;">
          <a href="tel:${esc(order.customerPhone)}" style="display:inline-block;padding:9px 16px;border-radius:8px;border:1px solid ${INK};font-family:${FONT};font-size:15px;font-weight:600;color:${INK};text-decoration:none;">&#9742;&nbsp; ${esc(localPhone(order.customerPhone))}</a>
        </div>
        <div style="margin-top:14px;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};">
          ${where}<br>
          <span style="color:${MUTED};">${home ? 'Livraison à domicile' : 'Retrait en point relais'}</span>${
            home && order.address ? `<br>${esc(order.address)}` : ''
          }
        </div>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 32px 0;">
        <div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};">Articles</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${rows}</table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
          ${sumRow('Sous-total', order.subtotal)}
          ${order.discount ? sumRow('Remise', `− ${order.discount}`) : ''}
          ${sumRow('Livraison', order.shipping)}
          ${sumRow('Total', order.total, true)}
        </table>
      </td>
    </tr>
    ${
      order.note
        ? `<tr>
      <td style="padding:20px 32px 0;">
        <div style="padding:14px 16px;border-left:3px solid ${BRASS};background:#faf6ea;border-radius:0 8px 8px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK};">
          <span style="font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};">Note du client</span><br>${esc(order.note).replace(/\n/g, '<br>')}
        </div>
      </td>
    </tr>`
        : ''
    }
    ${
      order.orderUrl
        ? `<tr>
      <td align="center" style="padding:28px 32px 8px;">
        <a href="${esc(order.orderUrl)}" style="display:inline-block;padding:14px 28px;border-radius:10px;background:${INK};font-family:${FONT};font-size:15px;font-weight:700;color:${BRASS};text-decoration:none;">Ouvrir la commande</a>
      </td>
    </tr>`
        : ''
    }
    <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>`;

  return shell({
    storeName: order.storeName,
    preheader: `${order.total} · ${order.wilaya} · ${localPhone(order.customerPhone)}`,
    body,
    footer: `Vous recevez cet e-mail à chaque nouvelle commande sur ${esc(order.storeName)}.`,
  });
}

/**
 * Any other e-mail: the template's text, set in the same frame.
 *
 * Paragraphs on blank lines, line breaks kept, and a bare address turned into a link —
 * so the templates the shop edits in the admin stay plain text and still look designed.
 */
export function renderTextEmail(input: {
  storeName: string;
  subject: string | null;
  text: string;
  rtl?: boolean;
}): string {
  const paragraphs = input.text
    .trim()
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};">${linkify(esc(block)).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

  const body = `
    <tr>
      <td style="padding:32px 32px 16px;" dir="${input.rtl ? 'rtl' : 'ltr'}">
        ${
          input.subject
            ? `<div style="margin:0 0 20px;font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:-.01em;color:${INK};">${esc(input.subject)}</div>`
            : ''
        }
        ${paragraphs}
      </td>
    </tr>`;

  return shell({
    storeName: input.storeName,
    preheader: input.text.replace(/\s+/g, ' ').slice(0, 110),
    body,
    footer: esc(input.storeName),
  });
}

function linkify(escaped: string): string {
  return escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) =>
      `<a href="${url}" style="color:${INK};font-weight:600;text-decoration:underline;">${url}</a>`,
  );
}

function shell(input: {
  storeName: string;
  preheader: string;
  body: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(input.storeName)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
        <tr>
          <td align="center" style="padding:8px 0 20px;font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:.32em;color:${INK};">${esc(input.storeName.toUpperCase())}</td>
        </tr>
        <tr>
          <td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid ${LINE};overflow:hidden;">
              <tr><td style="height:5px;line-height:5px;font-size:0;background:${BRASS};">&nbsp;</td></tr>${input.body}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 16px 8px;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">${input.footer}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
