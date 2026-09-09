import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
import { Prisma } from '@jecks/db';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AllExceptionsFilter } from './http-exception.filter.js';

interface Captured {
  status: number;
  body: {
    data: null;
    error: { code: string; message: string; details?: unknown };
    meta: { correlationId?: string };
  };
}

function capture(exception: unknown): Captured {
  const captured = {} as Captured;
  const response = {
    status: (status: number) => {
      captured.status = status;
      return {
        json: (body: Captured['body']) => {
          captured.body = body;
        },
      };
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', url: '/api/v1/test', correlationId: 'abc123' }),
    }),
  } as unknown as ArgumentsHost;

  // The filter logs; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

describe('AllExceptionsFilter', () => {
  it('renders a Zod failure as 422 with field-level detail', () => {
    const schema = z.object({ phone: z.string().min(9, 'Too short') });
    const error = schema.safeParse({ phone: '05' });
    const result = capture(error.success ? new Error('unexpected') : error.error);

    expect(result.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
    expect(result.body.error.details).toEqual([{ path: 'phone', message: 'Too short' }]);
  });

  it('keeps the code an HttpException supplied', () => {
    const result = capture(
      new BadRequestException({ code: 'NO_SHIPPING_RATE', message: 'We do not deliver there' }),
    );
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('NO_SHIPPING_RATE');
    expect(result.body.error.message).toBe('We do not deliver there');
  });

  it('derives a code from the status when the exception carries none', () => {
    expect(capture(new NotFoundException('Nope')).body.error.code).toBe('NOT_FOUND');
    expect(capture(new ForbiddenException('Nope')).body.error.code).toBe('FORBIDDEN');
  });

  it('maps a unique-constraint violation to 409 naming the field', () => {
    const error = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '6',
      meta: { target: ['sku'] },
    });
    const result = capture(error);
    expect(result.status).toBe(HttpStatus.CONFLICT);
    expect(result.body.error.code).toBe('ALREADY_EXISTS');
    expect(result.body.error.message).toContain('sku');
  });

  it('maps a missing record to 404 and a bad reference to 400', () => {
    const missing = new Prisma.PrismaClientKnownRequestError('none', {
      code: 'P2025',
      clientVersion: '6',
    });
    expect(capture(missing).status).toBe(HttpStatus.NOT_FOUND);

    const fk = new Prisma.PrismaClientKnownRequestError('fk', {
      code: 'P2003',
      clientVersion: '6',
    });
    expect(capture(fk).body.error.code).toBe('INVALID_REFERENCE');
  });

  it('hides the detail of an unexpected error', () => {
    const result = capture(new Error('connection string leaked here'));
    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(result.body.error.message).not.toContain('connection string');
  });

  it('hides the detail of an unmapped Prisma error', () => {
    const error = new Prisma.PrismaClientKnownRequestError('boom', {
      code: 'P2010',
      clientVersion: '6',
    });
    expect(capture(error).body.error.code).toBe('DATABASE_ERROR');
  });

  it('echoes the correlation id so a support ticket can be traced', () => {
    expect(capture(new NotFoundException('x')).body.meta.correlationId).toBe('abc123');
  });

  it('joins the array of messages a validation pipe produces', () => {
    const result = capture(
      new HttpException({ message: ['a is required', 'b is required'] }, HttpStatus.BAD_REQUEST),
    );
    expect(result.body.error.message).toBe('a is required, b is required');
  });
});
