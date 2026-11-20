import { sql } from 'drizzle-orm';
import { getDomain } from 'tldts';
import type { Db } from '../db/client.js';

export interface BackfillResult {
  /** Raw lookup rows that had no `site` and got one. */
  filled: number;
  /** `site_daily` rows whose `minutes` was counted again (every row that has a raw row). */
  recounted: number;
}

/**
 * Fills `site_lookups.site` and recounts `site_daily.minutes` after the CARD-070 deploy (docs/SPEC.md §12.10). It
 * works as the database owner, outside row-level security, so it covers every family in one pass. Running it again
 * changes no value: a second run fills nothing and counts the same rows. `site_daily` rows with no raw lookup (their
 * raw rows have been swept) are left as they are.
 */
export async function backfillSites(db: Db): Promise<BackfillResult> {
  // (a) Every raw lookup row without a site gets it from its host: one update per distinct host.
  const hosts = await db.execute<{ host: string }>(sql`select distinct host from site_lookups where site is null`);
  let filled = 0;
  for (const { host } of hosts.rows) {
    const result = await db.execute(
      sql`update site_lookups set site = ${getDomain(host) ?? host} where host = ${host} and site is null`,
    );
    filled += result.rowCount ?? 0;
  }

  // (b) Every site_daily row with at least one raw lookup gets its active minutes counted from those rows, in the
  // family's local day. Rows with no raw lookup are not touched.
  const recounted = await db.execute(sql`
    update site_daily d
    set minutes = (
      select count(distinct date_trunc('minute', l.at))::int
      from site_lookups l
      where l.device_id = d.device_id and l.site = d.site and l.package = d.package
        and l.at >= (d.day::timestamp at time zone f.timezone)
        and l.at < ((d.day + 1)::timestamp at time zone f.timezone)
    )
    from families f
    where f.id = d.family_id
      and exists (
        select 1
        from site_lookups l
        where l.device_id = d.device_id and l.site = d.site and l.package = d.package
          and l.at >= (d.day::timestamp at time zone f.timezone)
          and l.at < ((d.day + 1)::timestamp at time zone f.timezone)
      )
  `);

  return { filled, recounted: recounted.rowCount ?? 0 };
}
