import { Hono } from 'hono';
import { HealthResponse } from '@screentime/schemas';

export const app = new Hono();

app.get('/health', (c) => {
  const body = HealthResponse.parse({
    status: 'ok',
    service: 'screentime-server',
    time: new Date().toISOString(),
  });
  return c.json(body);
});
