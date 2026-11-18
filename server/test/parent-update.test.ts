import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { families, parentSessions, parents } from '../src/db/schema.js';
import type { Mailer } from '../src/mailer.js';
import type { Pusher, PushMessage } from '../src/push.js';
import { TEST_SECRET, client, resetDatabase, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('parent app updates', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pusher: Pusher = { async send() { return []; } };
  const releases = mkdtempSync(join(tmpdir(), 'screentime-parent-releases-'));
  const deps = { db, config: { ...testConfig(url ?? ''), releasesDir: releases }, mailer, pusher };
  const api = client(deps);
  const app = createApp(deps);

  let family = '';
  const mum = { id: '', token: '', session: '' };
  const dad = { id: '', token: '', session: '' };
  const sent: PushMessage[] = [];
  pusher.send = async (messages) => { sent.push(...messages); return []; };

  /** A parent session of [client], with a token that says who it is. */
  async function addParent(email: string, name: string, client: string) {
    const [p] = await db.insert(parents).values({ familyId: family, email, displayName: name }).returning();
    if (!p) throw new Error('no parent');
    const [s] = await db.insert(parentSessions).values({ familyId: family, parentId: p.id, refreshTokenHash: randomUUID(), client, clientLabel: client }).returning();
    if (!s) throw new Error('no session');
    const token = await signAccessToken(TEST_SECRET, { sessionId: s.id, parentId: p.id, familyId: family, roles: ['parent'] });
    return { id: p.id, token, session: s.id };
  }

  const offer = { versionCode: 5, versionName: '1.4.0', sha256: 'a'.repeat(64), sizeBytes: 5 };
  const publish = (over: Record<string, unknown> = {}) => {
    writeFileSync(join(releases, 'parent-5.apk'), 'hello');
    writeFileSync(join(releases, 'parent.json'), JSON.stringify({ ...offer, file: 'parent-5.apk', ...over }));
  };
  const check = (versionCode: number, token: string) =>
    api.post('/v1/me/app-update/check', token, { versionCode, versionName: `v${versionCode}` });
  const apk = (token: string) => app.request('/v1/me/app-update/apk', { headers: { authorization: `Bearer ${token}` } });

  afterAll(async () => {
    rmSync(releases, { recursive: true, force: true });
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(db, pool);
    sent.length = 0;
    rmSync(join(releases, 'parent.json'), { force: true });
    rmSync(join(releases, 'parent-5.apk'), { force: true });
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    if (!a) throw new Error('no family');
    family = a.id;
    Object.assign(mum, await addParent('mum@example.com', 'Mum', 'android'));
    Object.assign(dad, await addParent('dad@example.com', 'Dad', 'android'));
  });

  it('stores the version on the caller session only, and nothing newer is offered', async () => {
    const res = await check(1, mum.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ offer: null });
    const [m] = await db.select().from(parentSessions).where(eq(parentSessions.id, mum.session));
    const [d] = await db.select().from(parentSessions).where(eq(parentSessions.id, dad.session));
    expect(m?.appVersion).toBe('v1');
    expect(d?.appVersion).toBeNull();
  });

  it('offers a newer version, without the file name or the parent list', async () => {
    publish();
    const res = await check(4, mum.token);
    expect(res.body).toEqual({ offer });
  });

  it('offers nothing for the same or an older version', async () => {
    publish();
    expect((await check(5, mum.token)).body).toEqual({ offer: null });
    expect((await check(6, mum.token)).body).toEqual({ offer: null });
  });

  it('offers nothing when parent.json is missing or not valid', async () => {
    expect((await check(1, mum.token)).body).toEqual({ offer: null });
    writeFileSync(join(releases, 'parent.json'), '{ not json');
    expect((await check(1, mum.token)).body).toEqual({ offer: null });
  });

  it('offers a version for chosen parents only to them', async () => {
    publish({ parentIds: [mum.id] });
    expect((await check(1, mum.token)).body).toEqual({ offer });
    expect((await check(1, dad.token)).body).toEqual({ offer: null });
  });

  it('offers nothing to a web session even when a newer version is published', async () => {
    const w = await addParent('web@example.com', 'Web', 'web');
    publish();
    expect((await check(1, w.token)).body).toEqual({ offer: null });
  });

  it('needs a parent token, and a kid device token is refused', async () => {
    expect((await api.post('/v1/me/app-update/check', null, { versionCode: 1, versionName: 'x' })).status).toBe(401);
    expect((await app.request('/v1/me/app-update/apk')).status).toBe(401);
    // A kid device token is not a parent access token.
    const kidToken = 'device-token';
    expect((await api.post('/v1/me/app-update/check', kidToken, { versionCode: 1, versionName: 'x' })).status).toBe(401);
  });

  it('serves the file to a parent it is for, and to no other', async () => {
    publish({ parentIds: [mum.id] });
    const res = await apk(mum.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(res.headers.get('content-length')).toBe('5');
    expect(await res.text()).toBe('hello');
    expect((await apk(dad.token)).status).toBe(404);
  });

  it('says 404 when parent.json names a file that is not there', async () => {
    publish();
    rmSync(join(releases, 'parent-5.apk'));
    expect((await apk(mum.token)).status).toBe(404);
  });

  it('the download page still lists the parent app when parent.json names parents', async () => {
    publish({ parentIds: [mum.id] });
    const res = await app.request('/v1/downloads');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parent: { versionName: string; sizeBytes: number; fileName: string } | null };
    expect(body.parent).toMatchObject({ versionName: '1.4.0', sizeBytes: 5, fileName: 'ScreenTime-Parent-1.4.0.apk' });
  });
});
