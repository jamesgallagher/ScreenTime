import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifierFromEnv, type ClassifierConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { devices, families, kids, scheduleVersions, siteClasses, siteDaily } from '../src/db/schema.js';
import { hashDeviceToken, newDeviceToken } from '../src/devices/token.js';
import type { Mailer } from '../src/mailer.js';
import type { Pusher } from '../src/push.js';
import { CLASSIFIER_PROMPT, classifyPending, type ClassifierIo } from '../src/sites/classify.js';
import { client, resetDatabase, testConfig } from './helpers.js';

// Needs a throwaway PostgreSQL database: this test DELETES everything in it.
const url = process.env.TEST_DATABASE_URL;

const ANSWER_EMPTY = { sites: [] };

describe.skipIf(!url)('the website classifier', () => {
  const { db, pool } = createDb(url ?? '');
  const mailer: Mailer = { async sendSignInCode() {} };
  const pusher: Pusher = { async send() { return []; } };
  // The routes are only used for the fixture's uploads, so the classifier sees the same rows the report tests do.
  const api = client({ db, config: testConfig(url ?? ''), mailer, pusher });

  const FIXED_NOW = new Date('2026-11-12T00:00:00Z');
  let family = '';
  let otherFamily = '';
  let kid = '';
  const phone = { id: '', token: '' };
  const pc = { id: '', token: '' };
  const tablet = { id: '', token: '' };

  interface Recorded {
    url: string;
    body: {
      model: string;
      temperature: number;
      max_tokens: number;
      chat_template_kwargs: { enable_thinking: boolean };
      response_format: { type: string; json_schema: { name: string; strict: boolean; schema: unknown } };
      messages: { role: string; content: string }[];
    };
  }
  const calls: Recorded[] = [];
  const answers: (() => Response | Promise<Response>)[] = [];
  const resolved: string[] = [];
  let resolver: (name: string) => Promise<string[]>;

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Recorded['body'];
    calls.push({ url: String(input), body });
    const next = answers.shift();
    if (!next) throw new Error('no answer queued');
    return next();
  }) as unknown as typeof fetch;

  const fakeResolve = async (name: string) => {
    resolved.push(name);
    return resolver(name);
  };

  function jsonAnswer(answer: unknown): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  /** The config as the process makes it from CLASSIFIER_URL=http://llm.test/v1/. */
  function settings(over: Record<string, string> = {}): ClassifierConfig {
    const config = classifierFromEnv({ CLASSIFIER_URL: 'http://llm.test/v1/', CLASSIFIER_FAMILY_DNS: '1.1.1.3', ...over });
    if (!config) throw new Error('no classifier config');
    return config;
  }

  const run = (config: ClassifierConfig | null = settings()) => {
    const io: ClassifierIo = { fetch: fakeFetch, resolve4: fakeResolve };
    return classifyPending({ db, config: { classifier: config } }, io);
  };

  async function addDevice(familyId: string, kidId: string, name: string, platform: 'android' | 'windows', form: 'phone' | 'tablet' | 'pc', pool: 'phone' | 'screens', enrolledAt: string) {
    const token = newDeviceToken();
    const [device] = await db
      .insert(devices)
      .values({ familyId, kidId, platform, form, pool, name, tokenHash: hashDeviceToken(token), enrolledAt: new Date(enrolledAt) })
      .returning();
    if (!device) throw new Error('no device');
    return { id: device.id, token };
  }

  async function setup() {
    calls.length = 0;
    answers.length = 0;
    resolved.length = 0;
    resolver = async (name) => {
      if (name === 'abc.net.au') return ['203.2.218.214'];
      if (name === 'www.sportsbet.com.au') return ['0.0.0.0'];
      const err = new Error(`no data for ${name}`) as NodeJS.ErrnoException;
      err.code = 'ENODATA';
      throw err;
    };
    await resetDatabase(db, pool);
    const [a] = await db.insert(families).values({ name: 'A', timezone: 'Australia/Sydney', parentCodeSecret: 'A'.repeat(32) }).returning();
    const [b] = await db.insert(families).values({ name: 'B', timezone: 'Australia/Sydney', parentCodeSecret: 'B'.repeat(32) }).returning();
    if (!a || !b) throw new Error('no family');
    family = a.id;
    otherFamily = b.id;
    const [k] = await db.insert(kids).values({ familyId: family, name: 'Sam', avatarColor: '#0F766E' }).returning();
    if (!k) throw new Error('no kid');
    kid = k.id;
    const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 120, wake: '07:00', bedtime: '20:30' });
    await db.insert(scheduleVersions).values({ familyId: family, kidId: kid, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    Object.assign(phone, await addDevice(family, kid, 'Phone', 'android', 'phone', 'phone', '2026-11-01T00:00:00Z'));
    Object.assign(pc, await addDevice(family, kid, 'PC', 'windows', 'pc', 'screens', '2026-11-01T00:00:01Z'));
    Object.assign(tablet, await addDevice(family, kid, 'Tablet', 'android', 'tablet', 'screens', '2026-11-01T00:00:02Z'));

    const L = (at: string, host: string, packageName: string) => ({ at, host, package: packageName });
    await api.post('/v1/device/site-lookups', phone.token, {
      lookups: [
        L('2026-11-10T01:00:05Z', 'www.khanacademy.org', 'com.android.chrome'),
        L('2026-11-10T01:00:40Z', 'cdn.kastatic.org', 'com.android.chrome'),
        L('2026-11-10T01:01:10Z', 'www.khanacademy.org', 'com.android.chrome'),
        L('2026-11-10T12:59:30Z', 'www.youtube.com', 'com.google.android.youtube'),
        L('2026-11-10T13:00:30Z', 'www.youtube.com', 'com.google.android.youtube'),
        L('2026-11-10T13:00:45Z', 'rr3---sn-x.googlevideo.com', 'com.google.android.youtube'),
      ],
    });
    await api.post('/v1/device/site-lookups', phone.token, {
      lookups: [
        L('2026-11-10T01:00:30Z', 'khanacademy.org', 'com.android.chrome'),
        L('2026-11-10T01:00:50Z', 'www.khanacademy.org', 'com.pt.bark'),
        L('2026-11-10T01:02:00Z', 'api.bark.us', 'com.pt.bark'),
        L('2026-11-10T01:05:00Z', 'khanacademy.org', 'com.android.chrome'),
      ],
    });
    await api.post('/v1/device/site-lookups', pc.token, {
      lookups: [L('2026-11-11T02:00:00Z', 'www.khanacademy.org', 'msedge.exe'), L('2026-11-11T02:00:20Z', 'www.sportsbet.com.au', 'msedge.exe')],
    });
    await api.post('/v1/device/site-lookups', tablet.token, { lookups: [L('2026-11-10T03:00:00Z', 'www.roblox.com', 'com.roblox.client')] });

    // Family B: one device with one lookup.
    const [bk] = await db.insert(kids).values({ familyId: otherFamily, name: 'Ben', avatarColor: '#7C3AED' }).returning();
    if (!bk) throw new Error('no kid');
    await db.insert(scheduleVersions).values({ familyId: otherFamily, kidId: bk.id, version: 1, days: [1, 2, 3, 4, 5, 6, 7].map(day) });
    const benPhone = await addDevice(otherFamily, bk.id, 'Ben phone', 'android', 'phone', 'phone', '2026-11-02T00:00:00Z');
    await api.post('/v1/device/site-lookups', benPhone.token, { lookups: [L('2026-11-10T05:00:00Z', 'www.abc.net.au', 'com.android.chrome')] });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await pool.end();
  });

  const classes = () => db.select().from(siteClasses);
  const classOf = async (site: string) => (await db.select().from(siteClasses).where(eq(siteClasses.site, site)))[0];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
    await setup();
  });

  it('asks the seven sites in order, with their hosts and apps, in the fixed request', async () => {
    answers.push(() => jsonAnswer(ANSWER_EMPTY));
    await run();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://llm.test/v1/chat/completions');
    const items = [
      { site: 'khanacademy.org', hosts: ['www.khanacademy.org', 'khanacademy.org'], apps: ['com.android.chrome', 'msedge.exe'] },
      { site: 'youtube.com', hosts: ['www.youtube.com'], apps: ['com.google.android.youtube'] },
      { site: 'abc.net.au', hosts: ['www.abc.net.au'], apps: ['com.android.chrome'] },
      { site: 'googlevideo.com', hosts: ['rr3---sn-x.googlevideo.com'], apps: ['com.google.android.youtube'] },
      { site: 'kastatic.org', hosts: ['cdn.kastatic.org'], apps: ['com.android.chrome'] },
      { site: 'roblox.com', hosts: ['www.roblox.com'], apps: ['com.roblox.client'] },
      { site: 'sportsbet.com.au', hosts: ['www.sportsbet.com.au'], apps: ['msedge.exe'] },
    ];
    expect(calls[0]?.body).toEqual({
      model: 'Qwen3.8-27B',
      temperature: 0,
      max_tokens: 8192,
      chat_template_kwargs: { enable_thinking: false },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'site_classes',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['sites'],
            properties: {
              sites: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['site', 'kind', 'category', 'owner', 'label', 'confidence'],
                  properties: {
                    site: { type: 'string' },
                    kind: { enum: ['website', 'cdn', 'ads_tracking', 'app_service', 'unknown'] },
                    category: {
                      enum: [
                        'social',
                        'video',
                        'games',
                        'chat',
                        'search',
                        'education',
                        'shopping',
                        'news',
                        'adult',
                        'gambling',
                        'violence_weapons',
                        'drugs',
                        'self_harm',
                        'other',
                      ],
                    },
                    owner: { type: ['string', 'null'] },
                    label: { type: ['string', 'null'] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: JSON.stringify(items) },
      ],
    });
  });

  it('stores every asked result, ignores an unasked one and asks the resolver only about the unsure site', async () => {
    answers.push(() =>
      jsonAnswer({
        sites: [
          { site: 'khanacademy.org', kind: 'website', category: 'education', owner: null, label: 'Khan Academy', confidence: 0.99 },
          { site: 'youtube.com', kind: 'website', category: 'video', owner: 'google.com', label: 'YouTube', confidence: 0.99 },
          { site: 'abc.net.au', kind: 'website', category: 'news', owner: null, label: 'ABC', confidence: 0.5 },
          { site: 'googlevideo.com', kind: 'cdn', category: 'video', owner: 'youtube.com', label: null, confidence: 0.95 },
          { site: 'kastatic.org', kind: 'cdn', category: 'education', owner: 'khanacademy.org', label: null, confidence: 0.95 },
          { site: 'roblox.com', kind: 'website', category: 'games', owner: null, label: 'Roblox', confidence: 0.99 },
          { site: 'evil.example', kind: 'website', category: 'adult', owner: null, label: null, confidence: 0.99 },
        ],
      }),
    );
    const result = await run();
    expect(result).toMatchObject({ status: 'done', stored: 6, blocked: 0 });

    const rows = await classes();
    expect(rows.filter((r) => r.kind !== null).map((r) => r.site).sort()).toEqual([
      'abc.net.au',
      'googlevideo.com',
      'kastatic.org',
      'khanacademy.org',
      'roblox.com',
      'youtube.com',
    ]);
    for (const site of ['khanacademy.org', 'youtube.com', 'abc.net.au', 'googlevideo.com', 'kastatic.org', 'roblox.com']) {
      const row = await classOf(site);
      expect(row?.attempts, site).toBe(1);
      expect(row?.model, site).toBe('Qwen3.8-27B');
      expect(row?.classifiedAt?.toISOString(), site).toBe('2026-11-12T00:00:00.000Z');
    }
    expect((await classOf('youtube.com'))?.owner).toBeNull();
    expect((await classOf('abc.net.au'))?.category).toBe('news');
    expect((await classOf('abc.net.au'))?.familyDnsBlocked).toBe(false);
    expect((await classOf('sportsbet.com.au'))?.kind).toBeNull();
    expect((await classOf('sportsbet.com.au'))?.attempts).toBe(1);
    expect(await classOf('evil.example')).toBeUndefined();
    expect(resolved).toEqual(['abc.net.au']);
  });

  it('gives a site missing twice one more attempt, then unknown, and the family filter blocks it', async () => {
    answers.push(() =>
      jsonAnswer({
        sites: [
          { site: 'khanacademy.org', kind: 'website', category: 'education', owner: null, label: 'Khan Academy', confidence: 0.99 },
          { site: 'youtube.com', kind: 'website', category: 'video', owner: null, label: 'YouTube', confidence: 0.99 },
          { site: 'abc.net.au', kind: 'website', category: 'news', owner: null, label: 'ABC', confidence: 0.5 },
          { site: 'googlevideo.com', kind: 'cdn', category: 'video', owner: 'youtube.com', label: null, confidence: 0.95 },
          { site: 'kastatic.org', kind: 'cdn', category: 'education', owner: 'khanacademy.org', label: null, confidence: 0.95 },
          { site: 'roblox.com', kind: 'website', category: 'games', owner: null, label: 'Roblox', confidence: 0.99 },
        ],
      }),
    );
    await run();

    answers.push(() => jsonAnswer(ANSWER_EMPTY));
    const second = await run();
    expect(second.status).toBe('done');
    expect(calls).toHaveLength(2);
    const only = JSON.parse(calls[1]?.body.messages[1]?.content ?? '[]') as { site: string }[];
    expect(only.map((i) => i.site)).toEqual(['sportsbet.com.au']);
    expect((await classOf('sportsbet.com.au'))?.attempts).toBe(2);
    expect((await classOf('sportsbet.com.au'))?.kind).toBeNull();

    answers.push(() => jsonAnswer(ANSWER_EMPTY));
    const third = await run();
    expect(third).toMatchObject({ status: 'done', stored: 1, blocked: 1 });
    const sportsbet = await classOf('sportsbet.com.au');
    expect(sportsbet?.attempts).toBe(3);
    expect(sportsbet?.kind).toBe('website');
    expect(sportsbet?.category).toBe('adult');
    expect(sportsbet?.confidence).toBe(0);
    expect(sportsbet?.familyDnsBlocked).toBe(true);
    expect(resolved).toEqual(['abc.net.au', 'sportsbet.com.au', 'www.sportsbet.com.au']);

    const count = calls.length;
    const fourth = await run();
    expect(fourth.status).toBe('nothing');
    expect(calls).toHaveLength(count);
  });

  it('stops on a failed connection or an HTTP error, storing nothing', async () => {
    answers.push(() => Promise.reject(new TypeError('fetch failed')));
    const rejected = await run();
    expect(rejected.status).toBe('unavailable');
    expect(await classes()).toEqual([]);

    await setup();
    answers.push(() => new Response('down', { status: 503 }));
    const down = await run();
    expect(down.status).toBe('unavailable');
    expect(await classes()).toEqual([]);
  });

  it('stops on an answer that is not JSON or breaks the schema, counting one attempt for each asked site', async () => {
    answers.push(() => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 }));
    const bad = await run();
    expect(bad.status).toBe('bad_answer');
    let rows = await classes();
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.kind === null && r.attempts === 1)).toBe(true);

    await setup();
    answers.push(() =>
      jsonAnswer({ sites: [{ site: 'youtube.com', kind: 'porn', category: 'video', owner: null, label: null, confidence: 0.5 }] }),
    );
    const wrong = await run();
    expect(wrong.status).toBe('bad_answer');
    rows = await classes();
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.kind === null && r.attempts === 1)).toBe(true);
  });

  // Added by Claude in review: a later request failing must not skip the family filter for what is already stored.
  it('still runs the family filter on the sites of the first request when a later request fails', async () => {
    await addExtraSites(120);
    resolver = async (name) => (name === 'abc.net.au' ? ['0.0.0.0'] : ['203.0.113.9']);
    answers.push(() =>
      jsonAnswer({ sites: [{ site: 'abc.net.au', kind: 'unknown', category: 'other', owner: null, label: null, confidence: 0.1 }] }),
    );
    answers.push(() => new Response('down', { status: 503 }));
    const result = await run();
    expect(result).toMatchObject({ status: 'unavailable', stored: 1, blocked: 1 });
    expect(calls).toHaveLength(2);
    expect(resolved).toEqual(['abc.net.au']);
    const abc = await classOf('abc.net.au');
    expect(abc?.familyDnsBlocked).toBe(true);
    expect(abc?.kind).toBe('website');
    expect(abc?.category).toBe('adult');
  });

  // Added by Claude in review: an answer that cannot be read three times ends as unknown, never stuck unsorted.
  it('stores a site whose answer could not be read three times as unknown, and stops asking', async () => {
    for (let i = 0; i < 3; i++) {
      answers.push(() => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 }));
      // The family filter off, so this checks only the attempt rule (it is checked on its own above).
      expect((await run(settings({ CLASSIFIER_FAMILY_DNS: '' }))).status).toBe('bad_answer');
    }
    const rows = await classes();
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.attempts === 3 && r.kind === 'unknown' && r.category === 'other' && r.confidence === 0)).toBe(true);
    expect(rows.every((r) => r.model === 'Qwen3.8-27B')).toBe(true);
    const count = calls.length;
    expect((await run(settings({ CLASSIFIER_FAMILY_DNS: '' }))).status).toBe('nothing');
    expect(calls).toHaveLength(count);
  });

  it('sends 127 sites in three requests of 50, 50 and 27', async () => {
    await addExtraSites(120);
    for (const _ of [0, 1, 2]) answers.push(() => jsonAnswer(ANSWER_EMPTY));
    const result = await run();
    expect(result.status).toBe('done');
    expect(calls).toHaveLength(3);
    expect(
      calls.map((c) => (JSON.parse(c.body.messages[1]?.content ?? '[]') as unknown[]).length),
    ).toEqual([50, 50, 27]);
  });

  it('asks at most 200 sites: the busiest first, then by name', async () => {
    await addExtraSites(250);
    for (const _ of [0, 1, 2, 3]) answers.push(() => jsonAnswer(ANSWER_EMPTY));
    const result = await run();
    expect(result.status).toBe('done');
    expect(calls).toHaveLength(4);
    const asked = calls.flatMap(
      (c) => (JSON.parse(c.body.messages[1]?.content ?? '[]') as { site: string }[]).map((i) => i.site),
    );
    const expected = [
      'khanacademy.org',
      'youtube.com',
      'abc.net.au',
      'googlevideo.com',
      'kastatic.org',
      'roblox.com',
      ...Array.from({ length: 194 }, (_, i) => `s${String(i + 1).padStart(3, '0')}.example`),
    ];
    expect(asked).toEqual(expected);
    expect(asked).not.toContain('sportsbet.com.au');
    expect(asked).not.toContain('s195.example');
  });

  it('is off with no config, and never asks the resolver when the family check is off', async () => {
    const off = await run(null);
    expect(off.status).toBe('off');
    expect(calls).toEqual([]);

    answers.push(() =>
      jsonAnswer({ sites: [{ site: 'khanacademy.org', kind: 'website', category: 'education', owner: null, label: null, confidence: 0.1 }] }),
    );
    const noFamily = await run(settings({ CLASSIFIER_FAMILY_DNS: '' }));
    expect(noFamily.status).toBe('done');
    expect((await classOf('khanacademy.org'))?.confidence).toBeCloseTo(0.1);
    expect(resolved).toEqual([]);
  });

  /** Adds `n` sites (s001.example …), one site_daily row each on the phone. */
  async function addExtraSites(n: number) {
    await db.insert(siteDaily).values(
      Array.from({ length: n }, (_, i) => ({
        familyId: family,
        kidId: kid,
        deviceId: phone.id,
        day: '2026-11-10',
        site: `s${String(i + 1).padStart(3, '0')}.example`,
        package: 'com.android.chrome',
        lookups: 1,
        minutes: 1,
        firstAt: new Date('2026-11-10T02:00:00Z'),
        lastAt: new Date('2026-11-10T02:00:00Z'),
      })),
    );
  }
});
