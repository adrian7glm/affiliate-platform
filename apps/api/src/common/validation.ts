import { type ArgumentMetadata, Body, type PipeTransform, Query } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<T> {
    return this.schema.parse(value ?? {}) as z.infer<T>;
  }
}

/** Validates and parses the request body with a zod schema from @ap/contracts. */
export const ZodBody = <T extends ZodTypeAny>(schema: T) => Body(new ZodPipe(schema));
export const ZodQuery = <T extends ZodTypeAny>(schema: T) => Query(new ZodPipe(schema));
