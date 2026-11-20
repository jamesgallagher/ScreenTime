import { z } from 'zod';
import { DeviceForm, Platform } from './devices.js';
import { LocalDate } from './grants.js';
import { ReportPeriod } from './reports.js';

/**
 * Website lookups (docs/SPEC.md §12.10): a device sends the DNS lookups its browsers and apps made, and the server
 * keeps them 90 days and adds them up per day, device, site and app. The host is lower case without a trailing dot;
 * `package` is the Android package or the PC program's exe id that looked it up.
 */

/** A website lookup as a device sends it. */
export const SiteLookupIn = z
  .object({
    at: z.iso.datetime(),
    /** Lower case, no trailing dot; not an IP address. */
    host: z.string().min(1).max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/),
    /** The app or program that looked the host up. */
    package: z.string().min(1).max(255),
  })
  .meta({ id: 'SiteLookupIn' });

export type SiteLookupIn = z.infer<typeof SiteLookupIn>;

/** Body of POST /v1/device/site-lookups. */
export const SiteLookupsUpload = z
  .object({ lookups: z.array(SiteLookupIn).min(1).max(1000) })
  .meta({ id: 'SiteLookupsUpload' });

export type SiteLookupsUpload = z.infer<typeof SiteLookupsUpload>;

/** Answer of POST /v1/device/site-lookups: how many rows were new. */
export const SiteLookupsReceived = z.object({ received: z.int() }).meta({ id: 'SiteLookupsReceived' });

export type SiteLookupsReceived = z.infer<typeof SiteLookupsReceived>;

/** A browser title span as a PC sends it. */
export const SiteTitleIn = z
  .object({
    /** When the span started. */
    at: z.iso.datetime(),
    sec: z.int().min(1).max(86_400),
    /** The exe id of the browser that showed it. */
    package: z.string().min(1).max(255),
    /** The page title as Windows showed it, cleaned. */
    title: z.string().min(1).max(300),
  })
  .meta({ id: 'SiteTitleIn' });

export type SiteTitleIn = z.infer<typeof SiteTitleIn>;

/** Body of POST /v1/device/site-titles. */
export const SiteTitlesUpload = z
  .object({ titles: z.array(SiteTitleIn).min(1).max(500) })
  .meta({ id: 'SiteTitlesUpload' });

export type SiteTitlesUpload = z.infer<typeof SiteTitlesUpload>;

/** Answer of POST /v1/device/site-titles: how many rows were new. */
export const SiteTitlesReceived = z.object({ received: z.int() }).meta({ id: 'SiteTitlesReceived' });

export type SiteTitlesReceived = z.infer<typeof SiteTitlesReceived>;

/** The kinds of site the classifier gives (docs/SPEC.md §12.10). */
export const SiteKind = z.enum(['website', 'cdn', 'ads_tracking', 'app_service', 'unknown']).meta({ id: 'SiteKind' });
export type SiteKind = z.infer<typeof SiteKind>;

/** What a site, or the site it serves, is about (docs/SPEC.md §12.10). */
export const SiteCategory = z
  .enum([
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
  ])
  .meta({ id: 'SiteCategory' });
export type SiteCategory = z.infer<typeof SiteCategory>;

/** Who sorted the site: the LLM, Cloudflare's family resolver (blocked = adult or unsafe), or a parent. */
export const SiteClassSource = z.enum(['classifier', 'family_dns', 'parent']).meta({ id: 'SiteClassSource' });
export type SiteClassSource = z.infer<typeof SiteClassSource>;

/** The engine of a search read from a PC browser's title. */
export const SearchEngine = z.enum(['google', 'bing', 'duckduckgo']).meta({ id: 'SearchEngine' });
export type SearchEngine = z.infer<typeof SearchEngine>;

/** Query of GET /v1/reports/sites. `date` defaults to the family's today. */
export const SiteReportQuery = z
  .object({
    kidId: z.uuid(),
    period: ReportPeriod,
    date: LocalDate.optional(),
    deviceId: z.uuid().optional(),
  })
  .meta({ id: 'SiteReportQuery' });
export type SiteReportQuery = z.infer<typeof SiteReportQuery>;

/** One of the kid's devices, as the sites report shows it. */
export const SiteReportDevice = z
  .object({
    deviceId: z.uuid(),
    name: z.string(),
    form: DeviceForm,
    platform: Platform,
    /** The device's `revoked_at`: removed from the family. */
    removedAt: z.iso.datetime().nullable(),
    /** The device has sent any website lookup, ever. False for a PC on a version before CARD-069. */
    sitesRecorded: z.boolean(),
  })
  .meta({ id: 'SiteReportDevice' });
export type SiteReportDevice = z.infer<typeof SiteReportDevice>;

