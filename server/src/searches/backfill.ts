import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { searches, siteTitles } from '../db/schema.js';
import { fromTitles } from './fromTitles.js';

/** Reads kept PC titles once, when there are no title-derived searches yet. */
export async function backfillSearches(db: Db): Promise<{ searches: number; titles: number; skipped: boolean }> {
  const [existing] = await db
    .select({ deviceId: searches.deviceId })
    .from(searches)
    .where(eq(searches.source, 'title'))
    .limit(1);
  if (existing) return { searches: 0, titles: 0, skipped: true };

  const titles = await db
    .select({
      familyId: siteTitles.familyId,
      kidId: siteTitles.kidId,
      deviceId: siteTitles.deviceId,
      at: siteTitles.at,
      sec: siteTitles.sec,
      package: siteTitles.package,
      title: siteTitles.title,
    })
    .from(siteTitles)
    .orderBy(asc(siteTitles.deviceId), asc(siteTitles.at), asc(siteTitles.package));

  if (titles.length === 0) return { searches: 0, titles: 0, skipped: false };
  await fromTitles(db, titles);

  const result = await db.execute<{ count: number }>(sql`
    select count(*)::int as count from searches where source = 'title'
  `);
  const count = result.rows[0]?.count ?? 0;
  console.log(`searches: backfill ${count} searches from ${titles.length} titles`);
  return { searches: count, titles: titles.length, skipped: false };
}
