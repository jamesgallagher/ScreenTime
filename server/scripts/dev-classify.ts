// Runs the website classifier against the development database and settings (docs/SPEC.md §12.10, CARD-070).
// Usage (from the repo root):
//   pnpm --filter @screentime/server exec tsx scripts/dev-classify.ts                    one run; prints what changed
//   pnpm --filter @screentime/server exec tsx scripts/dev-classify.ts --sample           the 27 fixture V sites, scored
//   pnpm --filter @screentime/server exec tsx scripts/dev-classify.ts --dns <name>...    the family resolver, per name
// It needs DATABASE_URL (and the CLASSIFIER_* settings) for a run, CLASSIFIER_URL for --sample and
// CLASSIFIER_FAMILY_DNS for --dns. Never run this against the production database.
import dns from 'node:dns';
import { classifierFromEnv } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { siteClasses } from '../src/db/schema.js';
import { ANSWER_SCHEMA, CLASSIFIER_PROMPT, classifyPending, realClassifierIo } from '../src/sites/classify.js';

interface SampleSite {
  site: string;
  hosts: string[];
  apps: string[];
  kinds: string[];
  categories: string[];
}

/** Fixture V of CARD-070: the 27 sites and what the model may answer (a kind or category may have alternatives). */
const SAMPLE: SampleSite[] = [
  { site: 'khanacademy.org', hosts: ['www.khanacademy.org', 'cdn.kastatic.org'], apps: ['com.android.chrome'], kinds: ['website'], categories: ['education'] },
  { site: 'kastatic.org', hosts: ['cdn.kastatic.org'], apps: ['com.android.chrome'], kinds: ['cdn'], categories: ['education'] },
  { site: 'roblox.com', hosts: ['www.roblox.com', 'apis.roblox.com'], apps: ['com.roblox.client'], kinds: ['website', 'app_service'], categories: ['games'] },
  { site: 'rbxcdn.com', hosts: ['tr.rbxcdn.com'], apps: ['com.roblox.client'], kinds: ['cdn'], categories: ['games'] },
  { site: 'youtube.com', hosts: ['www.youtube.com', 'm.youtube.com'], apps: ['com.google.android.youtube', 'com.android.chrome'], kinds: ['website'], categories: ['video'] },
  { site: 'googlevideo.com', hosts: ['rr3---sn-ntqe6n76.googlevideo.com'], apps: ['com.google.android.youtube'], kinds: ['cdn'], categories: ['video'] },
  { site: 'ytimg.com', hosts: ['i.ytimg.com'], apps: ['com.android.chrome'], kinds: ['cdn'], categories: ['video'] },
  { site: 'doubleclick.net', hosts: ['googleads.g.doubleclick.net'], apps: ['com.android.chrome'], kinds: ['ads_tracking'], categories: ['other'] },
  { site: 'facebook.net', hosts: ['connect.facebook.net'], apps: ['com.android.chrome'], kinds: ['ads_tracking', 'app_service'], categories: ['social', 'other'] },
  { site: 'fbcdn.net', hosts: ['scontent.xx.fbcdn.net'], apps: ['com.android.chrome'], kinds: ['cdn'], categories: ['social'] },
  { site: 'tiktok.com', hosts: ['www.tiktok.com'], apps: ['com.android.chrome'], kinds: ['website'], categories: ['video', 'social'] },
  { site: 'discord.com', hosts: ['discord.com', 'gateway.discord.gg'], apps: ['msedge.exe'], kinds: ['website'], categories: ['chat'] },
  { site: 'coolmathgames.com', hosts: ['www.coolmathgames.com'], apps: ['msedge.exe'], kinds: ['website'], categories: ['games'] },
  { site: 'crazygames.com', hosts: ['www.crazygames.com'], apps: ['com.android.chrome'], kinds: ['website'], categories: ['games'] },
  { site: 'abc.net.au', hosts: ['www.abc.net.au'], apps: ['com.android.chrome'], kinds: ['website'], categories: ['news'] },
  { site: 'wikipedia.org', hosts: ['en.wikipedia.org'], apps: ['msedge.exe'], kinds: ['website'], categories: ['education'] },
  { site: 'bing.com', hosts: ['www.bing.com'], apps: ['msedge.exe'], kinds: ['website'], categories: ['search'] },
  { site: 'amazon.com.au', hosts: ['www.amazon.com.au'], apps: ['com.android.chrome'], kinds: ['website'], categories: ['shopping'] },
  { site: 'sportsbet.com.au', hosts: ['www.sportsbet.com.au'], apps: ['com.android.chrome'], kinds: ['website'], categories: ['gambling'] },
  { site: 'xiaomi.net', hosts: ['api.sec.miui.com', 'data.mistat.xiaomi.net'], apps: ['com.miui.securitycenter'], kinds: ['app_service', 'ads_tracking'], categories: ['other'] },
  { site: 'googleapis.com', hosts: ['play.googleapis.com', 'fonts.googleapis.com'], apps: ['com.android.vending', 'com.android.chrome'], kinds: ['app_service', 'cdn'], categories: ['other'] },
  { site: 'zlkj7q.xyz', hosts: ['zlkj7q.xyz'], apps: ['com.android.chrome'], kinds: ['unknown'], categories: ['other'] },
  { site: 'omegle.com', hosts: ['www.omegle.com'], apps: ['com.android.chrome'], kinds: ['website'], categories: ['chat'] },
  { site: 'reddit.com', hosts: ['www.reddit.com'], apps: ['com.android.chrome'], kinds: ['website'], categories: ['social'] },
  { site: 'redd.it', hosts: ['i.redd.it'], apps: ['com.android.chrome'], kinds: ['cdn'], categories: ['social'] },
  { site: 'scorecardresearch.com', hosts: ['sb.scorecardresearch.com'], apps: ['com.android.chrome'], kinds: ['ads_tracking'], categories: ['other'] },
  { site: 'bark.us', hosts: ['api.bark.us'], apps: ['com.pt.bark'], kinds: ['app_service'], categories: ['other'] },
];

