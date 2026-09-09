import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import { zod } from './zod-validation.pipe.js';

const meta = { type: 'body' } as ArgumentMetadata;

describe('ZodValidationPipe', () => {
  it('returns the parsed value', () => {
    const pipe = zod(z.object({ name: z.string() }));
    expect(pipe.transform({ name: 'cap' }, meta)).toEqual({ name: 'cap' });
  });

  it('applies defaults and coercions from the schema', () => {
    const pipe = zod(
      z.object({
        page: z.coerce.number().int().default(1),
        perPage: z.coerce.number().int().default(24),
      }),
    );
    expect(pipe.transform({ page: '3' }, meta)).toEqual({ page: 3, perPage: 24 });
  });

  it('applies transforms, so a phone reaches the service already normalized', () => {
    const pipe = zod(z.object({ phone: z.string().transform((v) => v.replace(/\s/g, '')) }));
    expect(pipe.transform({ phone: '0551 23 45 67' }, meta)).toEqual({ phone: '0551234567' });
  });

  it('throws ZodError, which the exception filter renders as 422', () => {
    const pipe = zod(z.object({ quantity: z.number().int().min(1) }));
    expect(() => pipe.transform({ quantity: 0 }, meta)).toThrow(ZodError);
  });

  it('strips unknown keys instead of trusting them', () => {
    const pipe = zod(z.object({ name: z.string() }));
    expect(pipe.transform({ name: 'cap', isAdmin: true }, meta)).toEqual({ name: 'cap' });
  });
});
