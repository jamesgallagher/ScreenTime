import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Envelope } from '@screentime/schemas';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, parents, scheduleVersions } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import { CLOSE_IDLE, CLOSE_REVOKED, LiveHub, type LiveSocket } from '../src/live/hub.js';
import type { Mailer } from '../src/mailer.js';
import type { PushMessage, Pusher } from '../src/push.js';
import { resetDatabase, testConfig, tokenFor } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const msg = (type: string): Envelope => ({ v: 1, type, at: new Date().toISOString(), data: {} });

/** A socket that records what it was sent. */
function fakeSocket() {
  const sent: string[] = [];
  const closed: number[] = [];
  const socket: LiveSocket = {
    send: (data) => sent.push(data),
    close: (code) => closed.push(code ?? 0),
  };
  return { socket, sent, closed };
}

describe('LiveHub', () => {
  it('sends to every socket of the named devices only', () => {
    const hub = new LiveHub();
    const a1 = fakeSocket();
    const a2 = fakeSocket();
    const b = fakeSocket();
    hub.add('a', a1.socket);
    hub.add('a', a2.socket);
    hub.add('b', b.socket);
    expect(hub.send(['a'], msg('state_changed'))).toBe(2);
    expect(JSON.parse(a1.sent[0] ?? '')).toMatchObject({ v: 1, type: 'state_changed' });
    expect(a2.sent).toHaveLength(1);
    expect(b.sent).toEqual([]);
    expect(hub.send(['nobody'], msg('state_changed'))).toBe(0);
  });

  it('forgets removed sockets and closes revoked devices', () => {
    const hub = new LiveHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add('a', a.socket);
    hub.add('b', b.socket);
    hub.remove('a', a.socket);
    expect(hub.count('a')).toBe(0);
    expect(hub.send(['a'], msg('x'))).toBe(0);
    hub.close(['b'], CLOSE_REVOKED, 'gone');
    expect(b.closed).toEqual([CLOSE_REVOKED]);
    expect(hub.count('b')).toBe(0);
  });

  it('keeps sending to the others when one socket throws', () => {
    const hub = new LiveHub();
    const good = fakeSocket();
    hub.add('a', {
      send: () => {
        throw new Error('broken pipe');
      },
      close: () => {},
    });
    hub.add('a', good.socket);
    const error = console.error;
    console.error = () => {};
    try {
      expect(hub.send(['a'], msg('x'))).toBe(1);
    } finally {
      console.error = error;
    }
    expect(good.sent).toHaveLength(1);
  });
});

/** Every day the same, with no curfew, so the result does not depend on the weekday or the hour. */
const flatWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  screensMin: 120,
  phoneMin: 60,
  wake: '00:00',
  bedtime: '24:00',
}));

/** A connected test client that keeps every envelope it receives. */
interface Client {
  ws: WebSocket;
  received: Envelope[];
  /** Resolves with the next envelope of this type (or one already received). */
  next(type: string): Promise<Envelope>;
  closed: Promise<number>;
}

