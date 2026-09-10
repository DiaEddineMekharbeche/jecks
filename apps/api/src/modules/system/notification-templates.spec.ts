import { describe, expect, it } from 'vitest';
import { renderTemplate } from './notification-templates.service.js';

describe('renderTemplate', () => {
  it('substitutes named variables', () => {
    expect(
      renderTemplate('Bonjour {{customerName}}, commande {{orderNumber}} confirmée.', {
        customerName: 'Yacine',
        orderNumber: 'JK-260910-0042',
      }),
    ).toBe('Bonjour Yacine, commande JK-260910-0042 confirmée.');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ total }} et {{total}}', { total: '4 900 DA' })).toBe(
      '4 900 DA et 4 900 DA',
    );
  });

  it('leaves an unknown variable visible instead of blanking it', () => {
    // A message reading "Bonjour {{firstName}}" tells the owner exactly what to fix.
    expect(renderTemplate('Bonjour {{firstName}}', {})).toBe('Bonjour {{firstName}}');
  });

  it('substitutes an empty string when the value is genuinely empty', () => {
    expect(renderTemplate('Tel: {{storePhone}}.', { storePhone: '' })).toBe('Tel: .');
  });

  it('does not treat the substituted value as a template', () => {
    // Otherwise a customer named "{{total}}" would rewrite the rest of the message.
    expect(
      renderTemplate('Bonjour {{customerName}}, total {{total}}', {
        customerName: '{{total}}',
        total: '900 DA',
      }),
    ).toBe('Bonjour {{total}}, total 900 DA');
  });

  it('ignores single braces and malformed markers', () => {
    expect(renderTemplate('{total} {{ }} {{}}', { total: '1' })).toBe('{total} {{ }} {{}}');
  });

  it('handles Arabic bodies and right-to-left text unchanged', () => {
    expect(renderTemplate('مرحبا {{customerName}}', { customerName: 'ياسين' })).toBe(
      'مرحبا ياسين',
    );
  });

  it('returns an empty template unchanged', () => {
    expect(renderTemplate('', { a: 'b' })).toBe('');
  });
});
