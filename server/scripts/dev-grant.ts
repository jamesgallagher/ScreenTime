// Adds or removes today's time for a kid of the development database through the API, as a parent would in the
// app, so the server pushes `grant_added` to the kid's devices (to try the live channel on the emulator). It signs a
// short-lived parent token with JWT_SECRET for the family's first parent; the server must use the same secret.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-grant.ts Alex phone 15 [http://localhost:8080]
// Minutes are a non-zero multiple of 15, negative to remove. Never run this against the production database.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { signAccessToken } from "../src/auth/tokens.js";
import { createDb } from "../src/db/client.js";
import { kids, parents } from "../src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const kidName = process.argv[2]?.trim();
const pool = process.argv[3];
const minutes = Number(process.argv[4]);
const apiUrl = (process.argv[5] ?? "http://localhost:8080").replace(/\/+$/, "");
if (
  !databaseUrl ||
  !jwtSecret ||
  !kidName ||
  (pool !== "phone" && pool !== "screens") ||
  !Number.isInteger(minutes) ||
  minutes === 0 ||
  minutes % 15 !== 0 ||
  Math.abs(minutes) > 1440
) {
  console.error(
    "Usage: DATABASE_URL=postgres://... JWT_SECRET=... tsx scripts/dev-grant.ts <kid name> <phone|screens> <minutes, a multiple of 15> [api url]",
  );
  process.exit(1);
}

const { db, pool: pg } = createDb(databaseUrl);
try {
  const [kid] = await db
    .select()
    .from(kids)
    .where(sql`lower(${kids.name}) = lower(${kidName})`)
    .orderBy(asc(kids.createdAt))
    .limit(1);
  if (!kid)
    throw new Error(`no kid named ${kidName}: run scripts/seed-dev.ts first`);
  const [parent] = await db
    .select()
    .from(parents)
    .where(and(eq(parents.familyId, kid.familyId), isNull(parents.disabledAt)))
    .orderBy(asc(parents.createdAt))
    .limit(1);
  if (!parent) throw new Error(`the family of ${kid.name} has no parent`);

  const token = await signAccessToken(jwtSecret, {
    sessionId: randomUUID(),
    parentId: parent.id,
    familyId: kid.familyId,
    roles: ["parent"],
  });
  const response = await fetch(`${apiUrl}/v1/kids/${kid.id}/grants`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: randomUUID(), pool, minutes }),
  });
  if (!response.ok) {
    throw new Error(
      `the API said ${response.status}: ${await response.text()}`,
    );
  }
  const verb = minutes > 0 ? "Added" : "Removed";
  console.log(
    `${verb} ${Math.abs(minutes)} min of ${pool} for ${kid.name} today, as ${parent.displayName}.`,
  );
} finally {
  await pg.end();
}
