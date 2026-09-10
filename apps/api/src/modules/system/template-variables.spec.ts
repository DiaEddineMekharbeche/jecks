import { NOTIFICATION_EVENTS, TEMPLATE_VARIABLES } from '@jecks/shared';
import { describe, expect, it } from 'vitest';
import { renderTemplate } from './notification-templates.service.js';

/**
 * The contract between the seeded templates, the variable list the editor offers, and
 * what the dispatcher actually supplies.
 *
 * A variable name that drifts between the three does not fail a build or a test unless
 * something checks: it renders as a literal `{{orderNumber}}` in a real SMS, and nobody
 * finds out until a customer forwards one.
 */

/** Variables the dispatcher builds for an order-shaped event. */
const ORDER_CONTEXT = [
  'storeName',
  'storePhone',
  'customerName',
  'orderNumber',
  'total',
  'trackingUrl',
  'courier',
  'trackingNumber',
  'wilaya',
  'customerPhone',
  'productName',
  'reviewUrl',
];

/** Variables it builds for a product or variant event. */
const PRODUCT_CONTEXT = ['storeName', 'productName', 'productUrl', 'sku', 'available', 'locationName'];

/** Supplied by the caller rather than derived — the abandoned cart and the sign-in code. */
const CALLER_SUPPLIED = ['cartUrl', 'promoCode', 'code', 'minutes', 'reason', 'driverName', 'driverPhone'];

const AVAILABLE = new Set([...ORDER_CONTEXT, ...PRODUCT_CONTEXT, ...CALLER_SUPPLIED]);

describe('template variables', () => {
  it('offers a variable list for every event the shop can send', () => {
    const missing = NOTIFICATION_EVENTS.filter((event) => !TEMPLATE_VARIABLES[event]);
    expect(missing).toEqual([]);
  });

  it('only offers variables something actually supplies', () => {
    const orphans: string[] = [];

    for (const [event, variables] of Object.entries(TEMPLATE_VARIABLES)) {
      for (const variable of variables) {
        if (!AVAILABLE.has(variable)) orphans.push(`${event}.${variable}`);
      }
    }

    // A variable the editor offers but nothing fills renders as a literal placeholder.
    expect(orphans).toEqual([]);
  });

  it('uses camelCase throughout, matching the dispatcher', () => {
    const wrong: string[] = [];
    for (const [event, variables] of Object.entries(TEMPLATE_VARIABLES)) {
      for (const variable of variables) {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(variable)) wrong.push(`${event}.${variable}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('renders every offered variable when the context supplies it', () => {
    for (const [event, variables] of Object.entries(TEMPLATE_VARIABLES)) {
      const body = variables.map((variable) => `{{${variable}}}`).join(' ');
      const context = Object.fromEntries(variables.map((variable) => [variable, 'x']));

      const rendered = renderTemplate(body, context);

      // Nothing left unrendered for the event's own declared variables.
      expect(rendered, event).not.toContain('{{');
    }
  });
});
