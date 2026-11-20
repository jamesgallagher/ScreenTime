import { z } from 'zod';

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
