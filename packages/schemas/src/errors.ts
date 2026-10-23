import { z } from 'zod';

/** Machine-readable error codes (docs/SPEC.md §9). */
export const ErrorCode = z
  .enum(['unauthorized', 'forbidden', 'not_found', 'conflict', 'validation_failed', 'rate_limited', 'internal'])
  .meta({ id: 'ErrorCode' });

export type ErrorCode = z.infer<typeof ErrorCode>;

/** Body of every error response. */
export const ErrorResponse = z
  .object({
    error: z.object({
      code: ErrorCode,
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });

export type ErrorResponse = z.infer<typeof ErrorResponse>;
