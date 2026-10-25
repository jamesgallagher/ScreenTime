import type { AuthResponse } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { Api, ApiError } from '@/lib/api';

interface Call {
  path: string;
  method: string;
  authorization: string | null;
  body: string | null;
}

const me: AuthResponse['me'] = {
  parent: { id: '11111111-1111-4111-8111-111111111111', email: 'dad@example.com', displayName: 'Dad', phoneE164: null },
  family: { id: '22222222-2222-4222-8222-222222222222', name: 'Gallaghers', timezone: 'Australia/Sydney', emergencyNumber: '000' },
  roles: ['parent'],
};
const auth = (accessToken: string): AuthResponse => ({ accessToken, expiresIn: 900, me });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unauthorized = () => json(401, { error: { code: 'unauthorized', message: 'Sign in again.' } });

/** A fake server: `answer` decides each response; every call is recorded. */
function fakeFetch(answer: (call: Call, calls: Call[]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const call = {
      path,
      method: init.method ?? 'GET',
      authorization: headers.get('authorization'),
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(call);
    return answer(call, calls);
  };
  return { calls, fetchFn };
}

describe('Api', () => {
  it('signs in as the web client and sends the access token on later calls', async () => {
    const { calls, fetchFn } = fakeFetch((call) => {
      if (call.path === '/v1/auth/otp/verify') return json(200, auth('token-1'));
      return json(200, { kids: [] });
    });
    const api = new Api(fetchFn);
    const seen: (AuthResponse | null)[] = [];
    api.onAuthChange((a) => seen.push(a));

    await api.verifyCode('dad@example.com', '123456');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      email: 'dad@example.com',
      code: '123456',
      client: 'web',
      clientLabel: 'Web browser',
    });
    expect(seen).toEqual([auth('token-1')]);

    expect(await api.get('/v1/kids')).toEqual({ kids: [] });
    expect(calls[1]).toEqual({ path: '/v1/kids', method: 'GET', authorization: 'Bearer token-1', body: null });
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    const { calls, fetchFn } = fakeFetch((call) => {
      if (call.path === '/v1/auth/otp/verify') return json(200, auth('old'));
      if (call.path === '/v1/auth/refresh') return json(200, auth('new'));
      return call.authorization === 'Bearer new' ? json(200, { ok: true }) : unauthorized();
    });
    const api = new Api(fetchFn);
    await api.verifyCode('dad@example.com', '123456');

    expect(await api.post('/v1/things', { a: 1 })).toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.path} ${c.authorization ?? '-'}`)).toEqual([
      'POST /v1/auth/otp/verify -',
      'POST /v1/things Bearer old',
      'POST /v1/auth/refresh -',
      'POST /v1/things Bearer new',
    ]);
    expect(calls[2]?.body).toBe('{}');
    expect(calls[3]?.body).toBe('{"a":1}');
  });

  it('shares one refresh between calls made together before any sign-in', async () => {
    const { calls, fetchFn } = fakeFetch(async (call) => {
      if (call.path === '/v1/auth/refresh') {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(200, auth('from-cookie'));
      }
      return json(200, { path: call.path });
    });
    const api = new Api(fetchFn);

    const results = await Promise.all([api.get('/v1/a'), api.get('/v1/b'), api.refresh()]);
    expect(results[0]).toEqual({ path: '/v1/a' });
    expect(results[1]).toEqual({ path: '/v1/b' });
    expect(results[2]).toEqual(auth('from-cookie'));
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('signs out when the refresh cookie no longer works', async () => {
    const { calls, fetchFn } = fakeFetch(() => unauthorized());
    const api = new Api(fetchFn);
    const seen: (AuthResponse | null)[] = [];
    api.onAuthChange((a) => seen.push(a));

    expect(await api.refresh()).toBeNull();
    await expect(api.get('/v1/kids')).rejects.toEqual(new ApiError(401, 'unauthorized', 'Sign in again.'));
    expect(seen).toEqual([null, null]);
    expect(calls.map((c) => c.path)).toEqual(['/v1/auth/refresh', '/v1/auth/refresh']);
  });

  it('turns error answers and network failures into ApiError', async () => {
    const api = new Api(async (path) => {
      if (path === '/v1/auth/otp/request') {
        return json(429, { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' } });
      }
      if (path === '/v1/auth/otp/verify') return new Response('Bad gateway', { status: 502 });
      throw new TypeError('Failed to fetch');
    });

    const limited = await api.requestCode('dad@example.com').catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(ApiError);
    expect(limited).toMatchObject({ status: 429, code: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' });
    await expect(api.verifyCode('dad@example.com', '123456')).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
      message: 'Something went wrong (502). Try again.',
    });
    await expect(api.refresh()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('signs out on the server and locally, even when the server call fails', async () => {
    const { calls, fetchFn } = fakeFetch((call) => {
      if (call.path === '/v1/auth/otp/verify') return json(200, auth('token-1'));
      throw new TypeError('Failed to fetch');
    });
    const api = new Api(fetchFn);
    const seen: (AuthResponse | null)[] = [];
    await api.verifyCode('dad@example.com', '123456');
    api.onAuthChange((a) => seen.push(a));

    await api.signOut();
    expect(calls[1]).toEqual({ path: '/v1/auth/logout', method: 'POST', authorization: 'Bearer token-1', body: null });
    expect(seen).toEqual([null]);
  });
});
