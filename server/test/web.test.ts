import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type AppDeps, createApp } from '../src/app.js';
import { testConfig } from './helpers.js';

// A tiny stand-in for web/dist. These routes touch no database.
const webDir = fileURLToPath(new URL('./fixtures/web', import.meta.url));
const app = createApp({ config: { ...testConfig('postgres://unused'), webDir } } as AppDeps);

describe('web app', () => {
  it('serves index.html at / with the security headers', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toContain('<div id="root"></div>');
  });

  it('serves index.html for a page of the app, so a reload or a shared link works', async () => {
    for (const path of ['/kids', '/kids/3f2a', '/settings', '/admin']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain('<div id="root"></div>');
    }
  });

  it('serves a hashed asset with a long cache and a file in the root with none', async () => {
    const asset = await app.request('/assets/app-1a2b3c.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await asset.text()).toContain("console.log('app');");

    const icon = await app.request('/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers a missing file with the JSON 404, not the app', async () => {
    const res = await app.request('/assets/missing.js');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('never serves the app for an API path', async () => {
    for (const path of ['/v1', '/v1/nope', '/v1/kids/3f2a/nope']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type'), path).toContain('application/json');
    }
    const health = await app.request('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });
  });

  it('never reads a file outside the folder', async () => {
    // Each one tries to reach this test file, two folders up from the fixture.
    for (const path of ['/../../web.test.ts', '/%2e%2e/%2e%2e/web.test.ts', '/assets/..%2f..%2f..%2fweb.test.ts']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('serves nothing when WEB_DIR is not set', async () => {
    const apiOnly = createApp({ config: testConfig('postgres://unused') } as AppDeps);
    const res = await apiOnly.request('/');
    expect(res.status).toBe(404);
  });
});