describe.skipIf(!url)('device WebSocket', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pushed: PushMessage[] = [];
  const pusher: Pusher = {
    async send(messages) {
      pushed.push(...messages);
      return [];
    },
  };
  const hub = new LiveHub({ idleMs: 400 });
  const app = createApp({ db, config: testConfig(url ?? ''), mailer, pusher, hub });
  let server: ServerType;
  let base = '';

  let familyA = '';
  let familyB = '';
  let mum = '';

  /** Waits until `check` is true, for at most 2 seconds. */
  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(check()).toBe(true);
  }

  /** Sleeps a little so a message that should not come would have arrived. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  async function call(method: string, path: string, token: string, body?: unknown) {
    const res = await fetch(`http://${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.status;
  }

  async function addKid(familyId: string, name: string) {
    const [kid] = await db.insert(kids).values({ familyId, name, avatarColor: '#0F766E' }).returning();
    if (!kid) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId, kidId: kid.id, version: 1, days: flatWeek });
    return kid.id;
  }

  async function addDevice(familyId: string, kidId: string, form: 'phone' | 'tablet' | 'pc', fcmToken: string | null = null) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({
        familyId,
        kidId,
        platform: form === 'pc' ? 'windows' : 'android',
        form,
        pool: form === 'phone' ? 'phone' : 'screens',
        name: form,
        tokenHash: hashDeviceToken(token),
        fcmToken,
      })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  /**
   * Opens a socket with the device token and waits until the server has it. It pings every 100 ms, as a
   * real device does every 30 s, unless `ping` is false.
   */
  function connect(deviceId: string, token: string, ping = true): Promise<Client> {
    const ws = new WebSocket(`ws://${base}/v1/device/ws`, { headers: { authorization: `Bearer ${token}` } });
    const received: Envelope[] = [];
    const waiters: Array<{ type: string; resolve: (m: Envelope) => void }> = [];
    ws.on('message', (data) => {
      const envelope = JSON.parse(String(data)) as Envelope;
      // Answers to the automatic pings are not kept.
      if (ping && envelope.type === 'pong') return;
      received.push(envelope);
      for (const w of waiters.filter((x) => x.type === envelope.type)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(envelope);
      }
    });
    const pinger = ping ? setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 100) : undefined;
    const closed = new Promise<number>((resolve) =>
      ws.on('close', (code) => {
        clearInterval(pinger);
        resolve(code);
      }),
    );
    const next = (type: string) =>
      new Promise<Envelope>((resolve) => {
        const already = received.find((m) => m.type === type);
        if (already) resolve(already);
        else waiters.push({ type, resolve });
      });
    return new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('open', async () => {
        // The server registers the socket just after the upgrade.
        await waitFor(() => hub.count(deviceId) > 0);
        resolve({ ws, received, next, closed });
      });
    });
  }

  /** The HTTP status of a refused upgrade. */
  function refusedStatus(token: string | null): Promise<number> {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    const ws = new WebSocket(`ws://${base}/v1/device/ws`, { headers });
    return new Promise((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('the upgrade was accepted')));
      ws.on('error', () => {});
    });
  }

  beforeAll(async () => {
    await resetDatabase(db, pool);
    const [a, b] = await db
      .insert(families)
      .values([
        { name: 'Family A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) },
        { name: 'Family B', timezone: 'Australia/Perth', parentCodeSecret: 'B'.repeat(32) },
      ])
      .returning();
    familyA = a?.id ?? '';
    familyB = b?.id ?? '';
    const [p1] = await db
      .insert(parents)
      .values([{ familyId: familyA, email: 'mum@example.com', displayName: 'Mum' }])
      .returning();
    mum = await tokenFor({ parentId: p1?.id ?? '', familyId: familyA });
    server = serve({ fetch: app.fetch, port: 0 });
    app.injectWebSocket(server);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  it('refuses an upgrade without a valid device token, and plain requests', async () => {
    expect(await refusedStatus(null)).toBe(401);
    expect(await refusedStatus('not-a-token')).toBe(401);
    const kidId = await addKid(familyA, 'Gone kid');
    const gone = await addDevice(familyA, kidId, 'pc');
    await call('DELETE', `/v1/devices/${gone.id}`, mum);
    expect(await refusedStatus(gone.token)).toBe(401);
    const plain = await fetch(`http://${base}/v1/device/ws`, { headers: { authorization: `Bearer ${gone.token}` } });
    expect(plain.status).toBe(401);
    const kid2 = await addKid(familyA, 'Plain kid');
    const live = await addDevice(familyA, kid2, 'pc');
    const notUpgrade = await fetch(`http://${base}/v1/device/ws`, { headers: { authorization: `Bearer ${live.token}` } });
    expect(notUpgrade.status).toBe(422);
  });

  it('answers ping with pong and closes a socket that goes quiet', async () => {
    const kidId = await addKid(familyA, 'Ping kid');
    const pc = await addDevice(familyA, kidId, 'pc');
    const client = await connect(pc.id, pc.token, false);
    client.ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await client.next('pong');
    expect(pong).toMatchObject({ v: 1, type: 'pong', data: {} });
    expect(Math.abs(Date.parse(pong.at) - Date.now())).toBeLessThan(5000);
    // Not JSON, and unknown types: ignored, but they still count as signs of life.
    client.ws.send('hello');
    client.ws.send(JSON.stringify({ type: 'something' }));
    // The test hub closes after 400 ms of silence (the real one after 75 s).
    expect(await client.closed).toBe(CLOSE_IDLE);
    await waitFor(() => hub.count(pc.id) === 0);
  });

  it('sends a grant to the devices in its pool, and by FCM only to Android', async () => {
    const kidId = await addKid(familyA, 'Grant kid');
    const otherKid = await addKid(familyA, 'Other kid');
    const pc = await addDevice(familyA, kidId, 'pc');
    const tablet = await addDevice(familyA, kidId, 'tablet', 'fcm-tablet');
    const phone = await addDevice(familyA, kidId, 'phone', 'fcm-phone');
    const other = await addDevice(familyA, otherKid, 'pc');
    const clients = await Promise.all([pc, tablet, phone, other].map((d) => connect(d.id, d.token)));
    const [pcClient, tabletClient, phoneClient, otherClient] = clients;
    pushed.length = 0;

    const id = randomUUID();
    expect(await call('POST', `/v1/kids/${kidId}/grants`, mum, { id, pool: 'screens', minutes: 15 })).toBe(201);
    for (const client of [pcClient, tabletClient]) {
      expect(await client?.next('grant_added')).toMatchObject({
        type: 'grant_added',
        data: { grant: { id, minutes: 15, byName: 'Mum' }, byName: 'Mum' },
      });
    }
    await settle();
    expect(phoneClient?.received).toEqual([]);
    expect(otherClient?.received).toEqual([]);
    expect(pushed.map((p) => p.token)).toEqual(['fcm-tablet']);
    for (const client of clients) client?.ws.close();
  });

  it('tells devices to sync when their state changes', async () => {
    const kidId = await addKid(familyA, 'State kid');
    const otherKid = await addKid(familyA, 'Sibling');
    const pc = await addDevice(familyA, kidId, 'pc');
    const tablet = await addDevice(familyA, kidId, 'tablet', 'fcm-state-tablet');
    const sibling = await addDevice(familyA, otherKid, 'pc');
    const elsewhere = await addDevice(familyB, await addKid(familyB, 'Far kid'), 'pc');
    const [pcClient, tabletClient, siblingClient, elsewhereClient] = await Promise.all(
      [pc, tablet, sibling, elsewhere].map((d) => connect(d.id, d.token)),
    );
    const clear = () => {
      for (const c of [pcClient, tabletClient, siblingClient, elsewhereClient]) c?.received.splice(0);
      pushed.length = 0;
    };

    // A kid's schedule: only that kid's devices, by WebSocket and by FCM at normal priority.
    const week = flatWeek.map((d) => ({ ...d, screensMin: 90 }));
    clear();
    expect(await call('PUT', `/v1/kids/${kidId}/schedule`, mum, { warn1Min: 15, warn2Min: 5, days: week })).toBe(200);
    expect(await pcClient?.next('state_changed')).toMatchObject({ v: 1, type: 'state_changed', data: {} });
    await tabletClient?.next('state_changed');
    await settle();
    expect(siblingClient?.received).toEqual([]);
    expect(pushed).toMatchObject([{ token: 'fcm-state-tablet', high: false, ttlSec: 86400, msg: { type: 'state_changed' } }]);

    // Contacts and the kid's name: the same.
    clear();
    await call('PUT', `/v1/kids/${kidId}/contacts`, mum, { contacts: [{ label: 'Grandma', phoneE164: '+61400000001' }] });
    await pcClient?.next('state_changed');
    clear();
    await call('PATCH', `/v1/kids/${kidId}`, mum, { name: 'State kid 2' });
    await pcClient?.next('state_changed');

    // Family-wide settings: every device of the family, none of another family.
    for (const [method, path, body] of [
      ['PATCH', '/v1/family', { emergencyNumber: '112' }],
      ['PUT', '/v1/family/message-presets', { presets: [{ text: 'Hi' }] }],
      ['POST', '/v1/family/parent-code/rotate', undefined],
      ['POST', '/v1/family/parents', { email: 'dad@example.com', displayName: 'Dad' }],
    ] as const) {
      clear();
      expect(await call(method, path, mum, body)).toBeLessThan(300);
      await Promise.all([pcClient, tabletClient, siblingClient].map((c) => c?.next('state_changed')));
      await settle();
      expect(elsewhereClient?.received, `${method} ${path}`).toEqual([]);
    }

    // A device rename: only that device.
    clear();
    await call('PATCH', `/v1/devices/${tablet.id}`, mum, { name: 'XPPen' });
    await tabletClient?.next('state_changed');
    await settle();
    expect(pcClient?.received).toEqual([]);

    // A usage upload: the kid's other devices in the pool, by WebSocket only.
    clear();
    const segment = { id: randomUUID(), startedAt: new Date(Date.now() - 60_000).toISOString(), endedAt: null, recordedOffline: false };
    expect(await call('POST', '/v1/device/usage', tablet.token, { segments: [segment] })).toBe(200);
    await pcClient?.next('state_changed');
    await settle();
    expect(tabletClient?.received).toEqual([]);
    expect(siblingClient?.received).toEqual([]);
    expect(pushed).toEqual([]);

    for (const c of [pcClient, tabletClient, siblingClient, elsewhereClient]) c?.ws.close();
  });

  it('disconnects a device when it is revoked or its kid is archived', async () => {
    const kidId = await addKid(familyA, 'Revoked kid');
    const pc = await addDevice(familyA, kidId, 'pc');
    const tablet = await addDevice(familyA, kidId, 'tablet');
    const pcClient = await connect(pc.id, pc.token);
    const tabletClient = await connect(tablet.id, tablet.token);
    expect(await call('DELETE', `/v1/devices/${pc.id}`, mum)).toBe(204);
    expect(await pcClient.closed).toBe(CLOSE_REVOKED);
    expect(hub.count(pc.id)).toBe(0);
    expect(hub.count(tablet.id)).toBe(1);
    expect(await call('DELETE', `/v1/kids/${kidId}`, mum)).toBe(204);
    expect(await tabletClient.closed).toBe(CLOSE_REVOKED);
  });
});
