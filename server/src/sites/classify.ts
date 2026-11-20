import dns from 'node:dns';
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SiteCategory, SiteKind } from '@screentime/schemas';
import type { ClassifierConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { families, siteClasses, siteDaily, siteLookups } from '../db/schema.js';
import { ECHO_PACKAGES } from './packages.js';

export const SITE_KINDS = SiteKind.options;
export const SITE_CATEGORIES = SiteCategory.options;

/** The fixed system prompt of the classifier (docs/SPEC.md §12.10, CARD-070 §5.4), a fixture: do not tune it. */
export const CLASSIFIER_PROMPT = [
  "You sort internet domains for a parent's report of what their children's devices looked up.",
  'For each input item (a registrable domain, some full hostnames seen under it, and the apps that looked it up) return exactly one result with the same "site".',
  'kind: "website" = a site a person opens and reads or uses (including web apps and games played in a browser); "cdn" = serves files, images or video for another site or app; "ads_tracking" = advertising, analytics, tracking, telemetry; "app_service" = an API or backend an app or the operating system talks to, not opened by a person; "unknown" = you do not recognise the domain and cannot tell from its name.',
  `category: what the site, or the site it serves, is about: ${SITE_CATEGORIES.join(', ')}. Use "other" when none fits. For unknown, use "other".`,
  'owner: for cdn and app_service, the registrable domain of the site or company it serves (e.g. fbcdn.net -> facebook.com), else null.',
  'label: the site\'s usual name ("Khan Academy"), or null if unsure.',
  'confidence: 0 to 1, how sure you are of kind and category. Never guess a well-known name for a domain you do not recognise.',
].join('\n');

/** The strict JSON schema sent as `response_format` (docs/SPEC.md §12.10, CARD-070 §5.4). */
export const ANSWER_SCHEMA = {
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
          kind: { enum: SITE_KINDS },
          category: { enum: SITE_CATEGORIES },
          owner: { type: ['string', 'null'] },
          label: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

/** One result the model gave. Confidence is checked here and clamped to 0..1 when it is stored. */
const AnswerItem = z
  .object({
    site: z.string(),
    kind: SiteKind,
    category: SiteCategory,
    owner: z.string().nullable(),
    label: z.string().nullable(),
    confidence: z.number(),
  })
  .strict();

const Answer = z.object({ sites: z.array(AnswerItem) }).strict();

const Envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });

export type ClassifyStatus = 'off' | 'nothing' | 'done' | 'unavailable' | 'bad_answer';

export interface ClassifyResult {
  status: ClassifyStatus;
  /** Sites asked of the model (in the requests that were sent). */
  asked: number;
  /** Sites whose kind was stored this run: a result, or the third miss's `unknown`. */
  stored: number;
  /** Sites the family resolver marked blocked. */
  blocked: number;
}

/** What the classifier needs from the process, and what tests pass fakes for. */
export interface ClassifierDeps {
  db: Db;
  config: { classifier: ClassifierConfig | null };
}

export interface ClassifierIo {
  fetch: typeof fetch;
  resolve4: (name: string) => Promise<string[]>;
}

interface Candidate {
  site: string;
  hosts: string[];
  apps: string[];
}

interface Stored {
  site: string;
  kind: SiteKind;
  confidence: number;
  firstHost: string | null;
}

/**
 * One classifier run (docs/SPEC.md §12.10): the sites in `site_daily` that are not sorted yet, in requests of 50,
 * each site classified once. Talks to the model outside any transaction and writes `site_classes` (a table with no
 * RLS) afterwards. `io` makes every outbound call a fake in tests.
 */
