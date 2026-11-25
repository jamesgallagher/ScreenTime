import { z } from 'zod';
import { DeviceForm, Platform } from './devices.js';
import { LocalDate } from './grants.js';
import { ReportPeriod } from './reports.js';
import { SearchEngine } from './sites.js';

/** Whether a device is currently capturing searches, or has not reported a state. */
export const SearchCapture = z.enum(['on', 'off', 'never']).meta({ id: 'SearchCapture' });
export type SearchCapture = z.infer<typeof SearchCapture>;

/** One of the kid's devices, as the searches report shows it. */
export const SearchReportDevice = z
  .object({
    deviceId: z.uuid(),
    name: z.string(),
    form: DeviceForm,
    platform: Platform,
    /** The device's `revoked_at`: removed from the family. */
    removedAt: z.iso.datetime().nullable(),
    capture: SearchCapture,
  })
  .meta({ id: 'SearchReportDevice' });
export type SearchReportDevice = z.infer<typeof SearchReportDevice>;

/** One search: the same words on one device, repeated within 10 minutes, are one search with a count. */
export const SearchReportItem = z
  .object({
    query: z.string(),
    engine: SearchEngine,
    /** Where it was typed: `com.android.chrome`, `com.google.android.googlequicksearchbox`, `msedge.exe`… */
    package: z.string(),
    /** The app's name in the Apps report, or its package when no label is known. */
    appLabel: z.string(),
    deviceId: z.uuid(),
    /** First seen. */
    at: z.iso.datetime(),
    /** Last seen (the same as `at` for a search seen once). */
    lastAt: z.iso.datetime(),
    /** Times it was seen within the 10 minutes. */
    count: z.int().min(1).max(1000),
    /** A private or incognito window: true or false on a PC, null on Android. */
    private: z.boolean().nullable(),
  })
  .meta({ id: 'SearchReportItem' });
export type SearchReportItem = z.infer<typeof SearchReportItem>;

/** The searches report of a kid or shared device (docs/SPEC.md §12.12, CARD-074). */
export const SearchReport = z
  .object({
    kidId: z.uuid(),
    period: ReportPeriod,
    from: LocalDate,
    to: LocalDate,
    /** The family's today. */
    today: LocalDate,
    /** The one device, when the report is narrowed to it; null for all devices. */
    deviceId: z.uuid().nullable(),
    /** Every device of the report, removed ones too, so the page can show its chips. */
    devices: z.array(SearchReportDevice),
    /** Newest first. */
    searches: z.array(SearchReportItem),
  })
  .meta({ id: 'SearchReport' });
export type SearchReport = z.infer<typeof SearchReport>;

/** One search as a device sends it. */
export const SearchIn = z
  .object({
    at: z.iso.datetime(),
    lastAt: z.iso.datetime(),
    count: z.int().min(1).max(1000),
    engine: SearchEngine,
    query: z.string().trim().min(1).max(200),
    package: z.string().min(1).max(200),
  })
  .meta({ id: 'SearchIn' });
export type SearchIn = z.infer<typeof SearchIn>;

/** Body of POST /v1/device/searches. */
export const SearchesUpload = z
  .object({
    capture: z.enum(['on', 'off']),
    searches: z.array(SearchIn).max(500),
  })
  .meta({ id: 'SearchesUpload' });
export type SearchesUpload = z.infer<typeof SearchesUpload>;

/** Answer of POST /v1/device/searches: how many rows were inserted or changed. */
export const SearchesReceived = z.object({ received: z.int() }).meta({ id: 'SearchesReceived' });
export type SearchesReceived = z.infer<typeof SearchesReceived>;
