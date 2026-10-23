import { createRoute, z } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import { ErrorResponse } from '@screentime/schemas';
import { type AppDeps, createApp } from '../src/app.js';
import { ApiError, errorBody } from '../src/errors.js';
import { createRouter } from '../src/router.js';

describe('error responses', () => {
  it('answers an unknown path with 404 not_found', async () => {
    const res = await createApp({} as AppDeps).request('/nope');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(ErrorResponse.safeParse(body).success).toBe(true);
    expect(body).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });

  it('maps every ApiError code to its HTTP status', () => {
    const expected = {
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      validation_failed: 422,
      rate_limited: 429,
      internal: 500,
    } as const;
    for (const [code, status] of Object.entries(expected)) {
      expect(new ApiError(code as keyof typeof expected, 'x').status).toBe(status);
    }
  });

  it('leaves details out when there are none', () => {
    expect(errorBody('conflict', 'Taken.')).toEqual({ error: { code: 'conflict', message: 'Taken.' } });
    expect(errorBody('conflict', 'Taken.', { field: 'email' })).toEqual({
      error: { code: 'conflict', message: 'Taken.', details: { field: 'email' } },
    });
  });
});

describe('router error handling', () => {
  // A small test app built the same way as the real one.
  const test = createRouter();
  test.get('/api-error', () => {
    throw new ApiError('forbidden', 'Not your family.', { familyId: 'abc' });
  });
  test.get('/crash', () => {
    throw new Error('secret database detail');
  });
  test.openapi(
    createRoute({
      method: 'post',
      path: '/echo',
      request: {
        body: { content: { 'application/json': { schema: z.object({ name: z.string().min(1) }) } } },
      },
      responses: { 200: { description: 'ok' } },
    }),
    (c) => c.json({ name: c.req.valid('json').name }, 200),
  );

  it('sends an ApiError with its status, code, message and details', async () => {
    const res = await test.request('/api-error');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Not your family.', details: { familyId: 'abc' } },
    });
  });

  it('hides unexpected errors behind 500 internal', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await test.request('/crash');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(JSON.parse(text)).toEqual({ error: { code: 'internal', message: 'Something went wrong.' } });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('answers an invalid body with 422 validation_failed and the issues', async () => {
    const res = await test.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(ErrorResponse.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.issues[0].path).toEqual(['name']);
  });

  it('passes a valid body through', async () => {
    const res = await test.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alex' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Alex' });
  });
});