/** An app or program that looked the site up. */
export const SiteReportApp = z
  .object({
    package: z.string(),
    label: z.string(),
    /** One of the known browsers (docs/SPEC.md §12.10). */
    browser: z.boolean(),
    minutes: z.int().min(0),
  })
  .meta({ id: 'SiteReportApp' });
export type SiteReportApp = z.infer<typeof SiteReportApp>;

/** One site of the report, shown or behind the scenes. */
export const SiteReportSite = z
  .object({
    /** The registrable domain (`khanacademy.org`). */
    site: z.string(),
    /** The site's usual name from the classifier ("Khan Academy"), or null. */
    label: z.string().nullable(),
    /** Null while the site is not sorted yet. */
    kind: SiteKind.nullable(),
    category: SiteCategory.nullable(),
    source: SiteClassSource.nullable(),
    /** For a CDN or app service: the site it serves (`fbcdn.net` → `facebook.com`). */
    owner: z.string().nullable(),
    /** Active minutes: the minutes in which it was looked up, per app and device, added up. */
    minutes: z.int().min(0),
    lookups: z.int().min(0),
    /** Days in the period with a lookup. */
    days: z.int().min(0),
    firstAt: z.iso.datetime(),
    lastAt: z.iso.datetime(),
    /** Most active first. */
    apps: z.array(SiteReportApp),
    /** Each device with a lookup, in the order of the report's devices. */
    devices: z.array(z.object({ deviceId: z.uuid(), minutes: z.int().min(0) })),
  })
  .meta({ id: 'SiteReportSite' });
export type SiteReportSite = z.infer<typeof SiteReportSite>;

/** Active minutes per category over `sites` (null: not sorted yet), most first. */
export const SiteReportCategory = z
  .object({
    category: SiteCategory.nullable(),
    minutes: z.int().min(0),
    sites: z.int().min(0),
  })
  .meta({ id: 'SiteReportCategory' });
export type SiteReportCategory = z.infer<typeof SiteReportCategory>;

/** A search read from a PC browser's title, the same words on one engine added up. */
export const SiteReportSearch = z
  .object({
    engine: SearchEngine,
    query: z.string(),
    sec: z.int().min(0),
    /** Any of it in a private window. */
    private: z.boolean(),
    firstAt: z.iso.datetime(),
    deviceId: z.uuid(),
  })
  .meta({ id: 'SiteReportSearch' });
export type SiteReportSearch = z.infer<typeof SiteReportSearch>;

/** A page title on a PC browser, the browser's own name and markers taken off. */
export const SiteReportPage = z
  .object({
    page: z.string(),
    package: z.string(),
    sec: z.int().min(0),
    private: z.boolean(),
  })
  .meta({ id: 'SiteReportPage' });
export type SiteReportPage = z.infer<typeof SiteReportPage>;

/** The websites report of a kid or shared device (docs/SPEC.md §12.10, CARD-070). */
export const SiteReport = z
  .object({
    kidId: z.uuid(),
    period: ReportPeriod,
    from: LocalDate,
    to: LocalDate,
    /** The family's today, so the page can tell when the period holds it. */
    today: LocalDate,
    /** The one device, when the report is narrowed to it; null for all devices. */
    deviceId: z.uuid().nullable(),
    /** Every device of the report, removed ones too, so the page can show its chips. */
    devices: z.array(SiteReportDevice),
    categories: z.array(SiteReportCategory),
    /** Websites, unknown sites and sites not sorted yet: most active first. */
    sites: z.array(SiteReportSite),
    /** CDNs, ads and tracking, app services: most active first. */
    behindTheScenes: z.array(SiteReportSite),
    /** Time a browser was in front on the report's PCs. */
    browserSec: z.int().min(0),
    /** Of that, time in private windows. */
    privateSec: z.int().min(0),
    /** Newest first. */
    searches: z.array(SiteReportSearch),
    /** Most time first, at most 50. */
    pages: z.array(SiteReportPage),
    /** The first local date whose titles are still kept (90 days); searches and pages before it are gone. */
    titlesKeptFrom: LocalDate,
  })
  .meta({ id: 'SiteReport' });
export type SiteReport = z.infer<typeof SiteReport>;

/** A parent's own kind and category for a site, for the whole family (PUT /v1/sites/{site}/class). */
export const SiteClassOverride = z
  .object({
    kind: z.enum(['website', 'cdn', 'ads_tracking', 'app_service']),
    category: SiteCategory,
  })
  .meta({ id: 'SiteClassOverride' });
export type SiteClassOverride = z.infer<typeof SiteClassOverride>;

/** Answer of PUT /v1/sites/{site}/class. */
export const SiteClassSaved = z
  .object({
    site: z.string(),
    kind: z.enum(['website', 'cdn', 'ads_tracking', 'app_service']),
    category: SiteCategory,
  })
  .meta({ id: 'SiteClassSaved' });
export type SiteClassSaved = z.infer<typeof SiteClassSaved>;
