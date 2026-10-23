import { z } from 'zod';

/** Response body of GET /health. */
export const HealthResponse = z
  .object({
    status: z.literal('ok'),
    service: z.string().min(1),
    time: z.iso.datetime(),
  })
  .meta({ id: 'HealthResponse' });

export type HealthResponse = z.infer<typeof HealthResponse>;