export async function classifyPending(deps: ClassifierDeps, io: ClassifierIo): Promise<ClassifyResult> {
  const settings = deps.config.classifier;
  const result: ClassifyResult = { status: 'off', asked: 0, stored: 0, blocked: 0 };
  if (!settings) return result;

  const candidates = await pendingSites(deps.db);
  if (candidates.length === 0) {
    result.status = 'nothing';
    return result;
  }

  const stored: Stored[] = [];
  for (let i = 0; i < candidates.length; i += 50) {
    const batch = candidates.slice(i, i + 50);
    result.asked += batch.length;

    let content: string;
    try {
      const response = await io.fetch(`${settings.url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          max_tokens: 8192,
          chat_template_kwargs: { enable_thinking: false },
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'site_classes', strict: true, schema: ANSWER_SCHEMA },
          },
          messages: [
            { role: 'system', content: CLASSIFIER_PROMPT },
            { role: 'user', content: JSON.stringify(batch.map(({ site, hosts, apps }) => ({ site, hosts, apps }))) },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status !== 200) {
        console.log(`classifier: unavailable (HTTP ${response.status})`);
        result.status = 'unavailable';
        return result;
      }
      content = await response.text();
    } catch (err) {
      console.log(`classifier: unavailable (${reasonOf(err)})`);
      result.status = 'unavailable';
      return result;
    }

    let answer: z.infer<typeof Answer>;
    try {
      const envelope = Envelope.parse(JSON.parse(content) as unknown);
      answer = Answer.parse(JSON.parse(envelope.choices[0]?.message.content ?? '') as unknown);
    } catch (err) {
      console.log(`classifier: bad answer (${reasonOf(err)})`);
      await countAttempts(deps.db, batch);
      result.status = 'bad_answer';
      return result;
    }

    const asked = new Set(batch.map((c) => c.site));
    const existing = await deps.db
      .select({ site: siteClasses.site, attempts: siteClasses.attempts })
      .from(siteClasses)
      .where(inArray(siteClasses.site, batch.map((c) => c.site)));
    const attemptsBy = new Map(existing.map((r) => [r.site, r.attempts]));
    const bySite = new Map(answer.sites.filter((s) => asked.has(s.site)).map((s) => [s.site, s]));

    for (const candidate of batch) {
      const found = bySite.get(candidate.site);
      const attempts = (attemptsBy.get(candidate.site) ?? 0) + 1;
      if (found) {
        const owner = found.kind === 'cdn' || found.kind === 'app_service' ? found.owner : null;
        const label = found.label !== null && found.label.length > 80 ? null : found.label;
        const confidence = Math.min(1, Math.max(0, found.confidence));
        await deps.db
          .insert(siteClasses)
          .values({
            site: candidate.site,
            kind: found.kind,
            category: found.category,
            owner,
            label,
            confidence,
            model: settings.model,
            classifiedAt: new Date(),
            attempts,
          })
          .onConflictDoUpdate({
            target: siteClasses.site,
            set: {
              kind: found.kind,
              category: found.category,
              owner,
              label,
              confidence,
              model: settings.model,
              classifiedAt: new Date(),
              attempts,
            },
          });
        stored.push({ site: candidate.site, kind: found.kind, confidence, firstHost: candidate.hosts[0] ?? null });
        result.stored += 1;
      } else if (attempts >= 3) {
        // Three misses: stop asking and keep it as unknown.
        await deps.db
          .insert(siteClasses)
          .values({
            site: candidate.site,
            kind: 'unknown',
            category: 'other',
            owner: null,
            label: null,
            confidence: 0,
            model: settings.model,
            classifiedAt: new Date(),
            attempts,
          })
          .onConflictDoUpdate({
            target: siteClasses.site,
            set: {
              kind: 'unknown',
              category: 'other',
              owner: null,
              label: null,
              confidence: 0,
              model: settings.model,
              classifiedAt: new Date(),
              attempts,
            },
          });
        stored.push({ site: candidate.site, kind: 'unknown', confidence: 0, firstHost: candidate.hosts[0] ?? null });
        result.stored += 1;
      } else {
        // One more attempt; nothing else changes.
        await deps.db
          .insert(siteClasses)
          .values({ site: candidate.site, attempts })
          .onConflictDoUpdate({ target: siteClasses.site, set: { attempts } });
      }
    }
  }

  // The family filter: only a site the model called unknown, or is less than 0.6 sure of, is looked up.
  if (settings.familyDns) {
    for (const s of stored) {
      if (!(s.kind === 'unknown' || s.confidence < 0.6)) continue;
      const blocked = await blockedByFamilyDns(io, s.site, s.firstHost);
      if (!blocked) continue;
      await deps.db
        .update(siteClasses)
        .set({ familyDnsBlocked: true, kind: 'website', category: 'adult' })
        .where(eq(siteClasses.site, s.site));
      result.blocked += 1;
    }
  }

  result.status = 'done';
  console.log(`classifier: ${result.stored} sites sorted (${result.blocked} blocked by the family filter)`);
  return result;
}

/** The candidates, most lookups over every family first, then by site; at most 200 (docs/SPEC.md §12.10). */
async function pendingSites(db: Db): Promise<Candidate[]> {
  const rows = await db
    .select({ site: siteDaily.site })
    .from(siteDaily)
    .innerJoin(families, eq(families.id, siteDaily.familyId))
    .leftJoin(siteClasses, eq(siteClasses.site, siteDaily.site))
    .where(
      and(
        isNull(families.disabledAt),
        notInArray(siteDaily.package, ECHO_PACKAGES),
        or(
          isNull(siteClasses.site),
          and(isNull(siteClasses.kind), lt(siteClasses.attempts, 3)),
        ),
      ),
    )
    .groupBy(siteDaily.site)
    .orderBy(sql`sum(${siteDaily.lookups}) desc`, asc(siteDaily.site))
    .limit(200);
  const sites = rows.map((r) => r.site);
  if (sites.length === 0) return [];

  const hostRows = await db
    .select({ site: siteLookups.site, host: siteLookups.host, n: sql<number>`count(*)::int` })
    .from(siteLookups)
    .where(and(inArray(siteLookups.site, sites), notInArray(siteLookups.package, ECHO_PACKAGES)))
    .groupBy(siteLookups.site, siteLookups.host);
  const appRows = await db
    .select({ site: siteDaily.site, package: siteDaily.package, n: sql<number>`sum(${siteDaily.lookups})::int` })
    .from(siteDaily)
    .where(and(inArray(siteDaily.site, sites), notInArray(siteDaily.package, ECHO_PACKAGES)))
    .groupBy(siteDaily.site, siteDaily.package);

  const hosts = new Map<string, { host: string; n: number }[]>();
  for (const row of hostRows) {
    if (row.site === null) continue;
    hosts.set(row.site, [...(hosts.get(row.site) ?? []), { host: row.host, n: row.n }]);
  }
  const apps = new Map<string, { package: string; n: number }[]>();
  for (const row of appRows) {
    apps.set(row.site, [...(apps.get(row.site) ?? []), { package: row.package, n: row.n }]);
  }

  return sites.map((site) => ({
    site,
    hosts: (hosts.get(site) ?? [])
      .sort((a, b) => b.n - a.n || a.host.localeCompare(b.host))
      .slice(0, 5)
      .map((h) => h.host),
    apps: (apps.get(site) ?? [])
      .sort((a, b) => b.n - a.n || a.package.localeCompare(b.package))
      .slice(0, 5)
      .map((a) => a.package),
  }));
}

/** Adds one attempt to every site of a request whose answer could not be read. */
async function countAttempts(db: Db, batch: Candidate[]): Promise<void> {
  await db
    .insert(siteClasses)
    .values(batch.map((c) => ({ site: c.site, attempts: 1 })))
    .onConflictDoUpdate({ target: siteClasses.site, set: { attempts: sql`${siteClasses.attempts} + 1` } });
}

/**
 * True when the family resolver answers `0.0.0.0` for the site or, when it has no address at all, its first host.
 * Any other answer (another address, another error) is not blocked.
 */
async function blockedByFamilyDns(io: ClassifierIo, site: string, firstHost: string | null): Promise<boolean> {
  let addresses: string[] | null;
  try {
    addresses = await io.resolve4(site);
  } catch (err) {
    if (!isNoData(err)) return false;
    addresses = [];
  }
  if (addresses.length === 0) {
    if (!firstHost) return false;
    try {
      addresses = await io.resolve4(firstHost);
    } catch {
      return false;
    }
  }
  return addresses.includes('0.0.0.0');
}

/** Node's resolver says "no data" or "not found" when a name has no address (not a time-out or a server error). */
function isNoData(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code: unknown }).code : null;
  return code === 'ENODATA' || code === 'ENOTFOUND';
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The real resolver, at the family resolver when one is set (docs/SPEC.md §12.10). */
export function realClassifierIo(settings: ClassifierConfig): ClassifierIo {
  return {
    fetch: globalThis.fetch,
    resolve4: (name) => {
      const resolver = new dns.promises.Resolver({ timeout: 5000, tries: 1 });
      if (settings.familyDns) resolver.setServers([settings.familyDns]);
      return resolver.resolve4(name);
    },
  };
}

/**
 * Runs the classifier in the API process: the first run a minute after start, then every `everyMs`. A run that is
 * still going is not doubled up; a failure is logged and the next run tries again. With the config null it logs
 * `classifier: off` once and does nothing. Returns a stop function.
 */
export function startClassifier(deps: ClassifierDeps, everyMs = 3_600_000, io?: ClassifierIo): () => void {
  const settings = deps.config.classifier;
  if (!settings) {
    console.log('classifier: off');
    return () => {};
  }
  const realIo = io ?? realClassifierIo(settings);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await classifyPending(deps, realIo);
    } catch (err) {
      console.error('classifier: failed', err);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

