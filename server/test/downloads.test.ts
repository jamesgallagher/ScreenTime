import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import type { Mailer } from '../src/mailer.js';
import type { Pusher } from '../src/push.js';
import { testConfig } from './helpers.js';

// No database is touched: the downloads only read the releases folder.
describe('downloads', () => {
  const { db, pool } = createDb('postgres://unused:unused@localhost:1/unused');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pusher: Pusher = { async send() { return []; } };
  const releases = mkdtempSync(join(tmpdir(), 'screentime-downloads-'));
  const app = createApp({ db, config: { ...testConfig('postgres://unused'), releasesDir: releases }, mailer, pusher });
  const get = (path: string) => app.request(path);

  const publish = (json: string, file: string, body: string, over: Record<string, unknown> = {}) => {
    writeFileSync(join(releases, file), body);
    writeFileSync(join(releases, json), JSON.stringify({ versionName: '0.1.1', sizeBytes: body.length, file, ...over }));
  };

  afterAll(async () => {
    rmSync(releases, { recursive: true, force: true });
    await pool.end();
  });

  beforeEach(() => {
    for (const name of readdirSync(releases)) rmSync(join(releases, name), { force: true });
  });

  it('says null for what has not been published, without a sign-in', async () => {
    const res = await get('/v1/downloads');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kid: null, parent: null, windows: null });
  });

  it('lists the latest of each, with the name a browser saves it as', async () => {
    publish('parent.json', 'parent-2.apk', 'parent', { versionCode: 2, sha256: 'a'.repeat(64) });
    publish('windows.json', 'ScreenTime-0.1.70.msi', 'msi-bytes', { versionName: '0.1.70' });
    publish('kid.json', 'kid-2.apk', 'kid', { versionCode: 2, deviceIds: ['01a1c909-3aca-78a0-8ab8-ee0d62cfedb8'] });
    const body = await (await get('/v1/downloads')).json();
    expect(body).toEqual({
      kid: { versionName: '0.1.1', sizeBytes: 3, fileName: 'ScreenTime-Kid-0.1.1.apk', url: '/v1/downloads/kid/file' },
      parent: { versionName: '0.1.1', sizeBytes: 6, fileName: 'ScreenTime-Parent-0.1.1.apk', url: '/v1/downloads/parent/file' },
      windows: { versionName: '0.1.70', sizeBytes: 9, fileName: 'ScreenTime-0.1.70.msi', url: '/v1/downloads/windows/file' },
    });
  });

  it('serves the file as an attachment of the right type', async () => {
    publish('parent.json', 'parent-2.apk', 'parent');
    const apk = await get('/v1/downloads/parent/file');
    expect(apk.status).toBe(200);
    expect(apk.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(apk.headers.get('content-disposition')).toBe('attachment; filename="ScreenTime-Parent-0.1.1.apk"');
    expect(await apk.text()).toBe('parent');
    publish('windows.json', 'ScreenTime-0.1.70.msi', 'msi', { versionName: '0.1.70' });
    const msi = await get('/v1/downloads/windows/file');
    expect(msi.headers.get('content-type')).toBe('application/x-msi');
  });

  it('treats a bad description, a missing file or a path outside the folder as not published', async () => {
    writeFileSync(join(releases, 'parent.json'), '{ not json');
    writeFileSync(join(releases, 'windows.json'), JSON.stringify({ versionName: '1', sizeBytes: 1, file: 'gone.msi' }));
    writeFileSync(join(releases, 'kid.json'), JSON.stringify({ versionName: '1', sizeBytes: 1, file: '../secret.apk' }));
    expect(await (await get('/v1/downloads')).json()).toEqual({ kid: null, parent: null, windows: null });
    expect((await get('/v1/downloads/parent/file')).status).toBe(404);
    expect((await get('/v1/downloads/windows/file')).status).toBe(404);
    expect((await get('/v1/downloads/kid/file')).status).toBe(404);
  });

  it('knows only its three apps', async () => {
    expect((await get('/v1/downloads/other/file')).status).toBe(404);
  });
});