const args = process.argv.slice(2);

/** CLASSIFIER_FAMILY_DNS, as the server reads it: unset means 1.1.1.3, set but empty means no check. */
function familyServer(): string | null {
  return process.env.CLASSIFIER_FAMILY_DNS === undefined ? '1.1.1.3' : process.env.CLASSIFIER_FAMILY_DNS.trim() || null;
}

async function resolveAt(server: string, name: string): Promise<string[]> {
  const resolver = new dns.promises.Resolver({ timeout: 5000, tries: 1 });
  resolver.setServers([server]);
  return resolver.resolve4(name);
}

if (args[0] === '--dns') {
  const server = familyServer();
  if (!server) {
    console.error('CLASSIFIER_FAMILY_DNS is empty: there is no resolver to ask.');
    process.exit(1);
  }
  for (const name of args.slice(1)) {
    let blocked = false;
    try {
      blocked = (await resolveAt(server, name)).includes('0.0.0.0');
    } catch {
      blocked = false;
    }
    console.log(`${name} ${blocked ? 'blocked' : 'not blocked'}`);
  }
  process.exit(0);
}

if (args[0] === '--sample') {
  const settings = classifierFromEnv();
  if (!settings) {
    console.error('CLASSIFIER_URL is not set: there is no model to ask.');
    process.exit(1);
  }
  const response = await fetch(`${settings.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      max_tokens: 8192,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: 'json_schema', json_schema: { name: 'site_classes', strict: true, schema: ANSWER_SCHEMA } },
      messages: [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: JSON.stringify(SAMPLE.map(({ site, hosts, apps }) => ({ site, hosts, apps }))) },
      ],
    }),
  });
  const text = await response.text();
  if (response.status !== 200) {
    console.error(`classifier: unavailable (HTTP ${response.status}): ${text.slice(0, 500)}`);
    process.exit(1);
  }
  let answer: { sites?: { site: string; kind: string; category: string; owner: string | null }[] };
  try {
    const envelope = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    const content = envelope.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('no choices[0].message.content');
    answer = JSON.parse(content) as typeof answer;
  } catch (err) {
    console.error(`classifier: bad answer (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  }
  const bySite = new Map((answer.sites ?? []).map((s) => [s.site, s]));
  let kinds = 0;
  let categories = 0;
  for (const item of SAMPLE) {
    const got = bySite.get(item.site);
    if (!got) {
      console.log(`${item.site} | MISS`);
      continue;
    }
    const kindOk = item.kinds.includes(got.kind);
    const categoryOk = item.categories.includes(got.category);
    if (kindOk) kinds += 1;
    if (categoryOk) categories += 1;
    console.log(`${item.site} | ${got.kind} | ${got.category} | ${got.owner ?? ''} | ${kindOk && categoryOk ? 'ok' : 'MISS'}`);
  }
  console.log(`score: ${kinds}/${SAMPLE.length} kinds, ${categories}/${SAMPLE.length} categories`);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Usage: DATABASE_URL=postgres://... tsx scripts/dev-classify.ts [--sample | --dns <name>...]');
  process.exit(1);
}
const settings = classifierFromEnv();
const { db, pool } = createDb(databaseUrl);
try {
  const before = new Map((await db.select().from(siteClasses)).map((row) => [row.site, row]));
  const result = await classifyPending(
    { db, config: { classifier: settings } },
    settings ? realClassifierIo(settings) : { fetch: globalThis.fetch, resolve4: async () => [] },
  );
  console.log(`status: ${result.status} (asked ${result.asked}, stored ${result.stored}, blocked ${result.blocked})`);
  for (const row of await db.select().from(siteClasses)) {
    const old = before.get(row.site);
    const unchanged =
      old &&
      old.kind === row.kind &&
      old.category === row.category &&
      old.owner === row.owner &&
      old.label === row.label &&
      old.confidence === row.confidence &&
      old.familyDnsBlocked === row.familyDnsBlocked &&
      old.attempts === row.attempts &&
      old.classifiedAt?.getTime() === row.classifiedAt?.getTime();
    if (unchanged) continue;
    console.log(
      [row.site, row.kind ?? '', row.category ?? '', row.owner ?? '', row.label ?? '', row.confidence ?? '', row.familyDnsBlocked].join(' | '),
    );
  }
} finally {
  await pool.end();
}
