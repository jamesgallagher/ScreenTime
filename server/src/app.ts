import { createRoute } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { ErrorResponse, HealthResponse } from '@screentime/schemas';
import { createRouter } from './router.js';

export const app = createRouter();

if (process.env.NODE_ENV !== 'test') {
  app.use(logger());
}

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['public'],
  summary: 'Check that the server is up',
  responses: {
    200: {
      description: 'The server is up.',
      content: { 'application/json': { schema: HealthResponse } },
    },
    500: {
      description: 'Unexpected server error.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

app.openapi(healthRoute, (c) => {
  const body = HealthResponse.parse({
    status: 'ok',
    service: 'screentime-server',
    time: new Date().toISOString(),
  });
  return c.json(body, 200);
});

/** The OpenAPI 3.1 document for every route above (written to contract/openapi.json). */
export function openApiDocument(): ReturnType<typeof app.getOpenAPI31Document> {
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Screen Time API', version: '0.1.0' },
  });
}
