import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { z, ZodSchema } from 'zod';

/**
 * A pipe that validates request DTOs using a given Zod schema. Attached inline:
 *   @Body(new ZodValidationPipe(createOrderSchema)) dto: CreateOrderInput
 */
export class ZodValidationPipe<T extends ZodSchema> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      throw new BadRequestException({
        message: 'Request validation failed',
        details: issues,
        code: 'VALIDATION_ERROR',
      });
    }
    return result.data;
  }
}
