import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@screentime/schemas';
import { app } from '../src/app.js';

describe('GET /health', () => {
  it('returns 200 with a valid health body', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(HealthResponse.safeParse(body).success).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('screentime-server');
  });

  it('returns 404 for an unknown path', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
  });
});
