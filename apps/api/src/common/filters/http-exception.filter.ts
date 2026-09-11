import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@jecks/db';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ErrorReporter } from '../../modules/ops/error-reporter.js';

/**
 * Single error shape for the whole API: `{ error: { code, message, details } }`,
 * matching the envelope of PRD Section 10.3. Nothing internal leaks in production —
 * stack traces stay in the log, never in the body.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  /**
   * Optional so the filter can be constructed bare in a test, and so a deployment with
   * no reporter configured behaves exactly as it did before there was one.
   */
  constructor(private readonly reporter?: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const { status, code, message, details } = describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );

      // Only server errors are reported. A 404 or a failed validation is the system
      // working; sending those would bury the ones that are not.
      void this.reporter
        ?.capture(exception instanceof Error ? exception : new Error(String(exception)), {
          correlationId: request.correlationId,
          route: request.path,
          method: request.method,
          userId: (request as { user?: { id?: string } }).user?.id ?? null,
        })
        .catch(() => undefined);
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${code}: ${message}`);
    }

    response.status(status).json({
      data: null,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
      meta: { correlationId: request.correlationId },
    });
  }
}

interface Described {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

function describe(exception: unknown): Described {
  if (exception instanceof ZodError) {
    return {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'VALIDATION_FAILED',
      message: 'Some fields need attention',
      details: exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return { status, code: codeFromStatus(status), message: body };
    }
    const record = body as Record<string, unknown>;
    return {
      status,
      code: typeof record.code === 'string' ? record.code : codeFromStatus(status),
      message:
        typeof record.message === 'string'
          ? record.message
          : Array.isArray(record.message)
            ? record.message.join(', ')
            : exception.message,
      details: record.details,
    };
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    return describePrisma(exception);
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong on our side',
  };
}

function describePrisma(error: Prisma.PrismaClientKnownRequestError): Described {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
      return {
        status: HttpStatus.CONFLICT,
        code: 'ALREADY_EXISTS',
        message: `That ${target} is already taken`,
      };
    }
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_REFERENCE',
        message: 'A referenced record does not exist',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'That record does not exist',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'DATABASE_ERROR',
        message: 'Something went wrong on our side',
      };
  }
}

function codeFromStatus(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_FAILED',
    429: 'TOO_MANY_REQUESTS',
  };
  return map[status] ?? 'ERROR';
}
