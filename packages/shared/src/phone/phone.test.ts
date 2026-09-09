import { describe, expect, it } from 'vitest';
import {
  InvalidPhoneError,
  isValidDzPhone,
  maskPhone,
  normalizeDzPhone,
  parseDzPhone,
  parseDzPhoneOrNull,
  telLink,
  whatsappLink,
} from './index.js';

describe('normalizeDzPhone', () => {
  const canonical = '+213551234567';

  it.each([
    ['0551234567', canonical],
    ['0551 23 45 67', canonical],
    ['0551-23-45-67', canonical],
    ['+213551234567', canonical],
    ['00213551234567', canonical],
    ['213551234567', canonical],
    ['+213 551 23 45 67', canonical],
    ['551234567', canonical],
    ['  0551234567  ', canonical],
    ['+2130551234567', canonical],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeDzPhone(input)).toBe(expected);
  });

  it('normalizes each mobile prefix', () => {
    expect(normalizeDzPhone('0661234567')).toBe('+213661234567');
    expect(normalizeDzPhone('0771234567')).toBe('+213771234567');
  });

  it('normalizes an Algiers landline, which has one digit fewer', () => {
    expect(normalizeDzPhone('021234567')).toBe('+21321234567');
    expect(normalizeDzPhone('+213 21 23 45 67')).toBe('+21321234567');
  });
});

describe('rejections', () => {
  it.each([
    ['', 'empty'],
    ['05512345', 'too short'],
    ['055123456789', 'too long'],
    ['0912345678', 'unknown prefix'],
    ['+33612345678', 'French number'],
    ['not a phone', 'letters'],
    ['0551-23-45-6a', 'trailing letter'],
  ])('rejects %s (%s)', (input) => {
    expect(isValidDzPhone(input)).toBe(false);
    expect(parseDzPhoneOrNull(input)).toBeNull();
    expect(() => normalizeDzPhone(input)).toThrow(InvalidPhoneError);
  });
});

describe('parseDzPhone', () => {
  it('identifies carriers by mobile prefix', () => {
    expect(parseDzPhone('0551234567').carrier).toBe('ooredoo');
    expect(parseDzPhone('0661234567').carrier).toBe('mobilis');
    expect(parseDzPhone('0771234567').carrier).toBe('djezzy');
  });

  it('marks landlines as non-mobile with no carrier', () => {
    const parsed = parseDzPhone('021234567');
    expect(parsed.isMobile).toBe(false);
    expect(parsed.carrier).toBe('unknown');
  });

  it('formats mobile numbers in readable national groups', () => {
    expect(parseDzPhone('0551234567').national).toBe('0551 23 45 67');
  });

  it('formats landlines with a three-digit area code', () => {
    expect(parseDzPhone('021234567').national).toBe('021 23 45 67');
  });

  it('exposes the country code', () => {
    expect(parseDzPhone('0551234567').countryCode).toBe('213');
  });
});

describe('links', () => {
  it('builds a wa.me link without a plus sign', () => {
    expect(whatsappLink('0551234567')).toBe('https://wa.me/213551234567');
  });

  it('url-encodes the prefilled message', () => {
    expect(whatsappLink('0551234567', 'Commande JK-1')).toContain('?text=Commande%20JK-1');
  });

  it('builds a tel link from the E.164 form', () => {
    expect(telLink('0551 23 45 67')).toBe('tel:+213551234567');
  });
});

describe('maskPhone', () => {
  it('keeps only the first and last two digits', () => {
    expect(maskPhone('0551234567')).toBe('+213 55•••••67');
  });

  it('degrades safely on invalid input', () => {
    expect(maskPhone('nope')).toBe('•••');
  });
});
