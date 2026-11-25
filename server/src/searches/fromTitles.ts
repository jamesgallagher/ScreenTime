import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { SearchEngine } from '@screentime/schemas';
import type { FamilyTx } from '../db/family.js';
import { searches, siteTitles } from '../db/schema.js';
import { parseTitle } from '../reports/titles.js';

type SearchWriter = Pick<FamilyTx, 'select' | 'insert' | 'update'>;
type TitleSighting = Pick<
  typeof siteTitles.$inferSelect,
  'familyId' | 'kidId' | 'deviceId' | 'at' | 'sec' | 'package' | 'title'
>;

/**
 * Turns newly stored PC title rows into search sightings. Call inside the site-title transaction so the title and
 * the search it creates are committed together.
 */
export async function fromTitles(tx: SearchWriter, rows: readonly TitleSighting[]): Promise<void> {
  const ordered = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const row of ordered) {
    const parsed = parseTitle(row.package, row.title);
    if (!parsed.search) continue;

    const search = parsed.search;
    const after = new Date(row.at.getTime() + row.sec * 1000);
    const repeatSince = new Date(row.at.getTime() - 10 * 60 * 1000);
    const [previous] = await tx
      .select()
      .from(searches)
      .where(
        and(
          eq(searches.deviceId, row.deviceId),
          eq(searches.source, 'title'),
          eq(searches.engine, search.engine as SearchEngine),
          sql`lower(${searches.query}) = ${search.query.toLowerCase()}`,
          gte(searches.lastAt, repeatSince),
          lte(searches.lastAt, row.at),
        ),
      )
      .orderBy(desc(searches.lastAt))
      .limit(1);

    if (previous) {
      await tx
        .update(searches)
        .set({
          lastAt: after,
          count: sql`${searches.count} + 1`,
          private: sql`coalesce(${searches.private}, false) or ${parsed.private}`,
        })
        .where(
          and(
            eq(searches.deviceId, previous.deviceId),
            eq(searches.at, previous.at),
            eq(searches.package, previous.package),
          ),
        );
    } else {
      await tx.insert(searches).values({
        familyId: row.familyId,
        kidId: row.kidId,
        deviceId: row.deviceId,
        at: row.at,
        lastAt: after,
        count: 1,
        engine: search.engine,
        query: search.query,
        package: row.package,
        private: parsed.private,
        source: 'title',
      });
    }
  }
}
