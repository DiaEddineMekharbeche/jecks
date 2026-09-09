import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, output } from 'zod';

/**
 * Validates a body, query or param against a Zod schema from `@jecks/shared`, so the
 * API and both frontends enforce exactly the same rules (PRD Section 9.2).
 *
 * Generic over the schema rather than its output type, because schemas with `.default()`
 * or `.transform()` have a different input type from their output.
 *
 * The ZodError is left to AllExceptionsFilter, which renders the field-level detail.
 */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny>
  implements PipeTransform<unknown, output<S>>
{
  constructor(private readonly schema: S) {}

  transform(value: unknown, _metadata: ArgumentMetadata): output<S> {
    return this.schema.parse(value) as output<S>;
  }
}

/** Shorthand for route parameters: `@Body(zod(checkoutSchema)) body: CheckoutInput`. */
export function zod<S extends ZodTypeAny>(schema: S): ZodValidationPipe<S> {
  return new ZodValidationPipe(schema);
}
